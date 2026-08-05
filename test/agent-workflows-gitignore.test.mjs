import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import agentWorkflows from '../extensions/agent-workflows/index.ts';

function registerCommands() {
  const commands = new Map();
  agentWorkflows({
    on() {},
    registerCommand(name, spec) {
      commands.set(name, spec);
    },
    registerTool() {},
  });
  return commands;
}

function context(cwd) {
  const notifications = [];
  return {
    ctx: {
      cwd,
      ui: {
        notify(message, type = 'info') {
          notifications.push({ message, type });
        },
      },
    },
    notifications,
  };
}

test('/work:config-raw init creates a sandcastle .gitignore for transient files', async () => {
  const commands = registerCommands();
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-gitignore-'));
  const { ctx } = context(cwd);

  await commands.get('work:config-raw').handler('init', ctx);

  const gitignorePath = join(cwd, '.pi', 'sandcastle', '.gitignore');
  assert.equal(existsSync(gitignorePath), true);
  const gitignore = readFileSync(gitignorePath, 'utf8');
  for (const entry of ['/jobs/', '/results/', '/runs/', '/plans/', '/logs/', '/worktrees/', '/scaffold-state.json', '/editor']) {
    assert.match(gitignore, new RegExp(`^${entry.replaceAll('/', '\\/')}$`, 'm'));
  }
  assert.doesNotMatch(gitignore, /^\/config\.yaml$/m);
});

test('agent-workflows scaffold preserves an existing sandcastle .gitignore', async () => {
  const commands = registerCommands();
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-gitignore-'));
  const configDir = join(cwd, '.pi', 'sandcastle');
  mkdirSync(configDir, { recursive: true });
  const gitignorePath = join(configDir, '.gitignore');
  writeFileSync(gitignorePath, 'custom-entry\n', { flag: 'wx' });
  const { ctx } = context(cwd);

  await commands.get('work:config-raw').handler('init', ctx);

  assert.equal(readFileSync(gitignorePath, 'utf8'), 'custom-entry\n');
});
