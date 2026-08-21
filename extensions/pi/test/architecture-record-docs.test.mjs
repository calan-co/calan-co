import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readmeUrl = new URL('../extensions/agent-workflows/README.md', import.meta.url);
const commandSurfaceUrl = new URL('../docs/command-surface.md', import.meta.url);
const adr0002Url = new URL('../docs/adr/0002-agent-workflows-rename-and-orchestration-seams.md', import.meta.url);
const runtimeArchitectureUrl = new URL('../docs/architecture/pi-sandcastle-execution-runtime.md', import.meta.url);

function extractCommandEntry(docsText, command) {
  const line = docsText
    .split('\n')
    .find((candidate) => candidate.trim().startsWith(`- \`${command}`));
  assert.ok(line, `expected ${command} to be documented`);
  const match = line.trim().match(/^- `([^`]+)`\s*(?:—\s*)?(.*)$/);
  assert.ok(match, `expected ${command} documentation to use a command bullet`);
  return { signature: match[1], description: match[2] };
}

test('/work:cancel documentation is consistent between README and command surface', async () => {
  const [readme, commandSurface] = await Promise.all([
    fs.readFile(readmeUrl, 'utf8'),
    fs.readFile(commandSurfaceUrl, 'utf8'),
  ]);

  const readmeCancel = extractCommandEntry(readme, '/work:cancel');
  const commandSurfaceCancel = extractCommandEntry(commandSurface, '/work:cancel');

  assert.deepEqual(readmeCancel, commandSurfaceCancel);
  assert.equal(readmeCancel.signature, '/work:cancel [run-id|all]');
  assert.equal(readmeCancel.description, 'cancels active Work Process work when supported.');
  assert.doesNotMatch(readmeCancel.description, /reserved/i);
});

test('ADR-0002 explicitly points to ADR-0003 and ADR-0004 as current refinements', async () => {
  const adr0002 = await fs.readFile(adr0002Url, 'utf8');

  assert.match(
    adr0002,
    /ADR 0003 amends this pipeline model: graph-native workflow config is the authoritative pipeline representation\./,
  );
  assert.match(
    adr0002,
    /ADR 0004 refines this Work Source seam: each repository selects exactly one named Work Source Registration/,
  );
});

test('architecture docs record unified Run Record lifecycle ownership', async () => {
  const [adr0002, runtimeArchitecture] = await Promise.all([
    fs.readFile(adr0002Url, 'utf8'),
    fs.readFile(runtimeArchitectureUrl, 'utf8'),
  ]);

  assert.match(runtimeArchitecture, /Run Record lifecycle is unified behind `run-management\.mjs`\./);
  assert.match(
    runtimeArchitecture,
    /Only `.pi\/sandcastle\/runs\/` is supported for durable direct-role, pipeline, and Work Process records/,
  );
  assert.match(
    runtimeArchitecture,
    /obsolete `.pi\/sandcastle\/backlog-runs\/` and `.pi\/sandcastle\/results\/` Work Process record directories are ignored/,
  );
  assert.match(
    runtimeArchitecture,
    /`work-runs\.mjs` provides Work Process-specific projection, status formatting, and Work Source Registration drift checks on top of unified Run Records/,
  );
  assert.match(adr0002, /Run Records are written only by the Orchestrator\./);
  assert.match(adr0002, /Run Record lifecycle is unified behind the generic run-management module/);
  assert.doesNotMatch(runtimeArchitecture, /deferred until legacy Work Process compatibility/);
  assert.doesNotMatch(adr0002, /deferred until legacy Work Process compatibility/);
});
