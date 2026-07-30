import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import agentWorkflows, { parseSimpleYaml } from '../extensions/agent-workflows/index.ts';
import { configToYaml } from '../extensions/agent-workflows/pipeline-packs.mjs';
import { ConfigShadowModel } from '../extensions/agent-workflows/config-shadow-model.ts';

function createFakePi() {
  const commands = new Map();
  return {
    commands,
    on() {},
    registerCommand(name, spec) {
      commands.set(name, spec.handler);
    },
    registerTool() {},
  };
}

const compositeYaml = () => [
  'roles:',
  '  implementer:',
  '    description: Implementer',
  '  reviewer:',
  '    description: Reviewer',
  '',
  'pipelines:',
  '  issue-work:',
  '    description: Composite issue workflow.',
  '    kind: composite',
  '    nodes:',
  '      each-item:',
  '        kind: loop',
  '        each: work.items',
  '        mode: parallel',
  '        max: 2',
  '        nodes:',
  '          workspace:',
  '            kind: git.worktree',
  '            nodes:',
  '              implement:',
  '                kind: agent.pi',
  '                role: implementer',
  '                prompt: implement-work',
  '              review:',
  '                kind: agent.pi',
  '                needs: [implement]',
  '                role: reviewer',
  '                prompt: review-work',
  '      merge:',
  '        kind: git.merge',
  '        needs: [each-item]',
].join('\n');

test('parseSimpleYaml supports composite pipeline map-form nodes', () => {
  const parsed = parseSimpleYaml(compositeYaml());

  assert.equal(parsed.pipelines['issue-work'].kind, 'composite');
  assert.deepEqual(Object.keys(parsed.pipelines['issue-work'].nodes), ['each-item', 'merge']);
  assert.equal(parsed.pipelines['issue-work'].nodes['each-item'].kind, 'loop');
  assert.equal(parsed.pipelines['issue-work'].nodes['each-item'].each, 'work.items');
  assert.equal(parsed.pipelines['issue-work'].nodes['each-item'].max, 2);
  assert.equal(parsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.kind, 'git.worktree');
  assert.equal(parsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.implement.role, 'implementer');
  assert.deepEqual(parsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.review.needs, ['implement']);
  assert.equal(parsed.pipelines['issue-work'].nodes.merge.kind, 'git.merge');
  assert.deepEqual(parsed.pipelines['issue-work'].nodes.merge.needs, ['each-item']);
});

test('configToYaml round-trips reserved $ref meta nodes', () => {
  const parsed = parseSimpleYaml([
    'roles:',
    '  worker:',
    '    description: Worker',
    'pipelines:',
    '  waves:',
    '    kind: composite',
    '    nodes:',
    '      work:',
    '        kind: loop',
    '        max: 2',
    '        node:',
    '          $ref: $.defaultPipeline',
  ].join('\n'));
  const rendered = configToYaml(parsed);
  const reparsed = parseSimpleYaml(rendered);

  assert.equal(reparsed.pipelines.waves.nodes.work.node.$ref, '$.defaultPipeline');
});

test('configToYaml round-trips representative composite pipeline nodes', () => {
  const parsed = parseSimpleYaml(compositeYaml());
  const rendered = configToYaml(parsed);
  const reparsed = parseSimpleYaml(rendered);

  assert.equal(reparsed.pipelines['issue-work'].description, 'Composite issue workflow.');
  assert.equal(reparsed.pipelines['issue-work'].kind, 'composite');
  assert.equal(reparsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.kind, 'git.worktree');
  assert.equal(reparsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.implement.role, 'implementer');
  assert.equal(reparsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.review.role, 'reviewer');
  assert.deepEqual(reparsed.pipelines['issue-work'].nodes.merge.needs, ['each-item']);
});

test('/work:config-raw get and set support composite node role paths', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-composite-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), compositeYaml(), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];
  const ui = { notify: (message, type = 'info') => notifications.push({ message, type }) };

  await pi.commands.get('work:config-raw')('get pipelines.issue-work.nodes.each-item.nodes.workspace.nodes.implement.role', { cwd: repoRoot, ui });
  await pi.commands.get('work:config-raw')('set pipelines.issue-work.nodes.each-item.nodes.workspace.nodes.implement.role reviewer', { cwd: repoRoot, ui });

  const reparsed = parseSimpleYaml(await fs.readFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), 'utf8'));
  assert.equal(notifications[0].message, 'implementer');
  assert.equal(reparsed.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.implement.role, 'reviewer');
  assert.equal(reparsed.pipelines['issue-work'].nodes.merge.kind, 'git.merge');
});

