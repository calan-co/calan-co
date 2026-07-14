import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSandcastleImage, resolveBuildSandcastleImageCommand } from '../extensions/agent-workflows/build-image.ts';

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-build-image-'));
  mkdirSync(join(cwd, '.sandcastle'), { recursive: true });
  return cwd;
}

test('resolveBuildSandcastleImageCommand builds docker from .sandcastle with uid/gid args', () => {
  const cwd = repo();
  writeFileSync(join(cwd, '.sandcastle', 'Dockerfile'), 'FROM alpine\n');
  const command = resolveBuildSandcastleImageCommand({ cwd, provider: 'docker', imageName: 'sandcastle:test' });
  assert.equal(command.command, 'docker');
  assert.equal(command.cwd, cwd);
  assert.equal(command.args[0], 'build');
  assert.deepEqual(command.args.slice(1, 3), ['-t', 'sandcastle:test']);
  assert.equal(command.args.at(-1), resolve(cwd, '.sandcastle'));
  if (process.getuid) assert.ok(command.args.includes(`AGENT_UID=${process.getuid()}`));
  if (process.getgid) assert.ok(command.args.includes(`AGENT_GID=${process.getgid()}`));
});

test('resolveBuildSandcastleImageCommand maps alternate container file and cwd build context', () => {
  const cwd = repo();
  writeFileSync(join(cwd, '.sandcastle', 'Containerfile'), 'FROM alpine\n');
  const command = resolveBuildSandcastleImageCommand({ cwd, provider: 'docker', imageName: 'sandcastle:test' });
  assert.ok(command.args.includes('-f'));
  assert.ok(command.args.includes(resolve(cwd, '.sandcastle', 'Containerfile')));
  assert.equal(command.args.at(-1), cwd);
});

test('buildSandcastleImage executes provider directly without sandcastle CLI', async () => {
  const cwd = repo();
  const calls = [];
  await buildSandcastleImage({
    cwd,
    provider: 'podman',
    imageName: 'sandcastle:test',
    execFile: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: '', stderr: '' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'podman');
  assert.equal(calls[0].args[0], 'build');
  assert.equal(calls[0].options.cwd, cwd);
});

test('buildSandcastleImage requires .sandcastle scaffold', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-workflows-build-image-missing-'));
  await assert.rejects(() => buildSandcastleImage({ cwd, provider: 'docker', imageName: 'sandcastle:test', execFile: async () => ({ stdout: '', stderr: '' }) }), /\.sandcastle/);
});
