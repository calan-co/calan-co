import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueId = 'issue 00008';
const issueFileUrl = new URL(
  '../backlog/00008-backlog-process-deterministic-pipeline-parsing.md',
  import.meta.url,
);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const backlogProcessAcceptanceCriteria = [
  {
    requirement: 'deterministic query parsing',
    criterion: '- [ ] /work:process review treats review as query text, not a pipeline name.',
  },
  {
    requirement: 'explicit pipeline selection',
    criterion: '- [ ] /work:process auth --pipeline implement uses auth as query and implement as pipeline.',
  },
  {
    requirement: 'recommended pipeline inference',
    criterion:
      '- [ ] If no pipeline is supplied, process uses the recommended pipeline from the first planning iteration.',
  },
  {
    requirement: 'durable run record contents',
    criterion:
      '- [ ] Durable run records contain query, resolved items, pipeline, status, branches, logs, and timestamps.',
  },
];
const backlogProcessAcceptanceCriteriaChecks = backlogProcessAcceptanceCriteria.map(
  ({ criterion, requirement }) => ({
    criterion,
    message: `${issueId} should require ${requirement}`,
  }),
);
const backlogProcessStories = [
  {
    storyName: 'backlog process user story',
    pattern:
      /20\.\s+As a Pi user, I want `\/work:process \[query\] --pipeline <pipeline>`, so that I can start durable Sandcastle-backed processing for a backlog item or query\./,
  },
  {
    storyName: 'query acceptance story',
    pattern:
      /21\.\s+As a Pi user, I want `\/work:process` to accept a query, so that I can process “auth bugs” or “label:small” directly without first creating a persistent selection\./,
  },
  {
    storyName: 'explicit pipeline selection story',
    pattern:
      /22\.\s+As a Pi user, I want pipeline selection to be explicit via `--pipeline`, so that query text is never confused with a pipeline name\./,
  },
  {
    storyName: 'recommended pipeline inference story',
    pattern:
      /23\.\s+As a Pi user, I want `\/work:process` to infer a recommended pipeline when `--pipeline` is omitted, so that common workflows require minimal typing\./,
  },
  {
    storyName: 'multi-item processing story',
    pattern:
      /24\.\s+As a Pi user, I want `\/work:process` to support multiple items when the selected pipeline supports parallelism, so that independent backlog work can proceed AFK\./,
  },
];
const backlogProcessPrdChecks = backlogProcessStories.map(({ pattern, storyName }) => ({
  pattern,
  message: `the parent PRD should contain the ${storyName} that drives this work item`,
}));

defineIssueDocumentTest({
  commandSurface: 'backlog process with deterministic pipeline parsing',
  acceptanceCriteriaChecks: backlogProcessAcceptanceCriteriaChecks,
  issueId,
  issueFileUrl,
  prdChecks: backlogProcessPrdChecks,
  prdFileUrl,
});