test('/work:config-raw set graph node paths merges pack defaults before editing root-only config', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-root-only-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'runtimeVersion: 1',
    'defaultPipeline: simple-loop',
    'defaultAgent: claude-code',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];
  const ui = { notify: (message, type = 'info') => notifications.push({ message, type }) };

  await pi.commands.get('work:config-raw')('set pipelines.simple-loop.nodes.workspace.nodes.run.role reviewer', { cwd: repoRoot, ui });
  await pi.commands.get('work:config-raw')('validate', { cwd: repoRoot, ui });

  const reparsed = parseSimpleYaml(await fs.readFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), 'utf8'));
  assert.equal(reparsed.pipelines['simple-loop'].kind, 'composite');
  assert.equal(reparsed.pipelines['simple-loop'].nodes.workspace.kind, 'git.worktree');
  assert.equal(reparsed.pipelines['simple-loop'].nodes.workspace.nodes.run.kind, 'agent.pi');
  assert.equal(reparsed.pipelines['simple-loop'].nodes.workspace.nodes.run.role, 'reviewer');
  assert.equal(notifications.at(-1).type, 'success');
});

test('/work:config-raw validate accepts composite pipeline map-form nodes and ref nodes', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-composite-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    compositeYaml(),
    '  waves:',
    '    kind: composite',
    '    nodes:',
    '      run:',
    '        kind: loop',
    '        max: 2',
    '        node:',
    '          $ref: $.defaultPipeline',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];

  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'success');
});

test('/work:config-raw validate rejects graph nodes missing kind and $ ref metadata', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-invalid-node-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'roles:',
    '  implementer:',
    '    description: Implementer',
    'pipelines:',
    '  bad:',
    '    kind: composite',
    '    nodes:',
    '      missing-kind:',
    '        role: implementer',
    '        prompt: implement-work',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];

  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /config\.pipelines\.bad\.nodes\.missing-kind\.kind is required/);
});

test('/work:config-raw validate rejects invalid CEL when and command nodes without command', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-invalid-when-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'roles:',
    '  implementer:',
    '    description: Implementer',
    'pipelines:',
    '  bad:',
    '    kind: composite',
    '    nodes:',
    '      check:',
    '        kind: command',
    '      close:',
    '        kind: work.close',
    '        when: needs.',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];

  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /command|when must parse as CEL/s);
});

test('/work:config-raw validate rejects parallel loop nodes without each', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-invalid-loop-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'roles:',
    '  implementer:',
    '    description: Implementer',
    'pipelines:',
    '  bad:',
    '    kind: composite',
    '    nodes:',
    '      loop:',
    '        kind: loop',
    '        mode: parallel',
    '        node:',
    '          kind: script',
    '          run: echo hi',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];

  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /config\.pipelines\.bad\.nodes\.loop\.each is required for parallel loop nodes/);
});

test('/work:config-raw validate accepts composite pipeline map-form nodes', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-composite-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), compositeYaml(), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];

  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'success');
});

test('/work:config-raw reset without path replaces stale config with graph-native defaults', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-reset-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'runtimeVersion: 1',
    'defaultPipeline: parallel-planner-with-review',
    'roles:',
    '  implementer:',
    '    description: Implementer',
    'pipelines:',
    '  parallel-planner-with-review:',
    '    steps:',
    '      - kind: runRole',
    '        role: implementer',
    '        prompt: implement-work',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];
  const ctx = { cwd: repoRoot, ui: { notify: (message, type = 'info') => notifications.push({ message, type }) } };

  await pi.commands.get('work:config-raw')('reset', ctx);
  await pi.commands.get('work:config-raw')('validate', ctx);

  const reparsed = parseSimpleYaml(await fs.readFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), 'utf8'));
  assert.equal(reparsed.pipelines['parallel-planner-with-review'].kind, 'composite');
  assert.ok(reparsed.pipelines['parallel-planner-with-review'].nodes.implement);
  assert.equal(reparsed.pipelines['parallel-planner-with-review'].steps, undefined);
  assert.equal(notifications.at(-1).type, 'success');
});

test('/work:config-raw validate rejects config that fails current graph schema', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflows-invalid-config-'));
  await fs.mkdir(path.join(repoRoot, '.pi/sandcastle'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'run-job.mjs'), '', 'utf8');
  await fs.writeFile(path.join(repoRoot, '.pi/sandcastle', 'config.yaml'), [
    'roles:',
    '  implementer:',
    '    description: Implementer',
    'pipelines:',
    '  old:',
    '    steps:',
    '      - role: implementer',
    '        prompt: Implement work.',
  ].join('\n'), 'utf8');
  const pi = createFakePi();
  agentWorkflows(pi);
  const notifications = [];

  await pi.commands.get('work:config-raw')('validate', {
    cwd: repoRoot,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications[0].type, 'error');
  assert.match(notifications[0].message, /config\.pipelines\.old\.kind is required/);
  assert.match(notifications[0].message, /config\.pipelines\.old\.nodes is required/);
  assert.match(notifications[0].message, /config\.pipelines\.old\.steps is not supported/);
});

test('ConfigShadowModel renameAgent updates nested composite node role references', () => {
  const cfg = parseSimpleYaml(compositeYaml());
  const model = new ConfigShadowModel(cfg);

  model.renameAgent('implementer', 'builder');
  const snapshot = model.snapshot();

  assert.equal(snapshot.agents.implementer, undefined);
  assert.equal(snapshot.agents.builder.name, 'builder');
  assert.equal(snapshot.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.implement.role, 'builder');
  assert.equal(snapshot.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.review.role, 'reviewer');
});
