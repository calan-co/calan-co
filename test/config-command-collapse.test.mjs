import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import agentWorkflows from '../extensions/agent-workflows/index.ts';

function register() {
  const commands = new Map();
  agentWorkflows({
    on() {},
    registerTool() {},
    registerCommand(name, spec) { commands.set(name, spec); },
  });
  return commands;
}

function makeCtx(cwd, options = {}) {
  const notifications = [];
  let tuiOpened = false;
  const ctx = {
    cwd,
    mode: options.mode,
    ui: {
      notify(message, type = 'info') { notifications.push({ message, type }); },
      ...(options.custom ? { custom: async () => { tuiOpened = true; return { type: 'cancel' }; } } : {}),
    },
  };
  return { ctx, notifications, wasTuiOpened: () => tuiOpened };
}

test('/work:config owns config subcommands and /work:config-raw remains a compatibility alias', async () => {
  const commands = register();
  assert.ok(commands.has('work:config'));
  assert.ok(commands.has('work:config-raw'));
  assert.ok(commands.get('work:config').getArgumentCompletions);

  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-config-collapse-'));
  try {
    const { ctx, notifications } = makeCtx(cwd);
    const config = commands.get('work:config');
    const raw = commands.get('work:config-raw');

    await config.handler('init', ctx);
    assert.equal(notifications.at(-1).type, 'success');
    assert.doesNotMatch(readFileSync(join(cwd, '.pi/sandcastle/config.yaml'), 'utf8'), /^pipelines:/m);

    await config.handler('show', ctx);
    assert.equal(notifications.at(-1).type, 'info');
    assert.match(notifications.at(-1).message, /"defaultPipeline": "simple-loop"/);

    await config.handler('get defaultPipeline', ctx);
    assert.deepEqual(notifications.at(-1), { message: 'simple-loop', type: 'info' });

    await config.handler('set defaultModel test-model', ctx);
    assert.deepEqual(notifications.at(-1), { message: 'Updated defaultModel. Rebuild the sandbox image separately when needed.', type: 'success' });

    await config.handler('set workSourceCommands.close "custom close {{ itemId }}"', ctx);
    assert.equal(notifications.at(-1).type, 'success');
    assert.match(readFileSync(join(cwd, '.pi/sandcastle/config.yaml'), 'utf8'), /^workSourceCommands:\n  close: "custom close \{\{ itemId \}\}"/m);
    assert.doesNotMatch(readFileSync(join(cwd, '.pi/sandcastle/config.yaml'), 'utf8'), /^pipelines:/m);

    await config.handler('set workSource doc-vader', ctx);
    const docVaderConfig = readFileSync(join(cwd, '.pi/sandcastle/config.yaml'), 'utf8');
    assert.match(docVaderConfig, /^workSource: doc-vader/m);
    assert.match(docVaderConfig, /^workSourceSetupCommand: dv sandcastle init/m);
    assert.doesNotMatch(docVaderConfig, /^workSourceCommands:/m);
    assert.doesNotMatch(docVaderConfig, /^pipelines:/m);

    await config.handler('reset defaultModel', ctx);
    assert.deepEqual(notifications.at(-1), { message: 'Reset defaultModel to defaults. Rebuild the sandbox image separately when needed.', type: 'success' });

    await config.handler('editor nano', ctx);
    assert.deepEqual(notifications.at(-1), { message: 'Preferred Agent Workflows config editor set to: nano', type: 'success' });

    await config.handler('editor', ctx);
    assert.deepEqual(notifications.at(-1), { message: 'nano', type: 'info' });

    await config.handler('edit', ctx);
    assert.equal(notifications.at(-1).type, 'info');
    assert.match(notifications.at(-1).message, /Open .*config.yaml in your editor/);

    await config.handler('validate', ctx);
    assert.equal(notifications.at(-1).type, 'success');

    await raw.handler('get defaultPipeline', ctx);
    assert.deepEqual(notifications.at(-1), { message: 'simple-loop', type: 'info' });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('/work:config with no args keeps TUI entry in TUI mode and shows config in terminal mode', async () => {
  const commands = register();
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-config-default-'));
  try {
    const terminal = makeCtx(cwd);
    await commands.get('work:config').handler('init', terminal.ctx);
    terminal.notifications.length = 0;
    await commands.get('work:config').handler('', terminal.ctx);
    assert.equal(terminal.notifications.at(-1).type, 'info');
    assert.match(terminal.notifications.at(-1).message, /"defaultPipeline": "simple-loop"/);

    const tui = makeCtx(cwd, { mode: 'tui', custom: true });
    await commands.get('work:config').handler('', tui.ctx);
    assert.equal(tui.wasTuiOpened(), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
