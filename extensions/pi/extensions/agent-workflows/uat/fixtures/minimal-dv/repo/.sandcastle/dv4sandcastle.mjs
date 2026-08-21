#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function defaultDvCommand() {
  return existsSync("cli/doc-vader.ts") ? "node --import tsx cli/doc-vader.ts" : "dv";
}

const dvCommand = process.env.DV_COMMAND ?? defaultDvCommand();

function splitCommand(command) {
  const result = [];
  let current = "";
  let quote = null;
  for (const char of command) {
    if ((char === "'" || char === '"') && quote === null) { quote = char; continue; }
    if (char === quote) { quote = null; continue; }
    if (/\s/.test(char) && quote === null) {
      if (current) result.push(current), current = "";
      continue;
    }
    current += char;
  }
  if (current) result.push(current);
  return result;
}

function runDv(args, input) {
  const [command, ...baseArgs] = splitCommand(dvCommand);
  return execFileSync(command, [...baseArgs, ...args], {
    encoding: "utf8",
    input,
    stdio: input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "pipe", "inherit"],
    env: { ...process.env, CI: "true", TMPDIR: process.env.TMPDIR ?? "/tmp" },
  });
}

function optionalStdin() {
  return process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseJsonFromCommandOutput(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    for (const match of raw.matchAll(/[\[{]/g)) {
      try {
        return JSON.parse(raw.slice(match.index));
      } catch {
        // Keep scanning: pnpm and lifecycle hooks can prefix stdout with
        // bracketed log lines before the actual JSON payload.
      }
    }
    throw new Error(`Command did not emit JSON: ${raw}`);
  }
}

function normalizeReadyList(raw) {
  const parsed = parseJsonFromCommandOutput(raw);
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates ?? parsed.selectable ?? [];
  return candidates.map((candidate) => ({
    id: String(candidate.id ?? `wi-${candidate.numericId ?? candidate.number}`),
    title: candidate.title ?? candidate.summary ?? String(candidate.id ?? candidate.number),
    body: candidate.body ?? candidate.summary ?? "",
    status: candidate.status,
    priority: candidate.priority,
    filePath: candidate.filePath,
    branch: candidate.branch ?? `sandcastle/issue-${candidate.numericId ?? candidate.id ?? candidate.number}`,
  }));
}

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "list":
      console.log(JSON.stringify(normalizeReadyList(runDv(["work", "ready", "--json", ...args])), null, 2));
      break;
    case "view":
      if (!args[0]) fail("Usage: dv4sandcastle view <task-id>");
      process.stdout.write(runDv(["work", "show", args[0], "--json"]));
      break;
    case "validate":
      if (!args[0]) fail("Usage: dv4sandcastle validate <task-id> [status flags]");
      process.stdout.write(runDv(["work", "status", args[0], ...args.slice(1)]));
      break;
    case "prompt":
      if (!args[0]) fail("Usage: dv4sandcastle prompt <task-id>");
      process.stdout.write(runDv(["work", "prompt", args[0]]));
      break;
    case "claim":
      if (!args[0]) fail("Usage: dv4sandcastle claim <task-id> [claim flags]");
      process.stdout.write(runDv(["work", "claim", args[0], ...args.slice(1)]));
      break;
    case "recover":
      if (!args[0]) fail("Usage: dv4sandcastle recover <task-id> [recover flags]");
      process.stdout.write(runDv(["work", "recover", args[0], ...args.slice(1)]));
      break;
    case "record":
      process.stdout.write(runDv(["work", "record", ...args], optionalStdin()));
      break;
    case "close": {
      if (!args[0]) fail("Usage: dv4sandcastle close <task-id> [close flags]");
      const closeCommand = process.env.DV_SANDCASTLE_CLOSE_COMMAND;
      if (!closeCommand) {
        fail("DV_SANDCASTLE_CLOSE_COMMAND is required for close because terminal transition policy is repository-specific.");
      }
      const result = spawnSync(closeCommand, args, { shell: true, stdio: "inherit", env: process.env });
      process.exit(result.status ?? 1);
      break;
    }
    default:
      fail("Usage: dv4sandcastle <list|view|validate|prompt|claim|recover|record|close> [...args]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
