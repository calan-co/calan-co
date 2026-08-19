import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

let checkout;
try {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" });
  checkout = { sha, clean: status === "" };
  if (!checkout.clean) {
    json({ schemaVersion: "babysitter-pilot-rehearsal/v1", status: "blocked", checkout, reason: "checkout is not clean" });
    process.exitCode = 1;
  } else {
    const command = [process.execPath, "--test", "test/babysitter-blueprint-e2e.test.mjs"];
    const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    json({
      schemaVersion: "babysitter-pilot-rehearsal/v1",
      status: result.status === 0 ? "passed" : "failed",
      checkout,
      command,
      disposableRepository: true,
      evidence: { format: "node-test-tap", sha256: sha256(output) },
    });
    process.exitCode = result.status === 0 ? 0 : 1;
  }
} catch (error) {
  json({ schemaVersion: "babysitter-pilot-rehearsal/v1", status: "failed", checkout, reason: error instanceof Error ? error.message : "unknown failure" });
  process.exitCode = 1;
}
