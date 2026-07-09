import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TERMINAL_STATUSES = new Set(['done', 'complete', 'completed', 'closed', 'merged', 'shipped', 'cancelled', 'canceled', 'archived', 'superseded']);
const ANALYSIS_PIPELINE = 'research';
const IMPLEMENTATION_PIPELINE = 'simple-loop';
const ARCHIVE_PIPELINE = 'archive';
const PLAN_USAGE = 'Usage: /backlog:plan [query] --iterations <n> [--all]';
const RISK_HINT_PATTERN = /(process|resume|pipeline|run|branch|state|selection|durable)/;
const ANALYSIS_RISK_PATTERN = /(plan|next|list|inspect|read-only|readonly|docs|documentation|prd)/;
const ANALYSIS_PIPELINE_PATTERN = /(plan|next|list|inspect|read-only|readonly|docs|documentation|prd|research)/;

function splitCommandArgs(command) {
  const result = [];
  let current = '';
  let quote = null;

  for (const char of command) {
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) result.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current) result.push(current);
  return result;
}

export function parsePlanArgs(rawArgs) {
  const tokens = splitCommandArgs(String(rawArgs ?? '').trim());
  const queryTokens = [];
  let iterations = 1;
  let includeTerminal = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--iterations') {
      const next = tokens[i + 1];
      if (!next || !/^\d+$/.test(next)) {
        throw new Error(PLAN_USAGE);
      }
      iterations = Number(next);
      i += 1;
      continue;
    }
    if (token.startsWith('--iterations=')) {
      const value = token.slice('--iterations='.length);
      if (!/^\d+$/.test(value)) {
        throw new Error(PLAN_USAGE);
      }
      iterations = Number(value);
      continue;
    }
    if (token === '--all' || token === '--include-terminal') {
      includeTerminal = true;
      continue;
    }
    queryTokens.push(token);
  }

  return {
    query: queryTokens.join(' ').trim(),
    iterations: Math.max(1, Math.floor(iterations)),
    includeTerminal,
  };
}

function normalizeIssueId(value) {
  const match = String(value ?? '').match(/(\d{5})/);
  return match ? match[1] : null;
}

function humanizeFileStem(stem) {
  return stem
    .replace(/^\d{5}-/, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return value.replace(/^['"]|['"]$/g, '');
}

function appendNestedListValue(section, key, rawValue) {
  const nextValue = parseScalar(rawValue);
  const existing = section[key];

  if (Array.isArray(existing)) {
    existing.push(nextValue);
    return;
  }

  if (existing && typeof existing === 'object') {
    section[key] = [existing, nextValue];
    return;
  }

  if (existing !== undefined && existing !== '') {
    section[key] = [existing, nextValue];
    return;
  }

  section[key] = [nextValue];
}

function parseSimpleFrontmatter(frontmatterText) {
  const data = {};
  const lines = String(frontmatterText ?? '').replace(/\r/g, '').split('\n');
  let sectionKey = '';
  let nestedKey = '';

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const topLevel = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (topLevel && !/^\s/.test(line)) {
      const key = topLevel[1];
      const value = topLevel[2];
      if (value === '') {
        data[key] = {};
        sectionKey = key;
        nestedKey = '';
      } else {
        data[key] = parseScalar(value);
        sectionKey = '';
        nestedKey = '';
      }
      continue;
    }

    if (!sectionKey) continue;
    const nested = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested) {
      nestedKey = nested[1];
      const value = nested[2];
      if (value === '') {
        data[sectionKey][nestedKey] = {};
      } else {
        data[sectionKey][nestedKey] = parseScalar(value);
      }
      continue;
    }

    const listItem = line.match(/^\s{4}-\s*(.*)$/);
    if (listItem && nestedKey) {
      appendNestedListValue(data[sectionKey], nestedKey, listItem[1]);
    }
  }

  return data;
}

function parseFrontmatter(rawText) {
  const normalized = String(rawText ?? '').replace(/\r/g, '');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }

  return {
    frontmatter: parseSimpleFrontmatter(match[1]),
    body: match[2],
  };
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeStringArray(entry));
  }
  return [String(value)];
}

