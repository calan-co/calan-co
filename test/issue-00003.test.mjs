import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00003-sandcastle-api-adapter-and-sc-run.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const scRunStoryPattern =
  /8\.\s+As a Pi user, I want `\/backlog:run \[agent\] \[prompt\]`, so that I can run one Sandcastle-backed agent without invoking a backlog workflow\./;
const scRunAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /backlog:run is registered by the dev extension.',
    message: 'issue 00003 should require command registration',
  },
  {
    criterion: '/backlog:run resolves the default agent when omitted and accepts free-form prompt text without treating words as flags unless explicitly declared.',
    message: 'issue 00003 should require deterministic prompt parsing',
  },
  {
    criterion: '/backlog:run passes resolved Sandcastle options into the injected run capability without invoking real containers or agents in tests.',
    message: 'issue 00003 should require injected Sandcastle capability tests',
  },
  {
    criterion: '/backlog:run writes a durable run record with status, agent, prompt summary, branch, commits, log path, and timestamps.',
    message: 'issue 00003 should require durable run records',
  },
  {
    criterion: '/backlog:run reports the run id, final status, branch, commits, and log path to the user.',
    message: 'issue 00003 should require user-visible run results',
  },
  {
    criterion: 'Tests fail if the handler constructs Sandcastle dependencies inline instead of using the supplied capability.',
    message: 'issue 00003 should require capability boundary tests',
  },
];

defineIssueDocumentTest({
  commandSurface: '/backlog:run',
  acceptanceCriteriaChecks: scRunAcceptanceCriteriaChecks,
  issueId: 'issue 00003',
  issueFileUrl,
  prdFileUrl,
  storyMessage: 'the parent PRD should contain the /backlog:run user story that drives this work item',
  storyPattern: scRunStoryPattern,
});
