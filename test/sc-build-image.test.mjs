import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import piSandcastle from '../extensions/pi-sandcastle/index.ts';

function makeRepo(name = 'doc-vader', defaultSandbox = 'docker', options = {}) {
  const cwd = mkdtempSync(join(tmpdir(), `${name}-`));
  mkdirSync(join(cwd, '.pi', 'sandcastle'), { recursive: true });
  if (!options.skipSandcastleDir) {
    mkdirSync(join(cwd, '.sandcastle'), { recursive: true });
    writeFileSync(join(cwd, '.sandcastle', defaultSandbox === 'podman' ? 'Containerfile' : 'Dockerfile'), 'FROM node:25\n');
  }
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
        `defaultSandbox: ${defaultSandbox}`, 
    'defaultModel: test-model',
    '',
    'roles:',
    '  reviewer:',
    '    description: Reviewer',
    '    model: test-model',
    '    sandbox: docker',
    '    maxIterations: 1',
    '',
    '',
    'chains:',
  ].join('\n'));
  return cwd;
}

test('/backlog:build-image reports clear next steps when Sandcastle CLI scaffold is missing', async () => {
  const cwd = makeRepo('missing-scaffold', 'podman', { skipSandcastleDir: true });
  const pi = fakePi();
  const notifications = [];
  piSandcastle(pi, {
    image: {
      async buildImage() {
        throw new Error('should not build without .sandcastle');
      },
    },
  });

  await pi.commands.get('backlog:build-image').handler('', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(notifications.at(-1).type, 'error');
  assert.match(notifications.at(-1).message, /Execution runtime scaffold is missing/);
  assert.match(notifications.at(-1).message, /\/backlog:config-raw init|\/backlog:config/);
});

function fakePi() {
  const commands = new Map();
  return {
    commands,
    on() {},
    registerCommand(name, spec) {
      commands.set(name, spec);
    },
    registerTool() {},
  };
}

test('/backlog:build-image builds the default repo image through injectable image capability', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  piSandcastle(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('backlog:build-image').handler('', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.deepEqual(calls, [{ repo: cwd, provider: 'docker', imageName: `sandcastle:${cwd.split('/').pop().toLowerCase()}` }]);
  assert.equal(notifications.at(-1).type, 'success');
});

test('/backlog:build-image defaults to configured defaultSandbox when provider is omitted', async () => {
  const cwd = makeRepo('doc-vader', 'podman');
  const pi = fakePi();
  const calls = [];
  piSandcastle(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('backlog:build-image').handler('', {
    cwd,
    ui: { notify() {} },
  });

  assert.equal(calls[0].provider, 'podman');
});

test('/backlog:run auto-builds a missing docker image before starting Sandcastle', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  piSandcastle(pi, {
    randomId: () => 'run-1',
    now: () => 100,
    image: {
      async inspectImageCreated() {
        calls.push({ type: 'inspect' });
        return undefined;
      },
      async buildImage(repo, provider, imageName) {
        calls.push({ type: 'build', repo, provider, imageName });
      },
    },
    sandcastle: {
      makeAgent(model) { return { model }; },
      makeSandbox(kind) { return { kind }; },
      async run() { return { branch: 'branch', commits: [], logFilePath: join(cwd, '.pi', 'sandcastle', 'logs', 'run-1.log') }; },
    },
  });

  await pi.commands.get('backlog:run').handler('reviewer check this', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls[0].type, 'inspect');
  assert.equal(calls[1].type, 'build');
  assert.equal(calls[1].provider, 'docker');
  assert.equal(notifications.some((entry) => /is missing; rebuilding/.test(entry.message)), true);
  assert.equal(notifications.at(-1).type, 'success');
});


test('/backlog:config-raw set reinitializes and silently builds configured image', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  piSandcastle(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('backlog:config-raw').handler('set defaultSandbox docker', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'docker');
  assert.equal(notifications.some((entry) => /Building Sandcastle/.test(entry.message)), false);
  assert.deepEqual(notifications.at(-1), { message: 'Updated defaultSandbox.', type: 'success' });
});