function normalizeLinkList(value) {
  return normalizeStringArray(value)
    .map((entry) => normalizeIssueId(entry))
    .filter(Boolean);
}

function parsePriority(priority) {
  const normalized = String(priority ?? 'medium').toLowerCase();
  if (normalized === 'high') return 0;
  if (normalized === 'medium') return 1;
  if (normalized === 'low') return 2;
  return 3;
}

function describeItemText(item) {
  return [item.title, item.summary, item.tags.join(' '), item.body].join(' ').toLowerCase();
}

function estimateRisk(item) {
  let risk = 0;
  risk += item.unresolvedDependencies.length * 10;
  risk += parsePriority(item.priority) * 2;
  risk += Number.isFinite(item.estimated) ? Math.min(item.estimated, 10) : 0;

  const text = describeItemText(item);
  if (RISK_HINT_PATTERN.test(text)) risk += 3;
  if (ANALYSIS_RISK_PATTERN.test(text)) risk += 1;
  return risk;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status ?? '').toLowerCase());
}

function recommendPipeline(item) {
  if (isTerminalStatus(item.status)) {
    return ARCHIVE_PIPELINE;
  }
  const text = describeItemText(item);
  if (ANALYSIS_PIPELINE_PATTERN.test(text)) {
    return ANALYSIS_PIPELINE;
  }
  return IMPLEMENTATION_PIPELINE;
}

