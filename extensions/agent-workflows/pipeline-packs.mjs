import { runtimeToSandcastleConfig, loadExecutionRuntimePack, listRuntimePipelines } from './execution-runtime.ts';

function yamlScalar(value) {
  if (Array.isArray(value)) return `[${value.map(yamlScalar).join(', ')}]`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value ?? '');
  if (/[:#\[\],{}]|^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

function yamlModelScalar(value) {
  return yamlScalar(value ?? 'Agent Default');
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
    '# Agent Workflows config.',
    '# Runtime config for Work execution.',
    '',
    'runtimeVersion: 1',
    `defaultSandbox: ${yamlScalar(config.defaultSandbox)}`,
    `defaultModel: ${yamlModelScalar(config.defaultModel)}`,
    `defaultPipeline: ${yamlScalar(config.defaultPipeline)}`,
    `defaultAgent: ${yamlScalar(config.defaultAgent)}`,
    `maxWorkers: ${yamlScalar(config.maxWorkers || 5)}`,
    `maxIterations: ${yamlScalar(config.maxIterations || 10)}`,
    `workSource: ${yamlScalar(config.workSource || config.issueTracker)}`,
    ...(config.workSourceSetupCommand || config.issueTrackerSetupCommand ? [`workSourceSetupCommand: ${yamlScalar(config.workSourceSetupCommand || config.issueTrackerSetupCommand)}`] : []),
    `imageNamePattern: ${yamlScalar(config.imageNamePattern || 'sandcastle:<repo-dir-name>')}`,
    '',
    'roles:',
  ];
  for (const [name, agent] of Object.entries(config.agents)) {
    lines.push(`  ${name}:`);
    for (const key of ['description', 'kind', 'provider', 'model', 'maxIterations', 'branch']) {
      if (agent[key] !== undefined) lines.push(`    ${key}: ${yamlScalar(agent[key])}`);
    }
    if (agent.systemPrompt) lines.push(`    systemPrompt: ${yamlBlock(agent.systemPrompt, 6)}`);
  }
  lines.push('', 'prompts:');
  for (const [name, prompt] of Object.entries(config.prompts || {})) {
    lines.push(`  ${name}:`);
    if (prompt.format !== undefined) lines.push(`    format: ${yamlScalar(prompt.format)}`);
    if (prompt.template !== undefined) lines.push(`    template: ${yamlBlock(prompt.template, 6)}`);
  }
  if (Object.keys(config.chains || {}).length) {
    lines.push('', 'chains:');
    for (const [name, steps] of Object.entries(config.chains || {})) {
      lines.push(`  ${name}:`);
      for (const step of steps || []) {
        lines.push(`    - role: ${yamlScalar(step.role)}`, `      prompt: ${yamlBlock(step.prompt || '', 6)}`);
      }
    }
  }
  lines.push('', 'pipelines:');
  for (const [name, pipeline] of Object.entries(config.pipelines)) {
    lines.push(`  ${name}:`, `    description: ${yamlScalar(pipeline.description)}`, '    branchStrategy:');
    for (const [key, value] of Object.entries(pipeline.branchStrategy || {})) lines.push(`      ${key}: ${yamlScalar(value)}`);
    if (pipeline.sandbox !== undefined) lines.push(`    sandbox: ${yamlScalar(pipeline.sandbox)}`);
    lines.push(`    model: ${yamlScalar(pipeline.model)}`, `    copyToWorktree: ${yamlScalar(pipeline.copyToWorktree || [])}`, '    steps:');
    for (const step of pipeline.steps || []) {
      lines.push(`      - kind: ${yamlScalar(step.kind || 'runRole')}`, `        role: ${yamlScalar(step.role)}`);
      if (step.description !== undefined) lines.push(`        description: ${yamlScalar(step.description)}`);
      lines.push(`        prompt: ${yamlScalar(step.prompt)}`);
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
    '# Agent Workflows config.',
    '# Runtime inventory is compiled from extensions/agent-workflows/runtime-packs/sandcastle-templates.json.',
    '',
    'runtimeVersion: 1',
    `defaultSandbox: ${yamlScalar(cfg.defaultSandbox)}`,
    `defaultModel: ${yamlModelScalar(cfg.defaultModel)}`,
    `defaultPipeline: ${yamlScalar(cfg.defaultPipeline)}`,
    `defaultAgent: ${yamlScalar(cfg.defaultAgent)}`,
    `maxWorkers: ${yamlScalar(cfg.maxWorkers || 5)}`,
    `maxIterations: ${yamlScalar(cfg.maxIterations || 10)}`,
    `workSource: ${yamlScalar(cfg.workSource || cfg.issueTracker)}`,
    ...(cfg.workSourceSetupCommand || cfg.issueTrackerSetupCommand ? [`workSourceSetupCommand: ${yamlScalar(cfg.workSourceSetupCommand || cfg.issueTrackerSetupCommand)}`] : []),
    `imageNamePattern: ${yamlScalar(cfg.imageNamePattern || 'sandcastle:<repo-dir-name>')}`,
    '',
  ].join('\n');
}
