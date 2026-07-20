import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const architectureUrl = new URL('../docs/architecture/pi-sandcastle-execution-runtime.md', import.meta.url);
const adrUrl = new URL('../docs/adr/0003-graph-native-workflow-runtime.md', import.meta.url);

function assertIncludes(text, snippets) {
  for (const snippet of snippets) assert.ok(text.includes(snippet), `missing architecture snippet: ${snippet}`);
}

test('Agent Workflows architecture docs capture graph-native end-to-end design', async () => {
  const [architecture, adr] = await Promise.all([
    fs.readFile(architectureUrl, 'utf8'),
    fs.readFile(adrUrl, 'utf8'),
  ]);

  assertIncludes(architecture, [
    '# Agent Workflows execution runtime',
    'Agent Workflows is now **graph-native by default**',
    'Declarative → imperative → runtime → reasoning',
    'Example 1: direct graph pipeline',
    'Example 2: durable process fan-out with review and merge',
    'Example 3: graph config editing from root-only defaults',
    'Example 4: legacy `steps[]` fallback',
    'Sandcastle adapter',
    'Logs and log paths remain observable artifacts, but they do not count as repository effects.',
  ]);

  assertIncludes(adr, [
    '# Graph-native workflow runtime',
    '## Status\n\nAccepted',
    'Declarative layer',
    'Imperative orchestration layer',
    'Runtime adapter layer',
    'Reasoning layer',
    'Legacy `steps[]` remain as compatibility metadata and fallback',
  ]);
});
