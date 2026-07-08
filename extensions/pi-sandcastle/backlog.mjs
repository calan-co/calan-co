import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync, readdirSync as nodeReaddirSync, statSync as nodeStatSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const DEFAULT_SOURCE_DIRS = ["backlog"];
const PRD_REFERENCE_PATH = "docs/prd/sandcastle-backlog-processing.md";

function toText(value) {
  return String(value ?? "").trim();
}

function slugify(value) {
  return toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseScalar(raw) {
  const value = toText(raw);
  if (!value) return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value.replace(/^['"]|['"]$/g, "");
}

function countIndent(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function isSkippableLine(line) {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith("#");
}

function nextContentLine(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i++) {
    if (!isSkippableLine(lines[i])) return i;
  }
  return -1;
}

function parseNestedValue(lines, startIndex, parentIndent) {
  const nestedIndex = nextContentLine(lines, startIndex);
  if (nestedIndex === -1 || countIndent(lines[nestedIndex]) <= parentIndent) {
    return null;
  }

  const nestedIndent = countIndent(lines[nestedIndex]);
  const parser = lines[nestedIndex].trim().startsWith("- ") ? parseArray : parseObject;
  return parser(lines, nestedIndex, nestedIndent);
}

function parseArray(lines, startIndex, indent) {
  const values = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    if (isSkippableLine(line)) {
      i++;
      continue;
    }

    const lineIndent = countIndent(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      i++;
      continue;
    }

    const trimmed = line.slice(indent).trimEnd();
    if (!trimmed.startsWith("- ")) break;

    const entry = trimmed.slice(2).trim();
    if (!entry) {
      const nested = parseNestedValue(lines, i + 1, indent);
      if (!nested) {
        values.push("");
        i++;
        continue;
      }
      values.push(nested.value);
      i = nested.nextIndex;
      continue;
    }

    values.push(parseScalar(entry));
    i++;
  }

  return { value: values, nextIndex: i };
}

function parseObject(lines, startIndex, indent) {
  const value = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    if (isSkippableLine(line)) {
      i++;
      continue;
    }

    const lineIndent = countIndent(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      i++;
      continue;
    }

    const trimmed = line.slice(indent);
    const match = trimmed.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    const rawValue = match[2] ?? "";
    if (rawValue !== "") {
      value[key] = parseScalar(rawValue);
      i++;
      continue;
    }

    const nested = parseNestedValue(lines, i + 1, indent);
    if (!nested) {
      value[key] = "";
      i++;
      continue;
    }

    value[key] = nested.value;
    i = nested.nextIndex;
  }

  return { value, nextIndex: i };
}

function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r/g, "");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return { frontmatter: {}, body: normalized };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return { frontmatter: {}, body: normalized };

  const frontmatterBlock = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  const frontmatterLines = frontmatterBlock.split("\n");
  const parsed = parseObject(frontmatterLines, 0, 0).value;
  return { frontmatter: parsed, body };
}

