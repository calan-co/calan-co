import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const extensionEntry = "extensions/triage-control-plane/index.ts";

test("triage-control-plane is packaged as a Pi extension", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

  assert.ok(packageJson.pi.extensions.includes(extensionEntry));
  await access(join(root.pathname, extensionEntry));

  const entrypoint = await import(new URL(`../${extensionEntry}`, import.meta.url));
  assert.equal(typeof entrypoint.default, "function");
});
