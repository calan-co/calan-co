import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00004-fixed-domain-pipeline-execution.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const pipelineStoryPattern =
  /9\.\s+As a Pi user, I want `\/work:pipeline <pipeline> \[prompt\]`, so that I can run a fixed domain pipeline directly\./;
const pipelineAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /work:pipeline is registered by the dev extension.',
    message: 'issue 00004 should require command registration',
  },
  {
    criterion: '/work:pipeline validates the requested pipeline against repo config and rejects unknown names with available options.',
    message: 'issue 00004 should require pipeline-name validation',
  },
  {
    criterion: 'Pipeline execution uses the injected Sandcastle worktree capability and creates/reuses the expected branch strategy.',
    message: 'issue 00004 should require injected worktree capability use',
  },
  {
    criterion: 'Each pipeline step records status, agent role, log path, commits, and errors.',
    message: 'issue 00004 should require per-step run record details',
  },
  {
    criterion: 'Arbitrary inline pipeline definitions are not accepted from the command line.',
    message: 'issue 00004 should forbid arbitrary inline pipeline definitions',
  },
  {
    criterion: 'Tests cover success, unknown pipeline, and failed-step behavior without real containers.',
    message: 'issue 00004 should require behavior tests without containers',
  },
];

defineIssueDocumentTest({
  commandSurface: '/work:pipeline',
  acceptanceCriteriaChecks: pipelineAcceptanceCriteriaChecks,
  issueId: 'issue 00004',
  issueFileUrl,
  prdFileUrl,
  storyMessage:
    'the parent PRD should contain the /work:pipeline user story that drives this work item',
  storyPattern: pipelineStoryPattern,
});