function captureSection(body, heading) {
  const pattern = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |\\s*$)`, "m");
  return body.match(pattern)?.[1].trim() ?? "";
}

function captureChecklistItems(sectionText) {
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\- \[[ x]\] /.test(line))
    .map((line) => line.replace(/^\- \[[ x]\] /, ""));
}

function captureBulletItems(sectionText) {
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function asStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => toText(entry)).filter(Boolean);
  return [toText(value)].filter(Boolean);
}

function collectFiles(fs, path, sourceRoot) {
  if (!fs.existsSync(sourceRoot)) return [];

  const stat = fs.statSync(sourceRoot);
  if (stat.isFile()) return sourceRoot.endsWith(".md") ? [sourceRoot] : [];
  if (!stat.isDirectory()) return [];

  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(sourceRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fs, path, child));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(child);
    }
  }
  return files;
}

function resolveSourceRoots({ cwd, path, sources = DEFAULT_SOURCE_DIRS }) {
  const roots = sources
    .map((source) => (path.isAbsolute(source) ? source : path.resolve(cwd, source)))
    .filter(Boolean);
  return roots;
}

function resolveFileTarget({ cwd, path, target, itemsByPath }) {
  const candidate = path.isAbsolute(target) ? target : path.resolve(cwd, target);
  if (itemsByPath.has(candidate)) return candidate;
  const fileName = path.basename(candidate);
  const fallback = path.join(cwd, fileName);
  if (itemsByPath.has(fallback)) return fallback;
  return candidate;
}

function linkTargetToReference(link) {
  const clean = toText(link).replace(/^\[\[|\]\]$/g, "");
  if (!clean) return "";
  if (clean === "sandcastle-backlog-processing" || clean.endsWith("/sandcastle-backlog-processing")) {
    return PRD_REFERENCE_PATH;
  }
  if (/^\d{5}-/.test(clean)) return `backlog/${clean}.md`;
  return clean;
}

function normalizeTarget(value) {
  return toText(value).replace(/^#/, "");
}

function unique(values) {
  return values.filter((value, index, array) => array.indexOf(value) === index);
}

function parseBacklogItem(fs, path, filePath, cwd) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const relativePath = path.relative(cwd, filePath);
  const id = toText(frontmatter.id) || `wi-${path.basename(filePath, ".md").split("-")[0]}`;
  const numericId = id.match(/\d{5}/)?.[0] || path.basename(filePath).match(/^(\d{5})-/)?.[1] || "";
  const title = toText(frontmatter.title) || path.basename(filePath, ".md");
  const summary = toText(frontmatter.summary) || captureSection(body, "Goal") || captureSection(body, "Background");
  const tags = asStringList(frontmatter.tags);
  const links = frontmatter.links || {};
  const dependsOn = asStringList(links.depends_on);
  const references = asStringList(links.reference);
  const parents = asStringList(links.parent);
  const goal = captureSection(body, "Goal");
  const background = captureSection(body, "Background");
  const tasks = captureChecklistItems(captureSection(body, "Tasks"));
  const deliverables = captureBulletItems(captureSection(body, "Deliverables"));
  const acceptanceCriteria = captureChecklistItems(captureSection(body, "Acceptance Criteria"));
  const searchable = [
    id,
    numericId,
    title,
    summary,
    tags.join(" "),
    dependsOn.join(" "),
    references.join(" "),
    parents.join(" "),
    goal,
    background,
    tasks.join(" "),
    deliverables.join(" "),
    acceptanceCriteria.join(" "),
    relativePath,
  ]
    .join("\n")
    .toLowerCase();

  return {
    id,
    numericId,
    title,
    titleSlug: slugify(title),
    summary,
    tags,
    status: toText(frontmatter.status),
    priority: toText(frontmatter.priority),
    estimated: Number(frontmatter.estimated || 0),
    type: toText(frontmatter.type),
    subtype: toText(frontmatter.subtype),
    lifecycle: toText(frontmatter.lifecycle),
    statusReason: toText(frontmatter.status_reason),
    filePath,
    relativePath,
    goal,
    background,
    tasks,
    deliverables,
    acceptanceCriteria,
    dependsOn,
    references,
    parents,
    searchable,
  };
}

function discoverBacklogItems(fs, path, cwd, sources) {
  const resolvedRoots = resolveSourceRoots({ cwd, path, sources });
  if (resolvedRoots.length === 0) {
    throw new Error("No backlog source configured. Provide at least one backlog directory.");
  }

  const roots = resolvedRoots.filter((root) => fs.existsSync(root));
  if (roots.length === 0) {
    throw new Error(`No backlog source configured. Missing sources: ${resolvedRoots.map((root) => path.relative(cwd, root) || root).join(", ")}`);
  }

  const files = [];
  for (const root of roots) files.push(...collectFiles(fs, path, root));

  return files
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => parseBacklogItem(fs, path, filePath, cwd));
}

function comparePriority(left, right) {
  const rank = { high: 0, medium: 1, low: 2 };
  const leftRank = rank[left.priority] ?? 9;
  const rightRank = rank[right.priority] ?? 9;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.estimated !== right.estimated) return left.estimated - right.estimated;
  return left.id.localeCompare(right.id);
}

function matchesQuery(item, query) {
  const normalized = normalizeTarget(query).toLowerCase();
  if (!normalized) return true;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return terms.every((term) => item.searchable.includes(term));
}

function itemMatchesTarget(item, path, target) {
  return (
    item.id.toLowerCase() === target ||
    item.numericId === target ||
    item.titleSlug === target ||
    item.relativePath.toLowerCase() === target ||
    item.filePath.toLowerCase() === target ||
    path.basename(item.filePath).toLowerCase() === target
  );
}

function resolveBacklogItem(items, path, cwd, target) {
  const normalized = normalizeTarget(target);
  if (!normalized) return null;

  const lowered = normalized.toLowerCase();
  const byExact = items.find((item) => itemMatchesTarget(item, path, lowered));
  if (byExact) return byExact;

  const resolvedPath = resolveFileTarget({
    cwd,
    path,
    target: normalized,
    itemsByPath: new Map(items.map((item) => [item.filePath, item])),
  });
  const byPath = items.find((item) => item.filePath === resolvedPath);
  if (byPath) return byPath;

  return items.find((item) => item.title.toLowerCase() === lowered);
}

function dependencyMatchesPath(item, cwd, path, target) {
  const candidate = linkTargetToReference(target);
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
  return itemMatchesTarget(item, path, candidate.toLowerCase()) || item.filePath.toLowerCase() === absolute.toLowerCase();
}

function deriveDependencyState(item, items, cwd, path) {
  const missing = item.dependsOn.filter((dep) => !items.some((candidate) => dependencyMatchesPath(candidate, cwd, path, dep)));
  if (item.dependsOn.length === 0) {
    return { status: "ready", dependencies: [] };
  }
  if (missing.length > 0) {
    return { status: "blocked", dependencies: item.dependsOn, missing };
  }
  return { status: "has-dependencies", dependencies: item.dependsOn, missing: [] };
}

function deriveRecommendedPipeline(item) {
  const tags = new Set(item.tags.map((tag) => tag.toLowerCase()));
  if (tags.has("documentation")) return { name: "docs-review", rationale: "Documentation work is best handled as reviewable doc changes." };
  if (tags.has("planning") || tags.has("next")) return { name: "plan", rationale: "Planning work should stay ephemeral and read-only." };
  if (tags.has("process") || tags.has("pipeline")) return { name: "implement", rationale: "Process items are execution-oriented and should use the implementation pipeline." };
  if (tags.has("runs") || tags.has("resume")) return { name: "run-management", rationale: "Run management items align with stateful run tooling." };
  if (tags.has("inspect") || tags.has("readonly")) return { name: "research-review", rationale: "Read-only discovery work should use research before review." };
  return { name: "research-review", rationale: "Default to read-only discovery for backlog inspection." };
}

function deriveRisks(item) {
  const risks = [];
  if (item.dependsOn.length > 0) {
    risks.push(`Upstream dependencies must stay read-only until ${item.dependsOn.join(", ")} are handled.`);
  }
  risks.push("Command behavior must not create durable selection or run records.");
  if (item.tags.some((tag) => /readonly|inspect/.test(tag))) {
    risks.push("A helper that writes state would violate the read-only contract.");
  }
  return risks;
}

function deriveTestingNotes(item) {
  const notes = [
    "Use a fake filesystem and fail the test if any write method is invoked.",
    "Cover missing-source and missing-item errors with deterministic fixtures.",
  ];
  if (item.tags.includes("backlog")) {
    notes.push("Assert deterministic ordering across multiple backlog files.");
  }
  return notes;
}

function deriveRelevantFiles(item) {
  return unique([
    item.relativePath,
    ...item.dependsOn.map((dep) => linkTargetToReference(dep)),
    ...item.references.map((ref) => linkTargetToReference(ref)),
    ...item.parents.map((parent) => linkTargetToReference(parent)),
  ].filter(Boolean));
}

function formatListResult(items) {
  if (items.length === 0) return "No backlog items matched the query.";

  const lines = ["Matching backlog items:"];
  for (const item of items) {
    const dependencyNote = item.dependsOn.length ? ` dependencies=${item.dependsOn.join(", ")}` : "";
    lines.push(
      `- ${item.id} ${item.title} [${item.priority || "unknown"}]${dependencyNote}`,
    );
    lines.push(`  summary: ${item.summary}`);
    lines.push(`  file: ${item.relativePath}`);
  }
  return lines.join("\n");
}

function formatInspectResult(item, { dependencyState, recommendedPipeline, risks, testingNotes, relevantFiles }) {
  const lines = [
    `${item.id} ${item.title}`,
    `summary: ${item.summary}`,
    `status: ${item.status || "unknown"} | priority: ${item.priority || "unknown"} | estimated: ${item.estimated || "n/a"}`,
    `dependency state: ${dependencyState.status}${dependencyState.dependencies.length ? ` (${dependencyState.dependencies.join(", ")})` : ""}`,
    `risks:`,
    ...risks.map((risk) => `- ${risk}`),
    `relevant files:`,
    ...relevantFiles.map((file) => `- ${file}`),
    `testing notes:`,
    ...testingNotes.map((note) => `- ${note}`),
    `recommended pipeline: ${recommendedPipeline.name}`,
    `rationale: ${recommendedPipeline.rationale}`,
  ];
  return lines.join("\n");
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function createBacklogCommandHandler(runCommand, capabilityFactory) {
  return async (args, ctx) => {
    try {
      const capability = capabilityFactory(ctx.cwd);
      const result = await runCommand(capability, args.trim());
      ctx.ui.notify(result.text, "info");
    } catch (error) {
      ctx.ui.notify(describeError(error), "error");
    }
  };
}

export function createBacklogCapability({
  cwd,
  fs = {
    existsSync: nodeExistsSync,
    readFileSync: nodeReadFileSync,
    readdirSync: nodeReaddirSync,
    statSync: nodeStatSync,
  },
  path = { basename, isAbsolute, join, relative, resolve },
  sources = DEFAULT_SOURCE_DIRS,
} = {}) {
  if (!cwd) throw new Error("Backlog capability requires a cwd.");

  function loadItems() {
    return discoverBacklogItems(fs, path, cwd, sources);
  }

  return {
    async list(query = "") {
      const items = loadItems().filter((item) => matchesQuery(item, query)).sort(comparePriority);
      return {
        query: toText(query),
        items,
        text: formatListResult(items),
      };
    },

    async inspect(target) {
      const items = loadItems();
      const resolved = resolveBacklogItem(items, path, cwd, target);
      if (!resolved) {
        throw new Error(`No backlog item matched '${toText(target)}'.`);
      }

      const dependencyState = deriveDependencyState(resolved, items, cwd, path);
      const recommendedPipeline = deriveRecommendedPipeline(resolved);
      const risks = deriveRisks(resolved);
      const testingNotes = deriveTestingNotes(resolved);
      const relevantFiles = deriveRelevantFiles(resolved);

      return {
        item: resolved,
        dependencyState,
        recommendedPipeline,
        risks,
        testingNotes,
        relevantFiles,
        analysis: `Read-only backlog item with ${resolved.dependsOn.length} dependent link(s).`,
        text: formatInspectResult(resolved, {
          dependencyState,
          recommendedPipeline,
          risks,
          testingNotes,
          relevantFiles,
        }),
      };
    },
  };
}

export function registerBacklogCommands(pi, { capabilityFactory = (cwd) => createBacklogCapability({ cwd }) } = {}) {
  pi.registerCommand("backlog:list", {
    description: "List read-only backlog items",
    handler: createBacklogCommandHandler((capability, args) => capability.list(args), capabilityFactory),
  });

  pi.registerCommand("backlog:inspect", {
    description: "Inspect a backlog item without mutating backlog state",
    handler: createBacklogCommandHandler((capability, args) => capability.inspect(args), capabilityFactory),
  });
}
