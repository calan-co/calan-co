#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(__dirname, 'fixtures', 'minimal-dv');
const fixtureRepo = join(fixtureRoot, 'repo');

function parseArgs(argv) {
  const options = { keep: false, worktree: undefined, prepareOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--prepare-only') options.prepareOnly = true;
    else if (arg === '--worktree') options.worktree = resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node extensions/agent-workflows/uat/run-minimal-dv-uat.mjs [--keep] [--worktree <path>] [--prepare-only]\n\nCreates a fresh git repo from the minimal Doc-Vader fixture, adds a disposable worktree, runs pi -p '/work:process', validates the end state, and tears down unless --keep is set.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}${details ? `\n${details}` : ''}`);
  }
  return result;
}

function initRepoFromFixture(root) {
  cpSync(fixtureRepo, root, { recursive: true, force: true, preserveTimestamps: true });
  run('git', ['init', '-b', 'main'], { cwd: root, capture: true });
  run('git', ['config', 'user.email', 'agent-workflows-uat@example.invalid'], { cwd: root, capture: true });
  run('git', ['config', 'user.name', 'Agent Workflows UAT'], { cwd: root, capture: true });
  run('git', ['add', '-A'], { cwd: root, capture: true });
  run('git', ['commit', '-m', 'test(uat): minimal dv baseline'], { cwd: root, capture: true });
  run('git', ['tag', '-f', 'golden'], { cwd: root, capture: true });
}

function createFixtureWorktree(repoRoot, requestedWorktree) {
  const worktree = requestedWorktree || join(repoRoot, '..', 'minimal-dv-worktree');
  rmSync(worktree, { recursive: true, force: true });
  run('git', ['worktree', 'add', '-B', 'uat-run', worktree, 'golden'], { cwd: repoRoot, capture: true });
  return worktree;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function frontmatter(path) {
  const text = read(path);
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${path} has no frontmatter`);
  const data = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_$-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return { data, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`);
}

function assertAllChecked(path, text, section) {
  const re = new RegExp(`## ${section}\\n\\n([\\s\\S]*?)(?:\\n## |$)`);
  const match = text.match(re);
  assert(match, `${path} has ${section}`);
  assert(!/- \[ \]/.test(match[1]), `${path} has no unchecked ${section}`);
  assert(/- \[x\]/.test(match[1]), `${path} has checked ${section}`);
}

async function newestWorkProcessRecord(worktree) {
  const runDir = join(worktree, '.pi', 'sandcastle', 'runs');
  assert(existsSync(runDir), 'unified run records directory exists');
  const records = (await readdir(runDir))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => join(runDir, entry))
    .filter((path) => {
      try { return JSON.parse(read(path)).kind === 'work-process'; }
      catch { return false; }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  assert(records.length > 0, 'at least one authoritative Work Process run record exists');
  return JSON.parse(read(records[0]));
}

async function validateUat(worktree) {
  const outputLines = read(join(worktree, 'test.txt')).split(/\r?\n/).filter(Boolean);
  assertEqual(outputLines[0], 'wi-001', 'test.txt starts with the unblocked first wave');
  assertEqual(new Set(outputLines).size, 3, 'test.txt has one line per completed AFK item');
  for (const id of ['wi-001', 'wi-002', 'wi-003']) assert(outputLines.includes(id), `test.txt contains ${id}`);
  for (const id of ['001', '002', '003']) {
    const files = (await readdir(join(worktree, 'backlog'))).filter((name) => name.startsWith(`${id}_`) && name.endsWith('.md'));
    assertEqual(files.length, 1, `found backlog item ${id}`);
    const path = join(worktree, 'backlog', files[0]);
    const { data, text } = frontmatter(path);
    assertEqual(data.status, 'completed', `${data.id} status is completed`);
    assertEqual(data.status_reason, 'completed', `${data.id} status_reason is completed`);
    assertAllChecked(path, text, 'Tasks');
    assertAllChecked(path, text, 'Acceptance Criteria');
  }
  const hitl = frontmatter(join(worktree, 'backlog', '004_hitl_custom_setting.md'));
  assertEqual(hitl.data.status, 'blocked', 'wi-004 remains blocked');
  assert(/- hitl/.test(hitl.text), 'wi-004 is tagged hitl');
  const record = await newestWorkProcessRecord(worktree);
  assertEqual(record.status, 'done', 'authoritative Work Process run record status is done');
  assertEqual(record.pipeline, 'parallel-planner-with-review', 'UAT uses the comprehensive implementation/review/close/merge pipeline');
  const recordText = JSON.stringify(record);
  for (const id of ['wi-001', 'wi-002', 'wi-003']) assert(recordText.includes(id), `run record mentions ${id}`);
  const ready = run('node', ['.sandcastle/dv4sandcastle.mjs', 'list'], { cwd: worktree, capture: true });
  const readyItems = JSON.parse(ready.stdout);
  assertEqual(readyItems.length, 0, 'no AFK-ready Work Items remain');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assert(existsSync(fixtureRepo), `fixture repo exists: ${fixtureRepo}`);
  const tempRoot = mkdtempSync(join(tmpdir(), 'agent-workflows-uat-'));
  const repoRoot = join(tempRoot, 'repo');
  let worktree;
  try {
    initRepoFromFixture(repoRoot);
    worktree = createFixtureWorktree(repoRoot, options.worktree);
    const uatEnv = { ...process.env };
    console.log(`Prepared minimal-dv UAT worktree: ${worktree}`);
    if (options.prepareOnly) return;
    const processRun = spawnSync('pi', ['-p', '/work:process'], {
      cwd: worktree,
      encoding: 'utf8',
      env: uatEnv,
    });
    process.stdout.write(processRun.stdout || '');
    process.stderr.write(processRun.stderr || '');
    assertEqual(processRun.status, 0, "pi -p '/work:process' exits successfully");
    await validateUat(worktree);
    console.log('UAT PASS: minimal-dv fixture completed wi-001..wi-003 via parallel-planner-with-review, skipped wi-004 HITL, and produced authoritative Work Process record.');
  } finally {
    if (options.keep) {
      console.log(`Keeping UAT temp root: ${tempRoot}`);
      if (worktree) console.log(`Keeping UAT worktree: ${worktree}`);
    } else {
      rmSync(tempRoot, { recursive: true, force: true });
      if (options.worktree) rmSync(options.worktree, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
