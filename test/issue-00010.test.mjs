import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const docsFileUrl = new URL('../docs/command-surface.md', import.meta.url);
const documentedCommandSnippets = [
  {
    message: 'issue 00010 should document /work:config-raw',
    snippet: '`/work:config-raw`',
  },
  {
    message: 'issue 00010 should document /work:run',
    snippet: '`/work:run [role] [prompt]`',
  },
  {
    message: 'issue 00010 should document /work:pipeline',
    snippet: '`/work:pipeline <pipeline> [prompt]`',
  },
  {
    message: 'issue 00010 should document /work:runs',
    snippet: '`/work:runs`',
  },
  {
    message: 'issue 00010 should document /work:status',
    snippet: '`/work:status [run-id]`',
  },
  {
    message: 'issue 00010 should document /work:logs',
    snippet: '`/work:logs [run-id]`',
  },
  {
    message: 'issue 00010 should document /work:cancel',
    snippet: '`/work:cancel [run-id|all]`',
  },
  {
    message: 'issue 00010 should document /work:resume',
    snippet: '`/work:resume [run-id]`',
  },
  {
    message: 'issue 00010 should document /work:list',
    snippet: '`/work:list [query]`',
  },
  {
    message: 'issue 00010 should document /work:plan',
    snippet: '`/work:plan [query] --iterations N`',
  },
  {
    message: 'issue 00010 should document /work:next',
    snippet: '`/work:next [query]`',
  },
  {
    message: 'issue 00010 should document /work:inspect',
    snippet: '`/work:inspect <item>`',
  },
  {
    message: 'issue 00010 should document /work:process',
    snippet: '`/work:process [query] --pipeline <pipeline>`',
  },
  {
    message: 'issue 00010 should document /work:runs',
    snippet: '`/work:runs`',
  },
  {
    message: 'issue 00010 should document /work:status',
    snippet: '`/work:status [run-id]`',
  },
  {
    message: 'issue 00010 should document /work:resume',
    snippet: '`/work:resume [run-id]`',
  },
];
const requiredDocsSnippets = [
  {
    message: 'issue 00010 should document the command surface heading',
    snippet: '# Agent Workflows command surface',
  },
  {
    message: 'issue 00010 should explain the /work:* command namespace',
    snippet: '`/work:*` commands for runtime configuration, primitive role execution, workflow runs, Work discovery, planning, durable processing, and run management.',
  },
  {
    message: 'issue 00010 should document setup and storage',
    snippet: '.pi/sandcastle/results',
  },
  {
    message: 'issue 00010 should document /work:config-raw init semantics',
    snippet:
      '`/work:config-raw init` hydrates missing repo-local files and prompt templates without overwriting existing edits.',
  },
  {
    message: 'issue 00010 should document graph pipeline execution',
    snippet: '`/work:pipeline <pipeline> [prompt]` runs a graph-native Pipeline directly, with legacy `steps[]` fallback for older configs.',
  },
  {
    message: 'issue 00010 should explain deterministic query parsing',
    snippet: 'all non-flag text as query text',
  },
  {
    message: 'issue 00010 should require explicit pipeline selection',
    snippet: 'Pipeline selection is explicit through `--pipeline` or `-p`.',
  },
  {
    message: 'issue 00010 should include troubleshooting guidance',
    snippet: 'If `/work:process` appears to treat query text as a pipeline',
  },
  {
    message: 'issue 00010 should define where durable state begins',
    snippet:
      'Durable state begins when `/work:process` or `/work:resume` executes an adapter-backed graph pipeline.'
  },
  {
    message: 'issue 00010 should reserve a separate namespace for PR workflows',
    snippet: 'Future PR workflow belongs under a separate `/pr:*` namespace.',
  },
  ...documentedCommandSnippets,
];

function assertIncludesRequiredDocsSnippets(docsText) {
  for (const { message, snippet } of requiredDocsSnippets) {
    assert.ok(docsText.includes(snippet), message);
  }
}

test('issue 00010 documents the Sandcastle and backlog command surface', async () => {
  const docsText = await fs.readFile(docsFileUrl, 'utf8');

  assertIncludesRequiredDocsSnippets(docsText);
});
