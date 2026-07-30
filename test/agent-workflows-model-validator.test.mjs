import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GLOBAL_NODE_DISCRIMINATOR,
  RESULT_CONTRACTS,
  assertValidWorkflowModel,
  validateWorkflowModel,
} from '../extensions/agent-workflows/workflow-model.ts';

test('validates and normalizes a top-level concrete composite workflow', () => {
  const workflow = assertValidWorkflowModel({
    kind: 'composite',
    nodes: {
      prepare: { kind: 'script', with: { run: 'pnpm install' } },
      lane: {
        kind: 'loop',
        needs: ['prepare'],
        each: '${work.items}',
        max: 2,
        nodes: {
          workspace: {
            kind: 'git.worktree',
            nodes: {
              implement: { kind: 'agent', with: { role: 'implementer' } },
              review: { kind: 'agent', needs: ['implement'], with: { role: 'reviewer' } },
            },
          },
        },
      },
      merge: { kind: 'git.merge', needs: ['lane'] },
    },
  });

  assert.equal(workflow.kind, 'composite');
  assert.equal(workflow.nodes.lane.kind, 'loop');
  assert.equal(workflow.nodes.lane.mode, 'sequential');
});

test('rejects non-composite top-level workflows and non-map child nodes', () => {
  const result = validateWorkflowModel({
    kind: 'workflow',
    nodes: [
      { id: 'implement', kind: 'agent' },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /root kind must be 'composite'/);
  assert.match(result.errors.join('\n'), /root.nodes must be a map keyed by node id/);
});

test('requires child-owning nodes to define at least one child node', () => {
  const result = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      emptyComposite: { kind: 'composite', nodes: {} },
      emptyLoop: { kind: 'loop', each: '${items}', nodes: {} },
      emptyWorkspace: { kind: 'git.worktree', nodes: {} },
    },
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /root.nodes.emptyComposite must define at least one child node/);
  assert.match(result.errors.join('\n'), /root.nodes.emptyLoop must define at least one child node/);
  assert.match(result.errors.join('\n'), /root.nodes.emptyWorkspace must define at least one child node/);
});

test('normalizes needs string shorthand to arrays in returned models', () => {
  const workflow = assertValidWorkflowModel({
    kind: 'composite',
    nodes: {
      prepare: { kind: 'script' },
      implement: { kind: 'agent', needs: 'prepare' },
    },
  });

  assert.deepEqual(workflow.nodes.implement.needs, ['prepare']);
});

test('requires every node to declare a concrete registered kind', () => {
  const result = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      missing: { with: { role: 'implementer' } },
      abstractWorkspace: { kind: 'workspace' },
      selectedProvider: { kind: 'agent', provider: 'pi' },
    },
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /root.nodes.missing is missing kind/);
  assert.match(result.errors.join('\n'), /root.nodes.abstractWorkspace references unknown concrete kind 'workspace'/);
  assert.match(result.errors.join('\n'), /root.nodes.selectedProvider uses provider selector field 'provider'/);
  assert.equal(GLOBAL_NODE_DISCRIMINATOR, 'kind');
});

test('resolves needs only within the current child node map', () => {
  const result = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      prepare: { kind: 'script' },
      workspace: {
        kind: 'git.worktree',
        needs: ['prepare'],
        nodes: {
          implement: { kind: 'agent', needs: ['prepare'] },
        },
      },
    },
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /root.nodes.workspace.nodes.implement needs unknown sibling 'prepare'/);
});

test('enforces typed result contracts for mergeable fan-in', () => {
  const valid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      workspace: { kind: 'git.worktree', nodes: { implement: { kind: 'agent' } } },
      merge: { kind: 'git.merge', needs: ['workspace'] },
    },
  });
  assert.equal(valid.valid, true, valid.errors.join('\n'));
  assert.deepEqual(RESULT_CONTRACTS['git.worktree'].interfaces, ['IMergeableResult']);
  assert.deepEqual(RESULT_CONTRACTS['git.merge'].accepts, ['IMergeableResult']);
  assert.deepEqual(RESULT_CONTRACTS.agent.interfaces, []);

  const invalid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      implement: { kind: 'agent' },
      merge: { kind: 'git.merge', needs: ['implement'] },
    },
  });

  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /root.nodes.merge requires needs that produce IMergeableResult; 'implement' produces AgentResult/);
});

test('validates loop model-level mode and max semantics', () => {
  const valid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      counted: { kind: 'loop', max: 2, nodes: { run: { kind: 'script' } } },
    },
  });
  assert.equal(valid.valid, true, valid.errors.join('\n'));
  assert.equal(valid.model.nodes.counted.mode, 'sequential');

  const result = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      badLoop: { kind: 'loop', mode: 'concurrent', each: '${items}', max: 0 },
      missingParallelIterator: { kind: 'loop', mode: 'parallel', nodes: { run: { kind: 'script' } } },
    },
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /root.nodes.badLoop mode must be 'sequential' or 'parallel'/);
  assert.match(result.errors.join('\n'), /root.nodes.badLoop max must be a positive integer/);
  assert.match(result.errors.join('\n'), /root.nodes.missingParallelIterator parallel loop must define each/);
});

test('validates command, work.close, and CEL when mixins', () => {
  const valid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      check: { kind: 'command', command: 'node --version' },
      close: { kind: 'work.close', needs: ['check'], when: 'needs.check.exitCode == 0' },
    },
  });
  assert.equal(valid.valid, true, valid.errors.join('\n'));
  assert.equal(RESULT_CONTRACTS.command.resultType, 'CommandResult');
  assert.equal(RESULT_CONTRACTS['work.close'].resultType, 'WorkCloseResult');

  const invalid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      missingCommand: { kind: 'command' },
      badWhen: { kind: 'work.close', when: 'needs.' },
    },
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /root.nodes.missingCommand command nodes must define a non-empty command string/);
  assert.match(invalid.errors.join('\n'), /root.nodes.badWhen when must parse as CEL/);
});

test('validates reserved $ ref node structure', () => {
  const valid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      wave: { $ref: '$.defaultPipeline' },
    },
  });
  assert.equal(valid.valid, true, valid.errors.join('\n'));

  const invalid = validateWorkflowModel({
    kind: 'composite',
    nodes: {
      badMeta: { $: { ref: 'simple-loop', include: 'nope' } },
      badRef: { $ref: '' },
      mixed: { kind: 'script', $ref: 'simple-loop' },
    },
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /root.nodes.badMeta uses unsupported \$ meta key 'include'/);
  assert.match(invalid.errors.join('\n'), /root.nodes.badRef \$ref must be a non-empty string/);
  assert.match(invalid.errors.join('\n'), /root.nodes.mixed must not combine \$ref metadata with kind/);
});
