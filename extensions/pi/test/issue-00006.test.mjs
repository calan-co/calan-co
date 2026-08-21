import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00006-readonly-backlog-list-and-inspect.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const backlogListUserStoryPattern =
  /15\.\s+As a Pi user, I want `\/work:list \[query\]`, so that I can see matching backlog items without starting work\./;
const backlogInspectUserStoryPattern =
  /19\.\s+As a Pi user, I want `\/work:inspect <item>`, so that I can get item-level analysis, risks, relevant files, and a recommended pipeline without starting work\./;
const acceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /work:list and /work:inspect are registered.',
    message: 'issue 00006 should require command registration',
  },
  {
    criterion: '/work:list [query] returns matching backlog items in deterministic order and reports a clear missing-source error when no backlog source is configured.',
    message: 'issue 00006 should require list behavior and missing-source handling',
  },
  {
    criterion: '/work:inspect <item> returns analysis, risks, relevant files, testing notes, and recommended pipeline for a resolvable item.',
    message: 'issue 00006 should require inspect output',
  },
  {
    criterion: '/work:inspect <item> reports a clear missing-item error when the target cannot be resolved.',
    message: 'issue 00006 should require missing-item handling',
  },
  {
    criterion: 'Neither command creates or modifies run records, selection records, claims, or backlog markdown.',
    message: 'issue 00006 should require read-only behavior',
  },
  {
    criterion: 'Tests use a fake backlog filesystem and fail if the command writes state.',
    message: 'issue 00006 should require fake filesystem write-safety tests',
  },
];

defineIssueDocumentTest({
  commandSurface: 'read-only backlog list and inspect',
  acceptanceCriteriaChecks,
  issueId: 'issue 00006',
  issueFileUrl,
  prdChecks: [
    {
      pattern: backlogListUserStoryPattern,
      message: 'the parent PRD should contain the backlog list user story that drives this work item',
    },
    {
      pattern: backlogInspectUserStoryPattern,
      message: 'the parent PRD should contain the backlog inspect user story that drives this work item',
    },
  ],
  prdFileUrl,
});
