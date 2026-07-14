import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWorkBrief } from '../extensions/agent-workflows/work-brief.mjs';

test('renderWorkBrief deterministically renders normalized Work Item detail with preserved source', () => {
  const brief = renderWorkBrief({
    id: 'GH-123',
    title: 'Fix auth callback',
    summary: 'OAuth callback fails on retry.',
    sourcePath: 'https://github.test/repo/issues/123',
    tags: ['bug', 'auth'],
    acceptanceCriteria: ['retry succeeds', 'regression test added'],
    dependencies: ['GH-100'],
    source: {
      body: 'Original issue body with exact user wording.',
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

test('renderWorkBrief requires canonical Work Item id and title', () => {
  assert.throws(() => renderWorkBrief({ title: 'Missing id' }), /Work Item id/);
  assert.throws(() => renderWorkBrief({ id: 'WI-1' }), /Work Item title/);
});
