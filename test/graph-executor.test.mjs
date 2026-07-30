import assert from 'node:assert/strict';
import test from 'node:test';

import { executeGraphWorkflow } from '../extensions/agent-workflows/graph-executor.ts';
import { discoverHooksByCapability, sortHooksForPhase } from '../extensions/agent-workflows/hooks.ts';

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

test('evaluates CEL when mixins and skips false nodes without running handlers', async () => {
  const calls = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      enabled: { kind: 'script', when: 'input.enabled == true', run: 'enabled' },
      disabled: { kind: 'script', when: 'input.enabled == false', run: 'disabled' },
    },
  }, {
    input: { enabled: true },
    handlers: {
      script: ({ node }) => {
        calls.push(node.run);
        return { output: node.run };
      },
    },
  });

  assert.deepEqual(calls, ['enabled']);
  assert.equal(result.children.enabled.status, 'succeeded');
  assert.equal(result.children.disabled.status, 'skipped');
  assert.equal(result.children.disabled.type, 'SkippedResult');
  assert.match(result.children.disabled.reason, /when evaluated to false/);
});

test('CEL when mixin can read needs and skips dependents of skipped needs', async () => {
  const calls = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      review: { kind: 'review' },
      close: { kind: 'close', needs: ['review'], when: 'needs.review.accepted == true' },
      merge: { kind: 'git.merge', needs: ['close'] },
    },
  }, {
    handlers: {
      review: () => ({ accepted: false }),
      close: () => { calls.push('close'); return { closed: true, effects: ['close:wi-1'] }; },
      'git.merge': () => { calls.push('merge'); return { merged: ['close'], effects: ['merge:close'] }; },
    },
  });

  assert.deepEqual(calls, []);
  assert.equal(result.children.review.status, 'succeeded');
  assert.equal(result.children.close.status, 'skipped');
  assert.equal(result.children.merge.status, 'skipped');
  assert.match(result.children.merge.reason, /skipped dependency: close/);
});

test('CEL when mixin fails closed for invalid or non-boolean expressions', async () => {
  await assert.rejects(
    executeGraphWorkflow({ kind: 'composite', nodes: { bad: { kind: 'script', when: 'input.enabled' } } }, { input: { enabled: 'yes' } }),
    /when must evaluate to boolean/,
  );
  await assert.rejects(
    executeGraphWorkflow({ kind: 'composite', nodes: { bad: { kind: 'script', when: 'missing == true' } } }),
    /when evaluation failed/,
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

test('executes dynamic named-pipeline $ref nodes with runtime target resolution and hooks', async () => {
  const seen = [];
  const hookNodes = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      wave: { $ref: '$.defaultPipeline' },
    },
  }, {
    input: { defaultPipeline: 'reviewed-wave' },
    refs: {
      resolveNamedPipeline(name) {
        seen.push(`resolve:${name}`);
        if (name === 'reviewed-wave') return { kind: 'composite', nodes: { run: { kind: 'agent', capabilities: ['agent'] } } };
      },
    },
    hooks: [{ id: 'agent-hook', phase: 'beforeNode', capabilities: ['agent'], run: ({ node }) => hookNodes.push(node.kind) }],
    handlers: {
      agent: async () => {
        seen.push('agent');
        return { output: 'ok' };
      },
    },
  });

  assert.deepEqual(seen, ['resolve:reviewed-wave', 'agent']);
  assert.deepEqual(hookNodes, ['agent']);
  assert.equal(result.children.wave.type, 'CompositeResult');
  assert.equal(result.children.wave.children.run.type, 'AgentResult');
});

test('fails closed for unknown, cyclic, and excessive-depth dynamic $ref targets', async () => {
  await assert.rejects(
    executeGraphWorkflow({ kind: 'composite', nodes: { wave: { $ref: 'missing-wave' } } }, {
      refs: { resolveNamedPipeline: () => undefined },
    }),
    /root\.nodes\.wave \$ref target 'missing-wave' is unknown/,
  );

  await assert.rejects(
    executeGraphWorkflow({ kind: 'composite', nodes: { wave: { $ref: 'a' } } }, {
      refs: {
        resolveNamedPipeline(name) {
          if (name === 'a') return { $ref: 'b' };
          if (name === 'b') return { $ref: 'a' };
        },
      },
    }),
    /attempted to enter \$ref cycle: a -> b -> a/,
  );

  await assert.rejects(
    executeGraphWorkflow({ kind: 'composite', nodes: { wave: { $ref: 'a' } } }, {
      refs: {
        maxDepth: 1,
        resolveNamedPipeline(name) {
          if (name === 'a') return { $ref: 'b' };
          if (name === 'b') return { kind: 'script' };
        },
      },
    }),
    /attempted to exceed \$ref max depth 1 before entering 'b'/,
  );
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

test('waits for started parallel loop lanes to settle before throwing', async () => {
  const closed = [];

  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        fanOut: {
          kind: 'loop',
          mode: 'parallel',
          each: ['fast', 'slow'],
          max: 2,
          node: {
            kind: 'git.worktree',
            nodes: {
              run: { kind: 'agent' },
            },
          },
        },
      },
    }, {
      handlers: {
        'git.worktree': async (context) => {
          const branch = `branch-${context.loop.item}`;
          try {
            const childRun = await context.executeChildren({
              workspace: { branch, worktreePath: `/tmp/${branch}` },
            });
            return {
              branch,
              worktreePath: `/tmp/${branch}`,
              commits: [`commit-${context.loop.item}`],
              effects: [`commit:commit-${context.loop.item}`],
              children: childRun.children,
              order: childRun.order,
            };
          } finally {
            closed.push(branch);
          }
        },
        agent: async ({ loop }) => {
          if (loop.item === 'fast') throw new Error('fast lane failed');
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { branch: 'branch-slow', commits: ['commit-slow'] };
        },
      },
    }),
    /fast lane failed/,
  );

  assert.deepEqual([...closed].sort(), ['branch-fast', 'branch-slow']);
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
        'git.worktree': async () => ({ effects: ['log:/tmp/agent.log'] }),
      },
    }),
    /root\.nodes\.merge requires effectful mergeable needs; 'workspace' produced no effects or commits/,
  );

  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        merge: { kind: 'git.merge' },
      },
    }),
    /root\.nodes\.merge requires mergeable needs/,
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

