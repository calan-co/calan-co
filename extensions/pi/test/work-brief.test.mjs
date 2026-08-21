import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWorkBrief } from '../extensions/agent-workflows/work-brief.mjs';

test('renderWorkBrief deterministically renders normalized Work Item detail with preserved source', () => {
  const brief = renderWorkBrief({
    id: 'GH-123',
    title: 'Fix auth callback',
    summary: 'OAuth callback fails on retry.',
    tags: ['bug', 'auth'],
    acceptanceCriteria: ['retry succeeds', 'regression test added'],
    dependencies: ['GH-100'],
    source: {
      adapter: 'github-issues',
      kind: 'github-issue',
      url: 'https://github.test/repo/issues/123',
      body: 'Original issue body with exact user wording.',
      payload: { number: 123, labels: ['bug', 'auth'] },
    },
  });

  assert.equal(brief, [
    '# Work Item GH-123: Fix auth callback',
    '',
    '## Summary',
    '',
    'OAuth callback fails on retry.',
    '',
    '## Source',
    '',
    'https://github.test/repo/issues/123',
    '',
    '## Tags',
    '',
    '- bug',
    '- auth',
    '',
    '## Acceptance Criteria',
    '',
    '- retry succeeds',
    '- regression test added',
    '',
    '## Dependencies',
    '',
    '- GH-100',
    '',
    '## Preserved Source',
    '',
    'Original issue body with exact user wording.',
  ].join('\n'));
});

test('renderWorkBrief keeps compatibility aliases for existing Work Item callers', () => {
  const brief = renderWorkBrief({
    id: 'WI-7',
    title: 'Legacy source fields',
    sourcePath: 'backlog/00007-legacy.md',
    sourceBody: 'Legacy preserved body.',
    dependsOn: ['WI-6'],
  });

  assert.match(brief, /## Source\n\nbacklog\/00007-legacy\.md/);
  assert.match(brief, /## Dependencies\n\n- WI-6/);
  assert.match(brief, /## Preserved Source\n\nLegacy preserved body\./);
});

test('renderWorkBrief requires canonical Work Item id and title', () => {
  assert.throws(() => renderWorkBrief({ title: 'Missing id' }), /Work Item id/);
  assert.throws(() => renderWorkBrief({ id: 'WI-1' }), /Work Item title/);
});
