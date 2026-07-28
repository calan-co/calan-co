import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

function runTuiScript(body) {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import agentWorkflows from './extensions/agent-workflows/index.ts';

    const commands = new Map();
    agentWorkflows({
      on() {},
      registerCommand(name, spec) { commands.set(name, spec); },
      registerTool() {},
    });

    const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-tui-'));
    const configDir = join(cwd, '.pi', 'sandcastle');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yaml'), [
      'defaultSandbox: docker',
      'defaultModel: claude-sonnet-4-6',
      '',
      'roles:',
      '  planner:',
      '    description: Planner agent',
      '    provider: pi',
      '  worker:',
      '    description: Worker agent',
      '    provider: pi',
      '',
      '  parallel: [planner, worker]',
      '',
      'pipelines:',
      '  simple-loop:',
      '    description: Simple loop',
      '    kind: composite',
      '    nodes:',
      '      workspace:',
      '        kind: git.worktree',
      '        nodes:',
      '          run:',
      '            kind: agent.pi',
      '            role: worker',
      '            prompt: simple-loop',
    ].join('\n'));
    writeFileSync(join(configDir, 'run-job.mjs'), '');

    const notifications = [];
    let component;
    let resolveCustom;
    const tui = { requestRender() {} };
    const theme = {
      fg(_name, text) { return String(text); },
      bold(text) { return String(text); },
    };
    const ctx = {
      cwd,
      mode: 'tui',
      ui: {
        notify(message, type = 'info') { notifications.push({ message, type }); },
        custom(factory) {
          return new Promise((resolve) => {
            resolveCustom = resolve;
            component = factory(tui, theme, {}, resolve);
          });
        },
      },
    };

    const command = commands.get('work:config');
    const runPromise = command.handler('', ctx);
    while (!component) await new Promise((resolve) => setTimeout(resolve, 0));

    const text = () => component.render(100).join('\n');
    const press = (data) => component.handleInput(data);
    const down = () => press('\x1b[B');
    const up = () => press('\x1b[A');
    const right = () => press('\x1b[C');
    const esc = () => press('\x1b');
    const ctrlQ = () => press('\x11');
    const enter = () => press('\r');
    const space = () => press(' ');

    ${body}

    if (resolveCustom) resolveCustom(null);
    await runPromise;
  `;

  return execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('backlog config TUI escape cancels rename and backs through nested agent screens', () => {
  runTuiScript(String.raw`
    assert.match(text(), /BACKLOG CONFIG BIOS/);
    down(); enter(); // Roles
    assert.match(text(), /ROLES/);
    down(); enter(); // first role
    assert.match(text(), /ROLE \/ /);
    enter(); // Rename role
    assert.match(text(), /RENAME ROLE/);
    esc();
    assert.match(text(), /ROLE \/ /);
    esc();
    assert.match(text(), /ROLES/);
    esc();
    assert.match(text(), /BACKLOG CONFIG BIOS/);
  `);
});

test('backlog config TUI right arrow does not navigate back like escape', () => {
  runTuiScript(String.raw`
    down(); enter(); // Roles
    assert.match(text(), /ROLES/);
    right();
    assert.match(text(), /ROLES/);
    assert.doesNotMatch(text(), /BACKLOG CONFIG BIOS/);
    esc();
    assert.match(text(), /BACKLOG CONFIG BIOS/);
  `);
});

test('backlog config TUI top-level no longer exposes Teams menu', () => {
  runTuiScript(String.raw`
    assert.doesNotMatch(text(), /Teams/);
  `);
});

test('backlog config TUI escape cancels fixed-domain field editor', () => {
  runTuiScript(String.raw`
    enter(); // Defaults
    enter(); // Sandbox
    assert.match(text(), /EDIT Sandbox/);
    assert.match(text(), /docker/);
    esc();
    assert.match(text(), /DEFAULTS/);
    assert.doesNotMatch(text(), /UNSAVED CHANGES/);
  `);
});

test('backlog config TUI ctrl+q force quits from nested edit mode', () => {
  runTuiScript(String.raw`
    down(); enter(); // Roles
    down(); enter(); // first role
    enter(); // Rename role
    assert.match(text(), /RENAME ROLE/);
    ctrlQ();
    await runPromise;
    assert.deepEqual(notifications, []);
  `);
});

test('backlog config TUI offers rebuild-aware save choices for image-affecting changes', () => {
  runTuiScript(String.raw`
    enter(); // Runtime Defaults
    enter(); // Sandbox
    down(); enter(); // podman
    esc(); // main
    enter(); // Runtime Defaults
    down(); enter(); // Model
    for (const ch of 'new-model') press(ch);
    enter();
    esc(); // main
    esc(); // unsaved changes
    assert.match(text(), /UNSAVED CHANGES/);
    assert.match(text(), /Save and rebuild/);
    assert.match(text(), /Save without rebuilding/);
    assert.match(text(), /Exit without saving/);
    assert.doesNotMatch(text(), /Change 1/);
  `);
});
