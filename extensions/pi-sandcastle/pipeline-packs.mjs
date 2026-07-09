import { runtimeToSandcastleConfig, loadExecutionRuntimePack, listRuntimePipelines } from './execution-runtime.ts';

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

export function loadPipelinePacks() {
  return listRuntimePipelines(loadExecutionRuntimePack()).map((pipeline) => ({
    name: pipeline.name,
    description: pipeline.description,
    runtime: true,
  }));
}

export function packsToConfig(_packs = undefined, defaults = {}) {
  return runtimeToSandcastleConfig(loadExecutionRuntimePack(), defaults);
}

export function configToYaml(config) {
  const lines = [
    '# Pi Sandcastle delegation config.',
    '# Agent and pipeline inventory is compiled from the Pi-Sandcastle execution runtime pack.',
    '',
    `defaultSandbox: ${yamlScalar(config.defaultSandbox)}`,
    `defaultModel: ${yamlScalar(config.defaultModel)}`,
    `defaultPipeline: ${yamlScalar(config.defaultPipeline)}`,
    `defaultAgent: ${yamlScalar(config.defaultAgent)}`,
    `issueTracker: ${yamlScalar(config.issueTracker)}`,
    ...(config.issueTrackerSetupCommand ? [`issueTrackerSetupCommand: ${yamlScalar(config.issueTrackerSetupCommand)}`] : []),
    `imageNamePattern: ${yamlScalar(config.imageNamePattern || 'sandcastle:<repo-dir-name>')}`,
    '',
    'roles:',
  ];
  for (const [name, agent] of Object.entries(config.agents)) {
    lines.push(`  ${name}:`);
    for (const key of ['description', 'provider', 'model', 'maxIterations', 'branch']) {
      if (agent[key] !== undefined) lines.push(`    ${key}: ${yamlScalar(agent[key])}`);
    }
    if (agent.systemPrompt) lines.push(`    systemPrompt: ${yamlBlock(agent.systemPrompt, 6)}`);
  }
  lines.push('', 'pipelines:');
  for (const [name, pipeline] of Object.entries(config.pipelines)) {
    lines.push(`  ${name}:`, `    description: ${yamlScalar(pipeline.description)}`, '    branchStrategy:');
    for (const [key, value] of Object.entries(pipeline.branchStrategy || {})) lines.push(`      ${key}: ${yamlScalar(value)}`);
    if (pipeline.sandbox !== undefined) lines.push(`    sandbox: ${yamlScalar(pipeline.sandbox)}`);
    lines.push(`    model: ${yamlScalar(pipeline.model)}`, `    copyToWorktree: ${yamlScalar(pipeline.copyToWorktree || [])}`, '    steps:');
    for (const step of pipeline.steps || []) {
      lines.push(`      - role: ${yamlScalar(step.role)}`, `        prompt: ${yamlBlock(step.prompt, 10)}`);
      if (step.maxIterations !== undefined) lines.push(`        maxIterations: ${yamlScalar(step.maxIterations)}`);
      if (step.copyToWorktree !== undefined) lines.push(`        copyToWorktree: ${yamlScalar(step.copyToWorktree)}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

export function buildDefaultConfigText(defaults = {}) {
  const cfg = packsToConfig(undefined, defaults);
  return [
    '# Pi Sandcastle delegation config.',
    '# Runtime inventory is compiled from extensions/pi-sandcastle/runtime-packs/sandcastle-templates.json.',
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
