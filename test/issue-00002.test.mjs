import { defineIssueDocumentTest } from './issue-document-test-helpers.mjs';

const issueFileUrl = new URL('../backlog/00002-sandcastle-config-scaffolding-and-validation.md', import.meta.url);
const prdFileUrl = new URL('../docs/prd/sandcastle-backlog-processing.md', import.meta.url);
const configCommandUserStoryPattern =
  /1\.\s+As a Pi user, I want one Sandcastle config command, so that init, viewing, getting, setting, resetting, and validating config are organized consistently\./;
const configAcceptanceCriteriaChecks = [
  {
    criterion: 'After reload, /sc:config is registered by the dev extension and /sc:config show displays effective repo config.',
    message: 'issue 00002 should require command registration and default show behavior',
  },
  {
    criterion: '/sc:config init creates missing .pi/sandcastle scaffold files and does not overwrite existing edited files without an explicit reset/force path.',
    message: 'issue 00002 should require init idempotency',
  },
  {
    criterion: '/sc:config get <path> returns one value, and missing/unsupported paths return clear user-facing errors.',
    message: 'issue 00002 should require get behavior and errors',
  },
  {
    criterion: '/sc:config set <path> <value> persists supported scalar values and leaves unrelated YAML content intact.',
    message: 'issue 00002 should require safe set behavior',
  },
  {
    criterion: '/sc:config reset restores supported paths to repo defaults without deleting unrelated project files.',
    message: 'issue 00002 should require bounded reset behavior',
  },
  {
    criterion: '/sc:config validate reports invalid agents, prompts, pipelines, models, sandbox providers, and missing runner/config files through the command response.',
    message: 'issue 00002 should require validation diagnostics',
  },
  {
    criterion: 'Tests instantiate the extension through a fake ExtensionAPI and fail if /sc:config is not registered.',
    message: 'issue 00002 should require fake ExtensionAPI registration tests',
  },
];

defineIssueDocumentTest({
  commandSurface: '/sc:config',
  acceptanceCriteriaChecks: configAcceptanceCriteriaChecks,
  issueId: 'issue 00002',
  issueFileUrl,
  prdFileUrl,
  storyMessage:
    'the parent PRD should contain the config-command user story that drives this work item',
  storyPattern: configCommandUserStoryPattern,
});
