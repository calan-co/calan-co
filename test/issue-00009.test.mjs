import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueId = 'issue 00009';
const issueFileUrl = new URL(
  '../backlog/00009-backlog-run-management-commands.md',
  import.meta.url,
);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const backlogRunManagementAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /backlog:runs, /backlog:status, and /backlog:resume are registered.',
    message: `${issueId} should require command registration`,
  },
  {
    criterion: '/backlog:runs lists backlog process runs and supports deterministic filtering by query text or item id.',
    message: `${issueId} should require filtered backlog run listing`,
  },
  {
    criterion: '/backlog:status infers active/latest backlog run when safe and reports ambiguity when multiple candidates exist.',
    message: `${issueId} should require safe status inference`,
  },
  {
    criterion: '/backlog:resume resumes only durable process runs with resumable provider/session metadata.',
    message: `${issueId} should require guarded resume behavior`,
  },
  {
    criterion: 'Missing or non-resumable runs return clear user-facing errors without mutating records.',
    message: `${issueId} should require deterministic error behavior`,
  },
  {
    criterion: 'Tests cover run-store behavior with no real Sandcastle containers.',
    message: `${issueId} should require fake run-store tests`,
  },
];
const backlogRunManagementStories = [
  {
    storyName: 'backlog runs user story',
    pattern:
      /26\.\s+As a Pi user, I want `\/backlog:runs`, so that I can list durable backlog processing runs\./,
  },
  {
    storyName: 'backlog status user story',
    pattern:
      /27\.\s+As a Pi user, I want `\/backlog:status \[run-id\]`, so that I can inspect the current\/latest\/specified backlog processing run\./,
  },
  {
    storyName: 'backlog resume user story',
    pattern:
      /28\.\s+As a Pi user, I want `\/backlog:resume \[run-id\]`, so that I can continue the latest failed\/interrupted run by default and specify an ID only for disambiguation\./,
  },
];
const backlogRunManagementPrdChecks = backlogRunManagementStories.map(
  ({ pattern, storyName }) => ({
    pattern,
    message: `the parent PRD should contain the ${storyName} that drives this work item`,
  }),
);

defineIssueDocumentTest({
  commandSurface: 'backlog run management commands',
  acceptanceCriteriaChecks: backlogRunManagementAcceptanceCriteriaChecks,
  issueId,
  issueFileUrl,
  prdChecks: backlogRunManagementPrdChecks,
  prdFileUrl,
});
