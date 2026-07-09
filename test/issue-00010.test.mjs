import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const docsFileUrl = new URL('../docs/command-surface.md', import.meta.url);
const documentedCommandSnippets = [
  {
    message: 'issue 00010 should document /backlog:config-raw',
    snippet: '`/backlog:config-raw`',
  },
  {
    message: 'issue 00010 should document /backlog:run',
    snippet: '`/backlog:run [agent] [prompt]`',
  },
  {
    message: 'issue 00010 should document /backlog:pipeline',
    snippet: '`/backlog:pipeline <pipeline> [prompt]`',
  },
  {
    message: 'issue 00010 should document /backlog:runs',
    snippet: '`/backlog:runs`',
  },
  {
    message: 'issue 00010 should document /backlog:status',
    snippet: '`/backlog:status [run-id]`',
  },
  {
    message: 'issue 00010 should document /backlog:logs',
    snippet: '`/backlog:logs [run-id]`',
  },
  {
    message: 'issue 00010 should document /backlog:cancel',
    snippet: '`/backlog:cancel [run-id|all]`',
  },
  {
    message: 'issue 00010 should document /backlog:resume',
    snippet: '`/backlog:resume [run-id]`',
  },
  {
    message: 'issue 00010 should document /backlog:list',
    snippet: '`/backlog:list [query]`',
  },
  {
    message: 'issue 00010 should document /backlog:plan',
    snippet: '`/backlog:plan [query] --iterations N`',
  },
  {
    message: 'issue 00010 should document /backlog:next',
    snippet: '`/backlog:next [query]`',
  },
  {
    message: 'issue 00010 should document /backlog:inspect',
    snippet: '`/backlog:inspect <item>`',
  },
  {
    message: 'issue 00010 should document /backlog:process',
    snippet: '`/backlog:process [query] --pipeline <pipeline>`',
  },
  {
    message: 'issue 00010 should document /backlog:runs',
    snippet: '`/backlog:runs`',
  },
  {
    message: 'issue 00010 should document /backlog:status',
    snippet: '`/backlog:status [run-id]`',
  },
  {
    message: 'issue 00010 should document /backlog:resume',
    snippet: '`/backlog:resume [run-id]`',
  },
];
const requiredDocsSnippets = [
  {
    message: 'issue 00010 should document the command surface heading',
    snippet: '# Sandcastle Backlog Command Surface',
  },
  {
    message: 'issue 00010 should explain the /backlog:* command namespace',
    snippet: '`/backlog:*` for Sandcastle configuration, primitive execution, and run management.',
  },
  {
    message: 'issue 00010 should document setup and storage',
    snippet: '.pi/sandcastle/results',
  },
  {
    message: 'issue 00010 should document /backlog:config-raw init semantics',
    snippet:
      '`/backlog:config-raw init` hydrates missing repo-local files and prompt templates without overwriting existing edits.',
  },
  {
    message: 'issue 00010 should document fixed pipeline execution',
    snippet: '`/backlog:pipeline <pipeline> [prompt]` runs a fixed domain pipeline directly.',
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
    snippet: 'If `/backlog:process` appears to treat query text as a pipeline',
  },
  {
    message: 'issue 00010 should define where durable state begins',
    snippet:
      'Durable state begins when `/backlog:process` or `/backlog:resume` executes a Sandcastle-backed pipeline.',
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
