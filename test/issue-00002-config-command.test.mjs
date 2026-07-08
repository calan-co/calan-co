import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('issue 00002 registers /sc:config and manages repo-local config', () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
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
    assert.ok(commands.has('sc:config'));

    const cwd = mkdtempSync(join(tmpdir(), 'pi-sandcastle-config-'));
    const configDir = join(cwd, '.pi', 'sandcastle');
    const configPath = join(configDir, 'agents.yaml');
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
        'defaultTeam: default',
        'defaultSandbox: docker',
        'defaultModel: custom-model',
        '',
        'agents:',
        '  researcher:',
        '    description: Custom researcher',
        '    model: custom-model',
        '    sandbox: docker',
        '    maxIterations: 1',
        '    systemPrompt: |',
        '      Keep this edit.',
        '',
        'teams:',
        '  default: [researcher]',
        '',
        'chains:',
        '  explore-plan-review:',
        '    - agent: researcher',
        '      prompt: |',
        '        Keep this too.',
        '',
        'extraRoot: keep-me',
      ].join('\n'),
    );

    const invoke = async (args) => {
      notifications.length = 0;
      await commands.get('sc:config').handler(args, ctx);
      return notifications.map(({ message, type }) => ({ message, type }));
    };

    const setupNotifications = await invoke('setup');
    assert.equal(setupNotifications[0].type, 'success');
    assert.equal(readFileSync(configPath, 'utf8').includes('extraRoot: keep-me'), true);
    assert.equal(existsSync(runnerPath), true);

    const showNotifications = await invoke('');
    assert.equal(showNotifications[0].type, 'info');
    assert.match(showNotifications[0].message, /"defaultTeam": "default"/);
    assert.match(showNotifications[0].message, /"defaultModel": "custom-model"/);

    const getNotifications = await invoke('get defaultTeam');
    assert.deepEqual(getNotifications, [{ message: 'default', type: 'info' }]);

    const setNotifications = await invoke('set defaultModel claude-opus-4-8');
    assert.deepEqual(setNotifications, [{ message: 'Updated defaultModel.', type: 'success' }]);
    assert.match(readFileSync(configPath, 'utf8'), /defaultModel: claude-opus-4-8/);
    assert.match(readFileSync(configPath, 'utf8'), /extraRoot: keep-me/);

    const resetNotifications = await invoke('reset defaultModel');
    assert.deepEqual(resetNotifications, [{ message: 'Reset defaultModel to defaults.', type: 'success' }]);
    assert.match(readFileSync(configPath, 'utf8'), /defaultModel: claude-opus-4-8/);

    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('sandbox: docker', 'sandbox: spaceship'));
    rmSync(runnerPath);
    const validateNotifications = await invoke('validate');
    assert.equal(validateNotifications[0].type, 'error');
    assert.match(validateNotifications[0].message, /unsupported sandbox provider 'spaceship'/i);
    assert.match(validateNotifications[0].message, /Missing runner scaffold: \.pi\/sandcastle\/run-job\.mjs/);

    console.log(JSON.stringify({
      commandRegistered: commands.has('sc:config'),
      notifications: {
        setup: setupNotifications,
        show: showNotifications,
        get: getNotifications,
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
  assert.equal(result.notifications.setup[0].type, 'success');
  assert.equal(result.notifications.get[0].message, 'default');
});
