import assert from 'node:assert/strict';
import test from 'node:test';

import { executeGraphWorkflow } from '../extensions/agent-workflows/graph-executor.ts';

test('executes composite concrete-node DAGs by sibling needs and aggregates typed results', async () => {
  const seen = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      review: { kind: 'agent', needs: ['implement'], with: { role: 'reviewer' } },
      prepare: { kind: 'script', with: { run: 'prepare' } },
      implement: { kind: 'agent', needs: ['prepare'], with: { role: 'implementer' } },
    },
  }, {
    handlers: {
      script: async ({ id, node }) => {
        seen.push(`${id}:${node.kind}`);
        return { output: node.with.run };
      },
      agent: async ({ id, node }) => {
        seen.push(`${id}:${node.kind}`);
        return { role: node.with.role, text: `ran ${id}` };
      },
    },
  });

  assert.deepEqual(seen, ['prepare:script', 'implement:agent', 'review:agent']);
  assert.equal(result.type, 'CompositeResult');
  assert.deepEqual(result.order, ['prepare', 'implement', 'review']);
  assert.equal(result.children.prepare.type, 'ScriptResult');
  assert.equal(result.children.implement.type, 'AgentResult');
  assert.equal(result.children.review.type, 'AgentResult');
});

test('fails closed when a node needs a non-sibling or dependency cycle', async () => {
  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        prepare: { kind: 'script' },
        workspace: {
          kind: 'git.worktree',
          nodes: {
            implement: { kind: 'agent', needs: ['prepare'] },
          },
        },
      },
    }),
    /root\.nodes\.workspace\.nodes\.implement needs unknown sibling 'prepare'/,
  );

  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        a: { kind: 'script', needs: ['b'] },
        b: { kind: 'script', needs: ['a'] },
      },
    }),
    /root dependency cycle or unsatisfied needs among: a, b/,
  );
});

test('runs sequential loops without each up to max iterations', async () => {
  const iterations = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      retry: {
        kind: 'loop',
        max: 3,
        nodes: {
          attempt: { kind: 'agent' },
        },
      },
    },
  }, {
    handlers: {
      agent: async ({ loop }) => {
        iterations.push(loop.index);
        return { index: loop.index };
      },
    },
  });

  assert.deepEqual(iterations, [0, 1, 2]);
  assert.equal(result.children.retry.type, 'LoopResult');
  assert.equal(result.children.retry.mode, 'sequential');
  assert.equal(result.children.retry.iterations.length, 3);
});

test('runs loop.each sequentially with max as an item cap', async () => {
  const items = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      eachItem: {
        kind: 'loop',
        mode: 'sequential',
        each: ['a', 'b', 'c'],
        max: 2,
        nodes: {
          run: { kind: 'agent' },
        },
      },
    },
  }, {
    handlers: {
      agent: async ({ loop }) => {
        items.push(loop.item);
        return { item: loop.item };
      },
    },
  });

  assert.deepEqual(items, ['a', 'b']);
  assert.equal(result.children.eachItem.iterations.length, 2);
});

test('runs loop.each in parallel while respecting max concurrency', async () => {
  let active = 0;
  let peak = 0;
  const items = [];

  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      fanOut: {
        kind: 'loop',
        mode: 'parallel',
        each: [1, 2, 3, 4, 5],
        max: 2,
        nodes: {
          run: { kind: 'agent' },
        },
      },
    },
  }, {
    handlers: {
      agent: async ({ loop }) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        items.push(loop.item);
        active -= 1;
        return { item: loop.item };
      },
    },
  });

  assert.equal(result.children.fanOut.iterations.length, 5);
  assert.equal(peak, 2);
  assert.deepEqual([...items].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('enforces mergeable inputs and effectful workspace merge defaults', async () => {
  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        implement: { kind: 'agent' },
        merge: { kind: 'git.merge', needs: ['implement'] },
      },
    }, {
      handlers: {
        agent: async () => ({ text: 'not mergeable' }),
      },
    }),
    /root\.nodes\.merge requires mergeable needs; 'implement' produced AgentResult/,
  );

  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        workspace: {
          kind: 'git.worktree',
          nodes: {
            implement: { kind: 'agent' },
          },
        },
        merge: { kind: 'git.merge', needs: ['workspace'] },
      },
    }, {
      handlers: {
        agent: async () => ({ text: 'done' }),
      },
    }),
    /root\.nodes\.merge requires effectful mergeable needs; 'workspace' produced no effects or commits/,
  );

  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      workspace: {
        kind: 'git.worktree',
        nodes: {
          implement: { kind: 'agent' },
        },
      },
      merge: { kind: 'git.merge', needs: ['workspace'] },
    },
  }, {
    handlers: {
      agent: async () => ({ text: 'done' }),
      'git.worktree': async () => ({ effects: ['commit:abc123'] }),
    },
  });

  assert.equal(result.children.workspace.type, 'WorkspaceResult');
  assert.equal(result.children.workspace.mergeable, true);
  assert.deepEqual(result.children.workspace.effects, ['commit:abc123']);
  assert.equal(result.children.merge.type, 'GitMergeResult');
  assert.deepEqual(result.children.merge.merged, ['workspace']);
  assert.deepEqual(result.children.merge.effects, []);
});

test('git.worktree handler can run children inside workspace context before closing', async () => {
  const events = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      workspace: {
        kind: 'git.worktree',
        nodes: {
          implement: { kind: 'agent' },
        },
      },
    },
  }, {
    handlers: {
      'git.worktree': async (context) => {
        events.push('open');
        const childRun = await context.executeChildren({
          workspace: { branch: 'agent-workflows/item-1', worktreePath: '/tmp/item-1' },
        });
        events.push('close');
        return {
          branch: 'agent-workflows/item-1',
          worktreePath: '/tmp/item-1',
          commits: ['abc123'],
          effects: ['commit:abc123'],
          children: childRun.children,
          order: childRun.order,
        };
      },
      agent: async (context) => {
        events.push(`agent:${context.workspace.branch}:${context.workspace.worktreePath}`);
        return { branch: context.workspace.branch, commits: ['abc123'] };
      },
    },
  });

  assert.deepEqual(events, ['open', 'agent:agent-workflows/item-1:/tmp/item-1', 'close']);
  assert.equal(result.children.workspace.type, 'WorkspaceResult');
  assert.deepEqual(result.children.workspace.order, ['implement']);
  assert.equal(result.children.workspace.children.implement.branch, 'agent-workflows/item-1');
});

test('rejects spoofed mergeable handler results and ambiguous loop child shape', async () => {
  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        script: { kind: 'script' },
        merge: { kind: 'git.merge', needs: ['script'] },
      },
    }, {
      handlers: {
        script: async () => ({ type: 'WorkspaceResult', mergeable: true, effects: ['fake-change'] }),
      },
    }),
    /root\.nodes\.merge requires mergeable needs; 'script' produced ScriptResult/,
  );

  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        ambiguous: {
          kind: 'loop',
          max: 1,
          node: { kind: 'script' },
          nodes: {
            ignored: { kind: 'agent' },
          },
        },
      },
    }),
    /root\.nodes\.ambiguous loop must define exactly one of node or nodes/,
  );
});
