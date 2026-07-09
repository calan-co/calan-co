import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00005-sandcastle-run-management-commands.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const runManagementCommands = [
  {
    name: 'runs',
    pattern:
      /10\.\s+As a Pi user, I want `\/backlog:runs`, so that I can list recent Sandcastle-backed runs in the current repo\./,
  },
  {
    name: 'status',
    pattern:
      /11\.\s+As a Pi user, I want `\/backlog:status \[run-id\]`, so that I can inspect the current, latest, or specified run\./,
  },
  {
    name: 'logs',
    pattern:
      /12\.\s+As a Pi user, I want `\/backlog:logs \[run-id\]`, so that I can inspect logs for an AFK run\./,
  },
  {
    name: 'cancel',
    pattern:
      /13\.\s+As a Pi user, I want `\/backlog:cancel \[run-id\|all\]`, so that I can stop in-flight Sandcastle work\./,
  },
  {
    name: 'resume',
    pattern:
      /14\.\s+As a Pi user, I want `\/backlog:resume \[run-id\]`, so that I can continue interrupted Sandcastle work when the API provider supports resume\./,
  },
];
const names = runManagementCommands.map(({ name }) => `/backlog:${name}`);
const runManagementCommandSurface = `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;

const runManagementAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /backlog:runs, /backlog:status, /backlog:logs, /backlog:cancel, and /backlog:resume are registered.',
    message: 'issue 00005 should require command registration',
  },
  {
    criterion: '/backlog:runs lists recent runs for the current repo from durable run records.',
    message: 'issue 00005 should require repo-scoped run listing',
  },
  {
    criterion: '/backlog:status infers active/latest run when no id is provided and reports ambiguity instead of guessing when multiple candidates exist.',
    message: 'issue 00005 should require safe status inference',
  },
  {
    criterion: '/backlog:logs returns associated log paths for the selected run and clear errors for missing run/log records.',
    message: 'issue 00005 should require log-path reporting and errors',
  },
  {
    criterion: '/backlog:cancel aborts active run(s) through injected controllers and updates durable run records.',
    message: 'issue 00005 should require injected cancellation behavior',
  },
  {
    criterion: '/backlog:resume resumes only when metadata and provider support make resume possible, and otherwise returns a deterministic unsupported message.',
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
    message: `the parent PRD should contain the /backlog:${name} user story that drives this work item`,
  })),
  prdFileUrl,
});