function buildSearchText(item) {
  return [
    item.numericId,
    item.issueId,
    item.title,
    item.summary,
    item.status,
    item.priority,
    item.tags.join(' '),
    item.dependsOn.join(' '),
    item.filePath,
    item.body,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatDependencyNotes(items) {
  const notes = [];

  for (const item of items) {
    const notesForItem = [];
    if (item.unresolvedDependencies.length > 0) {
      notesForItem.push(`blocked by ${item.unresolvedDependencies.join(', ')}`);
    }
    if (item.missingDependencies.length > 0) {
      notesForItem.push(`missing references ${item.missingDependencies.join(', ')}`);
    }
    if (notesForItem.length > 0) {
      notes.push(`- \`${item.numericId}\` ${notesForItem.join(' · ')}`);
    }
  }

  return notes.length > 0 ? notes : ['- none'];
}

export async function loadBacklogItems(cwd) {
  const backlogDir = join(cwd, 'backlog');
  if (!existsSync(backlogDir)) {
    throw new Error('No backlog source configured. Expected a backlog/ directory.');
  }

  const entries = readdirSync(backlogDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  if (entries.length === 0) {
    throw new Error('No backlog markdown files were found in backlog/.');
  }

  const items = [];
  for (const name of entries) {
    const filePath = join(backlogDir, name);
    const { frontmatter, body } = parseFrontmatter(readFileSync(filePath, 'utf8'));
    const fileStem = name.replace(/\.md$/, '');
    const numericId = normalizeIssueId(frontmatter.id ?? fileStem) ?? normalizeIssueId(fileStem);
    if (!numericId) continue;

    const dependsOn = normalizeLinkList(frontmatter.links?.depends_on);
    const parents = normalizeLinkList(frontmatter.links?.parent);
    const tags = normalizeStringArray(frontmatter.tags).map((tag) => String(tag));
    const summary = String(frontmatter.summary ?? '').trim();
    const title = String(frontmatter.title ?? humanizeFileStem(fileStem)).trim();
    const status = String(frontmatter.status ?? 'unknown').toLowerCase();
    const priority = String(frontmatter.priority ?? 'medium').toLowerCase();
    const estimated = Number(frontmatter.estimated ?? 0);

    items.push({
      body: String(body ?? ''),
      dependsOn,
      estimated: Number.isFinite(estimated) ? estimated : 0,
      filePath,
      frontmatter,
      issueId: String(frontmatter.id ?? `wi-${numericId}`),
      missingDependencies: [],
      numericId,
      parents,
      priority,
      searchText: '',
      status,
      summary,
      tags,
      title,
      unresolvedDependencies: [],
    });
  }

  const index = new Map(items.map((item) => [item.numericId, item]));

  for (const item of items) {
    const internal = item.dependsOn.map((id) => index.get(id)).filter(Boolean);
    item.unresolvedDependencies = internal
      .filter((dependency) => !isTerminalStatus(dependency.status))
      .map((dependency) => dependency.numericId);
    item.missingDependencies = item.dependsOn.filter((id) => !index.has(id));
    item.searchText = buildSearchText(item);
    item.pipeline = recommendPipeline(item);
    item.risk = estimateRisk(item);
  }

  return items;
}

function computeDepth(item, index, memo, stack) {
  if (memo.has(item.numericId)) return memo.get(item.numericId);
  if (stack.has(item.numericId)) return 0;

  stack.add(item.numericId);
  const depth = item.unresolvedDependencies.length === 0
    ? 0
    : 1 + Math.max(
        ...item.unresolvedDependencies
          .map((dependencyId) => index.get(dependencyId))
          .filter(Boolean)
          .map((dependency) => computeDepth(dependency, index, memo, stack)),
        0,
      );
  stack.delete(item.numericId);
  memo.set(item.numericId, depth);
  return depth;
}

function getItemDepth(item) {
  return Number(item.depth ?? 0);
}

function bucketItemsByDepth(items) {
  const depthBuckets = new Map();

  for (const item of items) {
    const depth = getItemDepth(item);
    const bucket = depthBuckets.get(depth) ?? [];
    bucket.push(item);
    depthBuckets.set(depth, bucket);
  }

  return [...depthBuckets.entries()]
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .map(([, bucket]) => bucket);
}

function buildGroupsFromDepthBuckets(depthBuckets, groupCount) {
  const groups = [];
  const bucketsPerGroup = Math.ceil(depthBuckets.length / groupCount);

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const bucketSlice = depthBuckets.slice(
      groupIndex * bucketsPerGroup,
      (groupIndex + 1) * bucketsPerGroup,
    );
    if (bucketSlice.length === 0) continue;

    const items = bucketSlice.flat();
    groups.push(makeGroup({
      min: getItemDepth(items[0]),
      max: getItemDepth(items[items.length - 1]),
    }, items));
  }

  return groups;
}

function getGroupRationale(depthRange, itemCount) {
  if (itemCount === 0) {
    return 'No backlog items matched this iteration.';
  }

  if (depthRange.min === 0) {
    return 'Start with the least blocked items so later iterations inherit the clearest dependency shape.';
  }

  return 'Follow upstream dependency chains that are still blocked by earlier backlog work.';
}

function listRecommendedPipelines(items) {
  const pipelines = new Map();

  for (const item of items) {
    pipelines.set(item.pipeline, (pipelines.get(item.pipeline) ?? 0) + 1);
  }

  return [...pipelines.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pipeline]) => pipeline);
}

function makeGroup(depthRange, items) {
  const recommendedPipelines = listRecommendedPipelines(items);

  return {
    depthRange,
    items,
    rationale: getGroupRationale(depthRange, items.length),
    recommendedPipelines,
    dependencyNotes: formatDependencyNotes(items),
  };
}

