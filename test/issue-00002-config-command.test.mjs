import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('issue 00002 registers /backlog:config-raw and manages repo-local config', () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { execFileSync as execFileSyncInner } from 'node:child_process';
    import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import piSandcastle from './extensions/pi-sandcastle/index.ts';

    const commands = new Map();
    const notifications = [];
    const api = {
      on() {},
      registerCommand(name, spec) {
        commands.set(name, spec);
      },
      registerTool() {},
    };

    piSandcastle(api);
    assert.ok(commands.has('backlog:config-raw'));

    const cwd = mkdtempSync(join(tmpdir(), 'pi-sandcastle-config-'));
    const configDir = join(cwd, '.pi', 'sandcastle');
    const configPath = join(configDir, 'config.yaml');
    const runnerPath = join(configDir, 'run-job.mjs');
    mkdirSync(configDir, { recursive: true });
    const ctx = {
      cwd,
      ui: {
        notify(message, type = 'info') {
          notifications.push({ message, type });
        },
      },
    };

    writeFileSync(
      configPath,
      [
        'defaultSandbox: docker',
        'defaultModel: custom-model',
        '',
        'roles:',
        '  researcher:',
        '    description: Custom researcher',
        '    model: custom-model',
        '    sandbox: docker',
        '    maxIterations: 1',
        '    systemPrompt: |',
        '      Keep this edit.',
        '',
        '  default: [researcher]',
        '',
        'chains:',
        '  explore-plan-review:',
        '    - role: researcher',
        '      prompt: |',
        '        Keep this too.',
        '',
        'extraRoot: keep-me',
      ].join('\n'),
    );

    const invoke = async (args) => {
      notifications.length = 0;
      await commands.get('backlog:config-raw').handler(args, ctx);
      return notifications.map(({ message, type }) => ({ message, type }));
    };

    const configCompletions = commands.get('backlog:config-raw').getArgumentCompletions;
    assert.ok(configCompletions);
    assert.deepEqual(
      configCompletions('get ').map((item) => item.value).filter((value) => ['get defaultModel', 'get defaultSandbox', 'get defaultAgent'].includes(value)).sort(),
      ['get defaultAgent', 'get defaultModel', 'get defaultSandbox'],
    );
    assert.deepEqual(
      configCompletions('get roles.implementer.').map((item) => item.label).sort(),
      ['branch', 'description', 'maxIterations', 'model', 'provider', 'sandbox', 'systemPrompt'],
    );
    assert.deepEqual(
      configCompletions('set defaultSandbox ').map((item) => item.label),
      ['docker', 'podman', 'vercel', 'no-sandbox'],
    );

    const setupNotifications = await invoke('init');
    assert.equal(setupNotifications[0].type, 'warning');
    assert.match(setupNotifications[0].message, /--force/);
    assert.equal(readFileSync(configPath, 'utf8').includes('extraRoot: keep-me'), true);
    assert.doesNotMatch(readFileSync(configPath, 'utf8'), /^defaultPipeline:/m);
    assert.equal(existsSync(runnerPath), true);
    execFileSyncInner(process.execPath, ['--check', runnerPath], { encoding: 'utf8' });

    const forceNotifications = await invoke('init --force');
    assert.equal(forceNotifications[0].type, 'success');
    assert.match(forceNotifications[0].message, /Overwrote:/);
    assert.equal(readFileSync(configPath, 'utf8').includes('extraRoot: keep-me'), false);
    assert.match(readFileSync(configPath, 'utf8'), /^roles:/m);
    assert.match(readFileSync(configPath, 'utf8'), /systemPrompt: \|/);
    assert.doesNotMatch(readFileSync(configPath, 'utf8'), /^    sandbox: docker/m);
    assert.match(readFileSync(configPath, 'utf8'), /^pipelines:/m);

    const showNotifications = await invoke('');
    assert.equal(showNotifications[0].type, 'info');
    assert.doesNotMatch(showNotifications[0].message, /"defaultTeam"/);
    assert.match(showNotifications[0].message, /"defaultModel": "Agent Default"/);

    const setNotifications = await invoke('set defaultModel claude-opus-4-8');
    assert.deepEqual(setNotifications, [{ message: 'Updated defaultModel. Rebuild the sandbox image separately when needed.', type: 'success' }]);
    assert.match(readFileSync(configPath, 'utf8'), /defaultModel: claude-opus-4-8/);

    const resetNotifications = await invoke('reset defaultModel');
    assert.deepEqual(resetNotifications, [{ message: 'Reset defaultModel to defaults. Rebuild the sandbox image separately when needed.', type: 'success' }]);
    assert.match(readFileSync(configPath, 'utf8'), /defaultModel: Agent Default/);

    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('defaultSandbox: docker', 'defaultSandbox: spaceship'));
    rmSync(runnerPath);
    const validateNotifications = await invoke('validate');
    assert.equal(validateNotifications[0].type, 'error');
    assert.match(validateNotifications[0].message, /sandbox provider 'spaceship' is unsupported/i);
    assert.match(validateNotifications[0].message, /Missing runner scaffold: \.pi\/sandcastle\/run-job\.mjs/);

    console.log(JSON.stringify({
      commandRegistered: commands.has('backlog:config-raw'),
      notifications: {
        setup: setupNotifications,
        show: showNotifications,
        set: setNotifications,
        reset: resetNotifications,
        validate: validateNotifications,
      },
    }));
  `;

  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  const result = JSON.parse(output);
  assert.equal(result.commandRegistered, true);
  assert.equal(result.notifications.setup[0].type, 'warning');
  assert.equal(result.notifications.show[0].type, 'info');
});
