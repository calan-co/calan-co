import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00005-sandcastle-run-management-commands.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const runManagementCommands = [
  {
    name: 'runs',
    pattern:
      /10\.\s+As a Pi user, I want `\/sc:runs`, so that I can list recent Sandcastle-backed runs in the current repo\./,
  },
  {
    name: 'status',
    pattern:
      /11\.\s+As a Pi user, I want `\/sc:status \[run-id\]`, so that I can inspect the current, latest, or specified run\./,
  },
  {
    name: 'logs',
    pattern:
      /12\.\s+As a Pi user, I want `\/sc:logs \[run-id\]`, so that I can inspect logs for an AFK run\./,
  },
  {
    name: 'cancel',
    pattern:
      /13\.\s+As a Pi user, I want `\/sc:cancel \[run-id\|all\]`, so that I can stop in-flight Sandcastle work\./,
  },
  {
    name: 'resume',
    pattern:
      /14\.\s+As a Pi user, I want `\/sc:resume \[run-id\]`, so that I can continue interrupted Sandcastle work when the API provider supports resume\./,
  },
];
const names = runManagementCommands.map(({ name }) => `/sc:${name}`);
const runManagementCommandSurface = `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;

const runManagementAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /sc:runs, /sc:status, /sc:logs, /sc:cancel, and /sc:resume are registered.',
    message: 'issue 00005 should require command registration',
  },
  {
    criterion: '/sc:runs lists recent runs for the current repo from durable run records.',
    message: 'issue 00005 should require repo-scoped run listing',
  },
  {
    criterion: '/sc:status infers active/latest run when no id is provided and reports ambiguity instead of guessing when multiple candidates exist.',
    message: 'issue 00005 should require safe status inference',
  },
  {
    criterion: '/sc:logs returns associated log paths for the selected run and clear errors for missing run/log records.',
    message: 'issue 00005 should require log-path reporting and errors',
  },
  {
    criterion: '/sc:cancel aborts active run(s) through injected controllers and updates durable run records.',
    message: 'issue 00005 should require injected cancellation behavior',
  },
  {
    criterion: '/sc:resume resumes only when metadata and provider support make resume possible, and otherwise returns a deterministic unsupported message.',
    message: 'issue 00005 should require guarded resume behavior',
  },
];

defineIssueDocumentTest({
  commandSurface: runManagementCommandSurface,
  acceptanceCriteriaChecks: runManagementAcceptanceCriteriaChecks,
  issueId: 'issue 00005',
  issueFileUrl,
  prdChecks: runManagementCommands.map(({ name, pattern }) => ({
    pattern,
    message: `the parent PRD should contain the /sc:${name} user story that drives this work item`,
  })),
  prdFileUrl,
});
