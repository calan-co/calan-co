import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root exposes pinned install, test, check, and disposable-pilot rehearsal commands", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.match(pkg.packageManager, /^npm@\d+\.\d+\.\d+$/);
  for (const script of ["test", "check", "pilot:rehearse"]) assert.equal(typeof pkg.scripts?.[script], "string", script);
  assert.match(pkg.scripts["pilot:rehearse"], /pilot-rehearsal/);
});

test("blueprint package is independently installable without a floating SDK dependency", async () => {
  const pkg = JSON.parse(await readFile(new URL("../blueprints/babysitter-afk-v6/package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.match(pkg.packageManager, /^npm@\d+\.\d+\.\d+$/);
  assert.equal(pkg.exports, "./process.mjs");
  assert.ok(!Object.values(pkg.dependencies ?? {}).some((version) => /[~^*]/.test(version)));
});

test("root and blueprint commits carry npm lockfiles", async () => {
  for (const lockfile of ["../package-lock.json", "../blueprints/babysitter-afk-v6/package-lock.json"]) {
    const lock = JSON.parse(await readFile(new URL(lockfile, import.meta.url), "utf8"));
    assert.equal(lock.lockfileVersion, 3, lockfile);
  }
});
