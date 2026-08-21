import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const acceptanceCriteriaSectionPattern = /## Acceptance Criteria\s+([\s\S]*?)(?:\s+## |\s*$)/;
const parentPrdReferencePattern =
  /reference:\s+[\s\S]*\[\[(?:\.{2}\/docs\/prd\/)?sandcastle-backlog-processing(?:\.md)?\]\][\s\S]*parent:\s+[\s\S]*\[\[00001-sandcastle-backlog-processing-command-surface-prd\]\]/;

async function readIssueAndPrd(issueFileUrl, prdFileUrl) {
  const [issueText, prdText] = await Promise.all([
    fs.readFile(issueFileUrl, 'utf8'),
    fs.readFile(prdFileUrl, 'utf8'),
  ]);

  return { issueText, prdText };
}

function getAcceptanceCriteriaSection(issueText, issueId) {
  const acceptanceCriteriaMatch = issueText.match(acceptanceCriteriaSectionPattern);

  assert.ok(acceptanceCriteriaMatch, `${issueId} should include an acceptance criteria section`);

  return acceptanceCriteriaMatch[1];
}

function assertReferencesParentPrd(issueText, issueId) {
  assert.match(
    issueText,
    parentPrdReferencePattern,
    `${issueId} should reference both the PRD document and its parent PRD work item`,
  );
}

function assertPrdChecks(prdText, prdChecks) {
  for (const { pattern, message } of prdChecks) {
    assert.match(prdText, pattern, message);
  }
}

function resolvePrdChecks({ issueId, prdChecks, storyMessage, storyPattern }) {
  if (prdChecks) {
    return prdChecks;
  }

  assert.ok(
    storyPattern,
    `${issueId} test setup should provide prdChecks or a storyPattern`,
  );
  assert.ok(
    storyMessage,
    `${issueId} test setup should provide prdChecks or a storyMessage`,
  );

  return [{ pattern: storyPattern, message: storyMessage }];
}

function normalizeChecklistState(value) {
  return value.replaceAll('- [x]', '- [ ]');
}

function assertIncludesAllCriteria(acceptanceCriteriaSection, criteriaChecks) {
  const normalizedSection = normalizeChecklistState(acceptanceCriteriaSection);

  for (const { criterion, message } of criteriaChecks) {
    assert.ok(normalizedSection.includes(criterion), message);
  }
}

/**
 * Register a backlog issue document test against the shared Sandcastle PRD.
 *
 * @param {object} options
 * @param {string} options.commandSurface
 * @param {Array<{criterion: string, message: string}>} options.acceptanceCriteriaChecks
 * @param {string} options.issueId
 * @param {URL} options.issueFileUrl
 * @param {URL} options.prdFileUrl
 * @param {Array<{pattern: RegExp, message: string}>} [options.prdChecks]
 * @param {string} [options.storyMessage]
 * @param {RegExp} [options.storyPattern]
 */
export function defineIssueDocumentTest({
  commandSurface,
  acceptanceCriteriaChecks,
  issueId,
  issueFileUrl,
  prdFileUrl,
  prdChecks,
  storyMessage,
  storyPattern,
}) {
  const testName = `${issueId} links the parent PRD and covers the full ${commandSurface} surface`;
  const resolvedPrdChecks = resolvePrdChecks({
    issueId,
    prdChecks,
    storyMessage,
    storyPattern,
  });

  test(testName, async () => {
    const { issueText, prdText } = await readIssueAndPrd(issueFileUrl, prdFileUrl);
    const acceptanceCriteriaSection = getAcceptanceCriteriaSection(issueText, issueId);

    assertReferencesParentPrd(issueText, issueId);
    assertPrdChecks(prdText, resolvedPrdChecks);
    assertIncludesAllCriteria(acceptanceCriteriaSection, acceptanceCriteriaChecks);
  });
}
