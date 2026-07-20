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
  '  legacy:',
  '    steps:',
  '      - role: implementer',
  '        prompt: Implement legacy work.',
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

test('parseSimpleYaml supports composite pipeline map-form nodes and preserves legacy steps', () => {
  const parsed = parseSimpleYaml(compositeYaml());

  assert.equal(parsed.pipelines.legacy.steps.length, 1);
  assert.equal(parsed.pipelines.legacy.steps[0].role, 'implementer');
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
  assert.equal(reparsed.pipelines.legacy.steps[0].role, 'implementer');
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

test('ConfigShadowModel renameAgent updates nested composite node role references', () => {
  const cfg = parseSimpleYaml(compositeYaml());
  const model = new ConfigShadowModel(cfg);

  model.renameAgent('implementer', 'builder');
  const snapshot = model.snapshot();

  assert.equal(snapshot.agents.implementer, undefined);
  assert.equal(snapshot.agents.builder.name, 'builder');
  assert.equal(snapshot.pipelines.legacy.steps[0].role, 'builder');
  assert.equal(snapshot.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.implement.role, 'builder');
  assert.equal(snapshot.pipelines['issue-work'].nodes['each-item'].nodes.workspace.nodes.review.role, 'reviewer');
});
