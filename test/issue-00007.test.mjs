import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00007-backlog-plan-and-next-alias.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const backlogPlanningAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /work:plan and /work:next are registered.',
    message: 'issue 00007 should require command registration',
  },
  {
    criterion: '/work:plan accepts free-form query text and --iterations N controls the number of recommended processing iterations.',
    message: 'issue 00007 should require plan query text and iteration handling',
  },
  {
    criterion: '/work:next uses the same implementation as /work:plan --iterations 1.',
    message: 'issue 00007 should require next alias equivalence',
  },
  {
    criterion: 'Planner output includes item groups, rationale, dependency notes, and recommended pipelines.',
    message: 'issue 00007 should require useful planner output',
  },
  {
    criterion: 'Planning remains ephemeral and creates no durable selection or run records.',
    message: 'issue 00007 should require read-only planning behavior',
  },
  {
    criterion: 'Tests prove command parsing does not confuse query text with flags except for documented options.',
    message: 'issue 00007 should require parsing tests',
  },
];
const backlogPlanningPrdChecks = [
  {
    pattern:
      /16\.\s+As a Pi user, I want `\/work:plan \[query\] --iterations N`, so that I can get a read-only, multi-iteration plan across backlog items\./,
    message: 'the parent PRD should contain the backlog plan user story that drives this work item',
  },
  {
    pattern:
      /17\.\s+As a Pi user, I want `\/work:next \[query\]`, so that I can get the next recommended backlog processing iteration without reading a full plan\./,
    message: 'the parent PRD should contain the backlog next user story that drives this work item',
  },
  {
    pattern:
      /18\.\s+As a Pi user, I want `\/work:next` to be a thin alias of `\/work:plan --iterations 1`, so that the semantics stay simple\./,
    message:
      'the parent PRD should contain the backlog next alias user story that drives this work item',
  },
];

defineIssueDocumentTest({
  commandSurface: 'backlog planning and next alias',
  acceptanceCriteriaChecks: backlogPlanningAcceptanceCriteriaChecks,
  issueId: 'issue 00007',
  issueFileUrl,
  prdChecks: backlogPlanningPrdChecks,
  prdFileUrl,
});