test('git.merge can wait on gate needs while merging explicit workspace inputs', async () => {
  const order = [];
  const result = await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      implement: {
        kind: 'git.worktree',
        nodes: {
          run: { kind: 'agent' },
        },
      },
      review: { kind: 'agent', needs: ['implement'] },
      merge: { kind: 'git.merge', needs: ['implement', 'review'], inputs: ['implement'] },
    },
  }, {
    handlers: {
      'git.worktree': async () => {
        order.push('implement');
        return { branch: 'feature/work', commits: ['abc123'], effects: ['commit:abc123'] };
      },
      agent: async ({ id }) => {
        order.push(id);
        return { text: 'review only' };
      },
    },
  });

  assert.deepEqual(order, ['implement', 'run', 'review']);
  assert.deepEqual(result.children.merge.merged, ['implement']);
  assert.equal(result.children.merge.inputs.implement.type, 'WorkspaceResult');
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

test('graph node hooks wrap node execution and receive well-known plus provider namespaces', async () => {
  const events = [];
  const contexts = [];
  const hooks = [
    {
      id: 'before',
      phase: 'beforeNode',
      capabilities: ['git'],
      async run(context) {
        if (context.node.path === 'root.nodes.run') {
          events.push(`before:${context.node.path}`);
          contexts.push(context);
        }
      },
    },
    {
      id: 'after',
      phase: 'afterNode',
      capabilities: ['git'],
      async run(context) {
        if (context.node.path === 'root.nodes.run') events.push(`after:${context.runtime.result.type}:${context.runtime.result.output}`);
      },
    },
  ];

  await executeGraphWorkflow({
    kind: 'composite',
    nodes: {
      run: { kind: 'agent.pi', role: 'implementer', capabilities: ['git'] },
    },
  }, {
    input: { task: 'demo' },
    hooks,
    hookContext: {
      global: { cwd: '/repo' },
      runtime: { runId: 'run-1' },
      providers: { git: { branch: 'feature/demo' } },
    },
    handlers: {
      'agent.pi': async (context) => {
        events.push(`handler:${context.path}`);
        return 'done';
      },
    },
  });

  assert.deepEqual(events, ['before:root.nodes.run', 'handler:root.nodes.run', 'after:AgentResult:done']);
  assert.equal(contexts[0].global.cwd, '/repo');
  assert.deepEqual(contexts[0].global.input, { task: 'demo' });
  assert.equal(contexts[0].runtime.runId, 'run-1');
  assert.equal(contexts[0].node.path, 'root.nodes.run');
  assert.equal(contexts[0].node.kind, 'agent.pi');
  assert.equal(contexts[0].role.id, 'implementer');
  assert.equal(contexts[0].git.branch, 'feature/demo');
});

test('graph node error hooks run without after hooks and preserve original node errors', async () => {
  const events = [];
  const hookFailure = new Error('error hook should not mask original');
  await assert.rejects(
    executeGraphWorkflow({
      kind: 'composite',
      nodes: {
        run: { kind: 'script', capabilities: ['work'] },
      },
    }, {
      hooks: [
        { id: 'before', phase: 'beforeNode', capabilities: ['work'], run: (context) => events.push(`before:${context.node.path}`) },
        { id: 'after', phase: 'afterNode', capabilities: ['work'], run: () => events.push('after') },
        { id: 'error-a', phase: 'onNodeError', capabilities: ['work'], run: (context) => events.push(`error:${context.runtime.error.message}`) },
        { id: 'error-b', phase: 'onNodeError', capabilities: ['work'], run: () => { throw hookFailure; } },
      ],
      handlers: {
        script: async () => { throw new Error('original node failed'); },
      },
    }),
    /original node failed/,
  );

  assert.deepEqual(events, ['before:root.nodes.run', 'error:original node failed']);
});

test('hook discovery and ordering ignore capability declaration order', () => {
  const sequence = [];
  const hooks = [
    { id: 'same-registration-first', phase: 'beforeNode', order: 0, capabilities: ['b', 'a'], run: () => sequence.push('same-registration-first') },
    { id: 'subtree', phase: 'beforeNode', topology: 'subtree', order: -10, capabilities: ['a'], run: () => sequence.push('subtree') },
    { id: 'early', phase: 'beforeNode', order: -1, capabilities: ['a'], run: () => sequence.push('early') },
    { id: 'missing', phase: 'beforeNode', order: -100, capabilities: ['missing'], run: () => sequence.push('missing') },
    { id: 'same-registration-second', phase: 'beforeNode', order: 0, capabilities: ['a'], run: () => sequence.push('same-registration-second') },
  ];

  const discoveredA = discoverHooksByCapability(hooks, ['a', 'b']);
  const discoveredB = discoverHooksByCapability(hooks, ['b', 'a']);
  assert.deepEqual(sortHooksForPhase(discoveredA, 'beforeNode').map((hook) => hook.id), ['early', 'same-registration-first', 'same-registration-second', 'subtree']);
  assert.deepEqual(sortHooksForPhase(discoveredB, 'beforeNode').map((hook) => hook.id), ['early', 'same-registration-first', 'same-registration-second', 'subtree']);
});
