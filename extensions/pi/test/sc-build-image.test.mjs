import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import agentWorkflows from '../extensions/agent-workflows/index.ts';

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
  ].join('\n'));
  return cwd;
}

test('/work:build-image maps doc-vader to Sandcastle custom issue tracker and runs setup', async () => {
  const cwd = makeRepo('doc-vader-scaffold', 'podman', { skipSandcastleDir: true });
  writeFileSync(join(cwd, '.pi', 'sandcastle', 'config.yaml'), [
    'defaultSandbox: podman',
    'defaultModel: test-model',
    'defaultPipeline: parallel-planner-with-review',
    'defaultAgent: pi',
    'workSource: doc-vader',
    'workSourceSetupCommand: dv sandcastle init',
  ].join('\n'));
  const bin = join(cwd, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env node\nconst { mkdirSync, writeFileSync } = require('node:fs');\nconst { join } = require('node:path');\nwriteFileSync(join(process.cwd(), 'npx-args.json'), JSON.stringify(process.argv.slice(2)));\nmkdirSync(join(process.cwd(), '.sandcastle'), { recursive: true });\n`);
  writeFileSync(join(bin, 'dv'), `#!/usr/bin/env node\nconst { writeFileSync } = require('node:fs');\nconst { join } = require('node:path');\nwriteFileSync(join(process.cwd(), 'dv-args.json'), JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(join(bin, 'npx'), 0o755);
  chmodSync(join(bin, 'dv'), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  try {
    await pi.commands.get('work:build-image').handler('', {
      cwd,
      ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
    });
  } finally {
    process.env.PATH = originalPath;
  }

  const npxArgs = JSON.parse(readFileSync(join(cwd, 'npx-args.json'), 'utf8'));
  const issueTrackerIndex = npxArgs.indexOf('--issue-tracker');
  assert.equal(npxArgs[issueTrackerIndex + 1], 'custom');
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'dv-args.json'), 'utf8')), ['sandcastle', 'init']);
  assert.equal(calls.length, 1);
  assert.equal(notifications.at(-1).type, 'success');
});

test('/work:build-image initializes a missing Sandcastle scaffold before building', async () => {
  const cwd = makeRepo('missing-scaffold', 'podman', { skipSandcastleDir: true });
  const pi = fakePi();
  const notifications = [];
  const calls = [];
  agentWorkflows(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('work:build-image').handler('', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'podman');
  assert.equal(notifications.some((entry) => /running unattended npx @ai-hero\/sandcastle init/.test(entry.message)), true);
  assert.equal(notifications.at(-1).type, 'success');
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

test('/work:build-image builds the default repo image through injectable image capability', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('work:build-image').handler('', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.deepEqual(calls, [{ repo: cwd, provider: 'docker', imageName: `sandcastle:${cwd.split('/').pop().toLowerCase()}` }]);
  assert.equal(notifications.at(-1).type, 'success');
});

test('/work:build-image defaults to configured defaultSandbox when provider is omitted', async () => {
  const cwd = makeRepo('doc-vader', 'podman');
  const pi = fakePi();
  const calls = [];
  agentWorkflows(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('work:build-image').handler('', {
    cwd,
    ui: { notify() {} },
  });

  assert.equal(calls[0].provider, 'podman');
});

test('/work:run auto-builds a missing docker image before starting Sandcastle', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
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

  await pi.commands.get('work:run').handler('reviewer check this', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls[0].type, 'inspect');
  assert.equal(calls[1].type, 'build');
  assert.equal(calls[1].provider, 'docker');
  assert.equal(notifications.some((entry) => /is missing; rebuilding/.test(entry.message)), true);
  assert.equal(notifications.at(-1).type, 'success');
});


test('/work:config-raw set does not initialize or build the sandbox image', async () => {
  const cwd = makeRepo();
  const pi = fakePi();
  const calls = [];
  const notifications = [];
  agentWorkflows(pi, {
    image: {
      async buildImage(repo, provider, imageName) {
        calls.push({ repo, provider, imageName });
      },
    },
  });

  await pi.commands.get('work:config-raw').handler('set defaultSandbox docker', {
    cwd,
    ui: { notify: (message, type = 'info') => notifications.push({ message, type }) },
  });

  assert.equal(calls.length, 0);
  assert.equal(notifications.some((entry) => /Building Sandcastle/.test(entry.message)), false);
  assert.deepEqual(notifications.at(-1), { message: 'Updated defaultSandbox. Rebuild the sandbox image separately when needed.', type: 'success' });
});
