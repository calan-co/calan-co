import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PACKS_DIR = join(here, '..', '..', 'node_modules', '@ai-hero', 'sandcastle', 'dist', 'templates');

const AGENT_DEFS = {
  planner: { description: 'Deep-reasoning planner for dependency analysis and work selection.', maxIterations: 1, systemPrompt: 'You are the Sandcastle planner agent.' },
  worker: { description: 'Simple-loop worker that picks and closes one open task at a time.', maxIterations: 3, systemPrompt: 'You are the Sandcastle worker agent.' },
  implementer: { description: 'Implementation agent for a selected task or branch.', maxIterations: 100, systemPrompt: 'You are the Sandcastle implementer agent.' },
  reviewer: { description: 'Reviewer for branch diffs, correctness, tests, and merge blockers.', maxIterations: 1, systemPrompt: 'You are the Sandcastle reviewer agent.' },
  merger: { description: 'Merger that combines completed branches and resolves conflicts.', maxIterations: 1, systemPrompt: 'You are the Sandcastle merger agent.' },
};

const PACK_STEPS = {
  blank: [{ agent: 'worker', promptFile: 'prompt.md', maxIterations: 1 }],
  'simple-loop': [{ agent: 'worker', promptFile: 'prompt.md', maxIterations: 3 }],
  'sequential-reviewer': [
    { agent: 'implementer', promptFile: 'implement-prompt.md', maxIterations: 1 },
    { agent: 'reviewer', promptFile: 'review-prompt.md', maxIterations: 1 },
  ],
  'parallel-planner': [
    { agent: 'planner', promptFile: 'plan-prompt.md', maxIterations: 1 },
    { agent: 'implementer', promptFile: 'implement-prompt.md', maxIterations: 100 },
    { agent: 'merger', promptFile: 'merge-prompt.md', maxIterations: 1 },
  ],
  'parallel-planner-with-review': [
    { agent: 'planner', promptFile: 'plan-prompt.md', maxIterations: 1 },
    { agent: 'implementer', promptFile: 'implement-prompt.md', maxIterations: 100 },
    { agent: 'reviewer', promptFile: 'review-prompt.md', maxIterations: 1 },
    { agent: 'merger', promptFile: 'merge-prompt.md', maxIterations: 1 },
  ],
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readPrompt(packDir, promptFile) {
  const path = join(packDir, promptFile);
  return existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : '$INPUT';
}

function yamlScalar(value) {
  if (Array.isArray(value)) return `[${value.map(yamlScalar).join(', ')}]`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value ?? '');
  if (/[:#\[\],{}]|^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

function yamlBlock(text, indent = 6) {
  const pad = ' '.repeat(indent);
  return `|\n${String(text || '').split('\n').map((line) => `${pad}${line}`).join('\n')}`;
}

export function loadPipelinePacks(packsDir = DEFAULT_PACKS_DIR) {
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(packsDir, entry.name);
      const metaPath = join(dir, 'template.json');
      const meta = existsSync(metaPath) ? readJson(metaPath) : { name: entry.name, description: `${entry.name} pipeline pack` };
      const stepDefs = PACK_STEPS[meta.name] || [];
      const steps = stepDefs.map((step) => ({ ...step, prompt: readPrompt(dir, step.promptFile) }));
      return {
        name: meta.name,
        description: meta.description || `${meta.name} pipeline pack`,
        dir,
        steps,
        agents: [...new Set(steps.map((step) => step.agent))],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function packsToConfig(packs = loadPipelinePacks(), defaults = {}) {
  const defaultSandbox = defaults.defaultSandbox || 'docker';
  const defaultModel = defaults.defaultModel || 'Agent Default';
  const agents = {};
  const pipelines = {};
  for (const pack of packs) {
    for (const agentName of pack.agents) {
      const def = AGENT_DEFS[agentName] || { description: `${agentName} agent`, maxIterations: 1, systemPrompt: `You are the ${agentName} agent.` };
      agents[agentName] ||= { name: agentName, ...def, sandbox: defaultSandbox };
    }
    pipelines[pack.name] = {
      description: `Sandcastle ${pack.name} template: ${pack.description}`,
      branchStrategy: pack.name === 'simple-loop' || pack.name === 'blank'
        ? { type: 'merge-to-head' }
        : { type: 'branch', branch: `sandcastle/${pack.name}` },
      sandbox: defaultSandbox,
      model: defaultModel,
      copyToWorktree: ['node_modules'],
      steps: pack.steps.map((step) => ({ agent: step.agent, prompt: step.prompt, maxIterations: step.maxIterations || 1 })),
    };
  }
  return {
    defaultSandbox,
    defaultModel,
    defaultPipeline: defaults.defaultPipeline || 'simple-loop',
    defaultAgent: defaults.defaultAgent || 'claude-code',
    issueTracker: defaults.issueTracker || 'github-issues',
    issueTrackerSetupCommand: defaults.issueTrackerSetupCommand,
    imageNamePattern: defaults.imageNamePattern || 'sandcastle:<repo-dir-name>',
    agents,
    chains: {},
    pipelines,
  };
}

export function configToYaml(config) {
  const lines = [
    '# Pi Sandcastle delegation config.',
    '# Pipeline and agent inventory is derived from Sandcastle pipeline packs.',
    '',
    `defaultSandbox: ${yamlScalar(config.defaultSandbox)}`,
    `defaultModel: ${yamlScalar(config.defaultModel)}`,
    `defaultPipeline: ${yamlScalar(config.defaultPipeline)}`,
    `defaultAgent: ${yamlScalar(config.defaultAgent)}`,
    `issueTracker: ${yamlScalar(config.issueTracker)}`,
    ...(config.issueTrackerSetupCommand ? [`issueTrackerSetupCommand: ${yamlScalar(config.issueTrackerSetupCommand)}`] : []),
    `imageNamePattern: ${yamlScalar(config.imageNamePattern || 'sandcastle:<repo-dir-name>')}`,
    '',
    'agents:',
  ];
  for (const [name, agent] of Object.entries(config.agents)) {
    lines.push(`  ${name}:`);
    for (const key of ['description', 'model', 'sandbox', 'maxIterations', 'branch']) {
      if (agent[key] !== undefined) lines.push(`    ${key}: ${yamlScalar(agent[key])}`);
    }
    if (agent.systemPrompt) lines.push(`    systemPrompt: ${yamlBlock(agent.systemPrompt, 6)}`);
  }
  lines.push('', 'pipelines:');
  for (const [name, pipeline] of Object.entries(config.pipelines)) {
    lines.push(`  ${name}:`, `    description: ${yamlScalar(pipeline.description)}`, '    branchStrategy:');
    for (const [key, value] of Object.entries(pipeline.branchStrategy || {})) lines.push(`      ${key}: ${yamlScalar(value)}`);
    lines.push(`    sandbox: ${yamlScalar(pipeline.sandbox)}`, `    model: ${yamlScalar(pipeline.model)}`, `    copyToWorktree: ${yamlScalar(pipeline.copyToWorktree || [])}`, '    steps:');
    for (const step of pipeline.steps || []) {
      lines.push(`      - agent: ${yamlScalar(step.agent)}`, `        prompt: ${yamlBlock(step.prompt, 10)}`);
      if (step.maxIterations !== undefined) lines.push(`        maxIterations: ${yamlScalar(step.maxIterations)}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

export function buildDefaultConfigText(defaults = {}) {
  const cfg = packsToConfig(undefined, defaults);
  return [
    '# Pi Sandcastle delegation config.',
    '# Pipeline and agent inventory is derived from Sandcastle pipeline packs.',
    '',
    `defaultSandbox: ${yamlScalar(cfg.defaultSandbox)}`,
    `defaultModel: ${yamlScalar(cfg.defaultModel)}`,
    `defaultPipeline: ${yamlScalar(cfg.defaultPipeline)}`,
    `defaultAgent: ${yamlScalar(cfg.defaultAgent)}`,
    `issueTracker: ${yamlScalar(cfg.issueTracker)}`,
    ...(cfg.issueTrackerSetupCommand ? [`issueTrackerSetupCommand: ${yamlScalar(cfg.issueTrackerSetupCommand)}`] : []),
    `imageNamePattern: ${yamlScalar(cfg.imageNamePattern || 'sandcastle:<repo-dir-name>')}`,
    '',
  ].join('\n');
}
