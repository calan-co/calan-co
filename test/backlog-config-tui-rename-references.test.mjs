import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('backlog config TUI no longer exposes team editing; pack-derived roles remain visible', () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import piSandcastle from './extensions/pi-sandcastle/index.ts';

    const commands = new Map();
    piSandcastle({ on() {}, registerCommand(name, spec) { commands.set(name, spec); }, registerTool() {} });
    const cwd = mkdtempSync(join(tmpdir(), 'pi-sandcastle-no-teams-'));
    const configDir = join(cwd, '.pi', 'sandcastle');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yaml'), [
            'defaultSandbox: docker',
      'defaultModel: claude-sonnet-4-6',
      'defaultPipeline: simple-loop',
      'defaultAgent: claude-code',
      'workSource: github-issues',
    ].join('\n'));
    writeFileSync(join(configDir, 'run-job.mjs'), '');

    let component;
    const tui = { requestRender() {} };
    const theme = { fg(_name, text) { return String(text); }, bold(text) { return String(text); } };
    const ctx = { cwd, mode: 'tui', ui: { notify() {}, custom(factory) { return new Promise((resolve) => { component = factory(tui, theme, {}, resolve); }); } } };
    const runPromise = commands.get('work:config').handler('', ctx);
    while (!component) await new Promise((resolve) => setTimeout(resolve, 0));
    const text = () => component.render(120).join('\n');
    assert.doesNotMatch(text(), /Teams/);
    component.handleInput('\x1b[B');
    component.handleInput('\r');
    assert.match(text(), /ROLES/);
    assert.match(text(), /worker/);
    component.handleInput('\x11');
    await runPromise;
  `;

  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
});
