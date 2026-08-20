const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

async function waitFor(checkFn, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 150;
  const description = options.description ?? "condition";
  const start = Date.now();

  // Keep polling until the check returns a truthy value or timeout.
  while (Date.now() - start < timeoutMs) {
    const result = await checkFn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function getWorkspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert(folder, "Expected an opened workspace folder");
  return folder.uri.fsPath;
}

function hasTempleDiagnostic(diagnostics) {
  return diagnostics.some((diag) => {
    const source = (diag.source ?? "").toLowerCase();
    return (
      source.includes("temple") ||
      source.includes("template") ||
      /expected|unexpected|token|unclosed|brace|syntax|tag/i.test(diag.message)
    );
  });
}

function completionLabels(result) {
  if (!result || !Array.isArray(result.items)) {
    return [];
  }
  return result.items.map((item) =>
    typeof item.label === "string" ? item.label : item.label?.label
  );
}

function runStrategyResolverTests(testing) {
  const registryWithEmbedded = new testing.DefaultBaseLintCapabilityRegistry([
    "json",
  ]);
  const registryWithoutEmbedded = new testing.DefaultBaseLintCapabilityRegistry([]);

  const autoEmbedded = testing.resolveBaseLintStrategy({
    mode: "auto",
    detectedFormat: "json",
    capabilities: registryWithEmbedded.capabilitiesForFormat("json"),
  });
  assert.equal(
    autoEmbedded.strategy,
    "embedded",
    "auto mode should prefer embedded adapter when available"
  );

  const vscodeMode = testing.resolveBaseLintStrategy({
    mode: "vscode",
    detectedFormat: "json",
    capabilities: registryWithEmbedded.capabilitiesForFormat("json"),
  });
  assert.equal(
    vscodeMode.strategy,
    "virtual",
    "vscode mode should bypass embedded strategy"
  );

  const markdownFallback = testing.resolveBaseLintStrategy({
    mode: "auto",
    detectedFormat: "markdown",
    capabilities: registryWithoutEmbedded.capabilitiesForFormat("markdown"),
  });
  assert.equal(
    markdownFallback.strategy,
    "virtual",
    "markdown should use virtual strategy by default"
  );

  const embeddedFallback = testing.resolveBaseLintStrategy({
    mode: "embedded",
    detectedFormat: "yaml",
    capabilities: registryWithoutEmbedded.capabilitiesForFormat("yaml"),
  });
  assert.equal(
    embeddedFallback.strategy,
    "virtual",
    "embedded mode should fall back when no embedded adapter is registered"
  );
}

function runMirrorPathTests(testing, markdownTemplatePath) {
  const markdownUri = vscode.Uri.file(markdownTemplatePath);
  const mirrorUri = testing.resolveMirrorFileTargetUri(markdownUri, "markdown");
  assert.ok(
    mirrorUri.fsPath.includes(testing.MIRROR_GHOST_DIRNAME),
    "mirror-file path should use Temple shadow cache directory"
  );
  assert.ok(
    mirrorUri.fsPath.endsWith(".md"),
    "markdown mirror-file should use .md extension"
  );
  testing.cleanupMirrorFileTargetUri(mirrorUri);
}

async function runIntegrationTests() {
  const extension = vscode.extensions.getExtension(
    "squirrel289.vscode-temple-linter"
  );
  assert(extension, "Temple extension should be discoverable in extension host");
  await extension.activate();
  assert.equal(extension.isActive, true, "Temple extension should activate");
  assert(
    extension.exports?.__testing,
    "Expected extension testing helpers to be exported"
  );
  runStrategyResolverTests(extension.exports.__testing);

  const workspaceRoot = getWorkspaceRoot();

  // 1) Base extension templated files resolve to format-specific Temple IDs.
  const markdownTemplatePath = path.join(
    workspaceRoot,
    "examples",
    "templates",
    "bench",
    "real_small.md.tmpl"
  );
  const markdownDoc = await vscode.workspace.openTextDocument(markdownTemplatePath);
  await vscode.window.showTextDocument(markdownDoc);
  assert.equal(
    markdownDoc.languageId,
    "templ-markdown",
    "Expected .md.tmpl files to use templ-markdown language id"
  );
  runMirrorPathTests(extension.exports.__testing, markdownTemplatePath);

  // 2) Diagnostics should appear end-to-end from Temple LSP for malformed template syntax.
  const integrationScratchRoot = path.join(workspaceRoot, ".debug", "vscode-it");
  await fs.mkdir(integrationScratchRoot, { recursive: true });
  const malformedTemplatePath = path.join(integrationScratchRoot, "broken.tmpl");
  try {
    await fs.writeFile(malformedTemplatePath, "{{ user. }}\n", "utf8");
    const malformedDoc = await vscode.workspace.openTextDocument(
      malformedTemplatePath
    );
    await vscode.window.showTextDocument(malformedDoc);
    assert.equal(
      malformedDoc.languageId,
      "templ-any",
      "Expected plain .tmpl files to use templ-any language id"
    );

    const diagnostics = await waitFor(
      async () => {
        const current = vscode.languages.getDiagnostics(malformedDoc.uri);
        return current.length > 0 ? current : null;
      },
      {
        description: "any diagnostics for malformed plain template",
        timeoutMs: 45000,
      }
    );
    assert.ok(
      hasTempleDiagnostic(diagnostics),
      `Expected at least one Temple diagnostic for malformed template, got: ${diagnostics
        .map((diag) => `${diag.source ?? "<none>"}: ${diag.message}`)
        .join(" | ")}`
    );
  } finally {
    await fs.rm(malformedTemplatePath, { force: true });
  }

  // 3) Completion should include template statement keywords.
  const completionTemplatePath = path.join(integrationScratchRoot, "completion.md.tmpl");
  try {
    await fs.writeFile(completionTemplatePath, "{% in %}\n", "utf8");
    const completionDoc = await vscode.workspace.openTextDocument(
      completionTemplatePath
    );
    await vscode.window.showTextDocument(completionDoc);

    const labels = await waitFor(
      async () => {
        const result = await vscode.commands.executeCommand(
          "vscode.executeCompletionItemProvider",
          completionDoc.uri,
          new vscode.Position(0, 5)
        );
        const currentLabels = completionLabels(result);
        return currentLabels.includes("include") ? currentLabels : null;
      },
      { description: "Temple completion keyword 'include'" }
    );

    assert.ok(
      labels.includes("include"),
      "Expected completion items to include 'include'"
    );
  } finally {
    await fs.rm(completionTemplatePath, { force: true });
  }
}

module.exports = { runIntegrationTests };
