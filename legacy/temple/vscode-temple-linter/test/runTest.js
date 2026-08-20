const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { runTests } = require("@vscode/test-electron");

async function main() {
  // This env var is set in some headless CI/sandbox shells and forces Electron
  // to behave like plain Node, which breaks VS Code test host startup.
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
  const workspacePath = path.resolve(__dirname, "..", "..");
  const profileRoot = path.resolve(
    extensionDevelopmentPath,
    ".vscode-test",
    "integration-profile"
  );
  const userDataDir = path.join(profileRoot, "user-data");
  const extensionsDir = path.join(profileRoot, "extensions");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      `--folder-uri=${pathToFileURL(workspacePath).toString()}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ],
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("VS Code integration tests failed:", error);
  process.exitCode = 1;
});
