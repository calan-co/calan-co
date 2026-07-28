import { spawn } from 'node:child_process';

function tokenizeCommand(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(value || ''))) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function renderTemplate(template, context) {
  return String(template).replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    if (key === 'id' || key === 'itemId') return context.itemId;
    if (key === 'cwd') return context.cwd || '';
    if (key === 'runId') return context.runId || '';
    return String(context[key] ?? '');
  });
}

function defaultRunCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => resolve({ status: 1, stdout, stderr: error.message }));
    child.on('close', (status) => resolve({ status: status ?? 0, stdout, stderr }));
  });
}

function commandSpec(template, fallback, context) {
  const rendered = renderTemplate(template || fallback, context);
  const [command, ...args] = tokenizeCommand(rendered);
  if (!command) throw new Error('Work Source command template produced an empty command');
  return { command, args, rendered };
}

async function runMutation(action, template, fallback, context, runCommand) {
  const spec = commandSpec(template, fallback, context);
  const result = await runCommand(spec.command, spec.args, { cwd: context.cwd, action, itemId: context.itemId, runId: context.runId, command: spec.rendered });
  const status = Number(result?.status ?? 0);
  const normalized = { status, stdout: String(result?.stdout || ''), stderr: String(result?.stderr || ''), command: spec.rendered };
  if (status !== 0) {
    const error = new Error(`${action} Work Item ${context.itemId} failed: ${(normalized.stderr || normalized.stdout || spec.rendered).trim()}`);
    error.result = normalized;
    throw error;
  }
  return normalized;
}

export function createDocVaderWorkSourceAdapter(options = {}) {
  const runCommand = options.runCommand || defaultRunCommand;
  const validateCommand = options.validateCommand || process.env.DV_SANDCASTLE_VALIDATE_COMMAND || 'dv work validate {{ id }}';
  const closeCommand = options.closeCommand || process.env.DV_SANDCASTLE_CLOSE_COMMAND || 'dv work close {{ id }}';
  return {
    kind: 'doc-vader',
    capabilities: ['work-source:doc-vader', 'work.validate', 'work.close'],
    async validate(input) {
      return runMutation('validate', validateCommand, 'dv work validate {{ id }}', input, runCommand);
    },
    async close(input) {
      return runMutation('close', closeCommand, 'dv work close {{ id }}', input, runCommand);
    },
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nodeBranch(result) {
  return typeof result?.branch === 'string' && result.branch.length ? result.branch : undefined;
}

function isAcceptedReviewText(value) {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (!text.trim()) return undefined;
  if (/\b(reject(?:ed)?|request changes|changes requested|blocker|blocked|do not merge|not accepted|fail(?:ed)?)\b/.test(text)) return false;
  if (/\b(accept(?:ed)?|approved?|approve|no blockers?|safe to merge|looks good|pass(?:ed)?)\b/.test(text)) return true;
  return undefined;
}

function collectAcceptedReviewBranches(result, accepted = new Set()) {
  if (!isRecord(result)) return accepted;
  if (result.type === 'WorkspaceResult') {
    const branch = nodeBranch(result);
    const verdicts = Object.values(result.children || {}).map((child) => isAcceptedReviewText(child?.stdout ?? child?.output));
    if (branch && verdicts.some((verdict) => verdict === true) && !verdicts.some((verdict) => verdict === false)) accepted.add(branch);
    return accepted;
  }
  if (result.type === 'LoopResult') for (const child of result.iterations || []) collectAcceptedReviewBranches(child, accepted);
  if (result.type === 'CompositeResult') for (const child of Object.values(result.children || {})) collectAcceptedReviewBranches(child, accepted);
  return accepted;
}

function collectWorkspaceBranches(result, branches = new Set()) {
  if (!isRecord(result)) return branches;
  if (result.type === 'WorkspaceResult') {
    const branch = nodeBranch(result);
    const effects = Array.isArray(result.effects) ? result.effects : [];
    const commits = Array.isArray(result.commits) ? result.commits : [];
    if (branch && (effects.length || commits.length)) branches.add(branch);
    return branches;
  }
  if (result.type === 'LoopResult') {
    for (const child of result.mergeableResults || result.iterations || []) collectWorkspaceBranches(child, branches);
  }
  if (result.type === 'CompositeResult') for (const child of Object.values(result.children || {})) collectWorkspaceBranches(child, branches);
  return branches;
}

function selectedBranchesForMerge(context) {
  const needs = context.runtime?.needs || {};
  let branches = new Set();
  const inputNames = Array.isArray(context.node?.definition?.inputs) ? context.node.definition.inputs : Object.keys(needs);
  for (const inputName of inputNames) collectWorkspaceBranches(needs[inputName], branches);
  if (context.node?.definition?.strategy === 'accepted-only' && needs.review) {
    const accepted = collectAcceptedReviewBranches(needs.review);
    branches = new Set([...branches].filter((branch) => accepted.has(branch)));
  }
  return branches;
}

function workItemsByBranch(context, branches) {
  const input = context.global?.input || {};
  const items = Array.isArray(input.items) ? input.items : [];
  const contexts = Array.isArray(input.executionContexts) ? input.executionContexts : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  return contexts
    .filter((entry) => branches.has(entry.branch))
    .map((entry) => itemById.get(entry.itemId) || { id: entry.itemId })
    .filter((item) => item?.id);
}

function mutationContext(context, item) {
  const runtime = context.runtime || {};
  return {
    itemId: item.id,
    cwd: String(runtime.cwd || ''),
    runId: String(runtime.runId || ''),
    pipeline: String(runtime.pipeline || ''),
    recordPath: String(runtime.recordPath || ''),
    item,
  };
}

function recordMutation(context, itemId, action, status, message) {
  const work = context.work || (context.work = {});
  if (!Array.isArray(work.mutations)) work.mutations = [];
  work.mutations.push({ itemId, action, status, ...(message ? { message } : {}) });
}

export function createDocVaderWorkSourceHooks(options = {}) {
  const adapter = options.adapter || createDocVaderWorkSourceAdapter(options);
  return [
    {
      id: 'doc-vader.validate-before-merge',
      phase: 'beforeNode',
      order: -10,
      capabilities: ['node.kind:git.merge', 'work.merge'],
      async run(context) {
        if (context.node?.kind !== 'git.merge') return;
        const items = workItemsByBranch(context, selectedBranchesForMerge(context));
        for (const item of items) {
          try {
            await adapter.validate(mutationContext(context, item));
            recordMutation(context, item.id, 'validate', 'succeeded');
          } catch (error) {
            recordMutation(context, item.id, 'validate', 'failed', error instanceof Error ? error.message : String(error));
            throw error;
          }
        }
      },
    },
    {
      id: 'doc-vader.close-after-merge',
      phase: 'afterNode',
      order: 10,
      capabilities: ['node.kind:git.merge', 'work.merge'],
      async run(context) {
        if (context.node?.kind !== 'git.merge') return;
        const mergedBranches = new Set(Array.isArray(context.runtime?.result?.mergedBranches) ? context.runtime.result.mergedBranches : []);
        const items = workItemsByBranch(context, mergedBranches);
        for (const item of items) {
          try {
            await adapter.close(mutationContext(context, item));
            recordMutation(context, item.id, 'close', 'succeeded');
          } catch (error) {
            recordMutation(context, item.id, 'close', 'failed', error instanceof Error ? error.message : String(error));
            throw error;
          }
        }
      },
    },
  ];
}