export async function buildBacklogPlan(cwd, rawArgs, overrides = {}) {
  const { query, iterations, includeTerminal } = parsePlanArgs(rawArgs);
  const requestedIterations = Math.max(1, Math.floor(overrides.iterations ?? iterations));
  const shouldIncludeTerminal = Boolean(overrides.includeTerminal ?? includeTerminal);
  const allItems = await loadBacklogItems(cwd);
  const activeItems = shouldIncludeTerminal ? allItems : allItems.filter((item) => !isTerminalStatus(item.status));
  const excludedTerminalCount = allItems.length - activeItems.length;
  const queryTokens = splitCommandArgs(query).map((token) => token.toLowerCase()).filter(Boolean);
  const filtered = queryTokens.length === 0
    ? activeItems
    : activeItems.filter((item) => queryTokens.every((token) => item.searchText.includes(token)));

  const index = new Map(allItems.map((item) => [item.numericId, item]));
  const memo = new Map();
  for (const item of filtered) {
    item.depth = computeDepth(item, index, memo, new Set());
  }

  const sorted = [...filtered].sort((a, b) =>
    a.depth - b.depth ||
    a.risk - b.risk ||
    parsePriority(a.priority) - parsePriority(b.priority) ||
    a.estimated - b.estimated ||
    a.title.localeCompare(b.title) ||
    a.numericId.localeCompare(b.numericId),
  );

  if (sorted.length === 0) {
    return {
      query,
      requestedIterations,
      matchedCount: 0,
      groups: [],
      dependencyNotes: ['- none'],
      recommendedPipelines: [],
      includeTerminal: shouldIncludeTerminal,
      excludedTerminalCount,
    };
  }

  const depthBuckets = bucketItemsByDepth(sorted);
  const groupCount = Math.min(requestedIterations, Math.max(1, depthBuckets.length));
  const groups = buildGroupsFromDepthBuckets(depthBuckets, groupCount);

  const overallPipelines = [...new Set(groups.flatMap((group) => group.recommendedPipelines))];
  const dependencyNotes = formatDependencyNotes(sorted);

  return {
    query,
    requestedIterations,
    matchedCount: sorted.length,
    groups,
    dependencyNotes,
    recommendedPipelines: overallPipelines,
    includeTerminal: shouldIncludeTerminal,
    excludedTerminalCount,
  };
}

function formatTable(rows) {
  if (rows.length === 0) return '';
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index] ?? '').length)));
  return rows
    .map((row, rowIndex) => {
      const rendered = `| ${row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join(' | ')} |`;
      if (rowIndex !== 0) return rendered;
      const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
      return `${rendered}\n${separator}`;
    })
    .join('\n');
}

export function formatBacklogPlan(plan) {
  const lines = [];
  lines.push(plan.query ? `Backlog plan for query: ${JSON.stringify(plan.query)}` : 'Backlog plan for active backlog items');
  lines.push(`Requested iterations: ${plan.requestedIterations}`);
  lines.push(`Matched items: ${plan.matchedCount}`);
  if (!plan.includeTerminal && plan.excludedTerminalCount > 0) {
    lines.push(`Excluded terminal items: ${plan.excludedTerminalCount} (use --all to include)`);
  }
  lines.push('');

  if (plan.groups.length === 0) {
    lines.push('No backlog items matched this plan.');
  }

  for (let index = 0; index < plan.groups.length; index += 1) {
    const group = plan.groups[index];
    lines.push(`## Iteration ${index + 1}`);
    lines.push(`Rationale: ${group.rationale}`);
    lines.push(`Recommended pipelines: ${group.recommendedPipelines.length > 0 ? group.recommendedPipelines.join(', ') : 'none'}`);
    lines.push(formatTable([
      ['ID', 'Title', 'Status', 'Depth', 'Risk', 'Pipeline', 'Blocked by'],
      ...group.items.map((item) => [
        item.numericId,
        item.title,
        item.status,
        item.depth,
        item.risk,
        item.pipeline,
        item.unresolvedDependencies.concat(item.missingDependencies.map((id) => `missing:${id}`)).join(', ') || '-',
      ]),
    ]));

    if (index < plan.groups.length - 1) {
      lines.push('');
    }
  }

  if (plan.recommendedPipelines.length > 0) {
    lines.push('');
    lines.push(`Overall recommended pipelines: ${plan.recommendedPipelines.join(', ')}`);
  }

  if (plan.dependencyNotes.length > 0) {
    lines.push('');
    lines.push('Dependency summary:');
    lines.push(...plan.dependencyNotes);
  }

  return lines.join('\n');
}
