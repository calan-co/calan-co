#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [taskId] = process.argv.slice(2);

if (!taskId) {
  console.error("Usage: close <task-id>");
  process.exit(1);
}

function findWorkItemPath(id) {
  if (!existsSync("backlog")) return undefined;
  const padded = id.replace(/^wi-/, "").padStart(3, "0");
  return readdirSync("backlog")
    .filter((name) => name.startsWith(`${padded}_`) && name.endsWith(".md"))
    .map((name) => join("backlog", name))[0];
}

function upsertFrontmatterField(frontmatter, field, value) {
  const line = `${field}: ${value}`;
  const pattern = new RegExp(`^${field}:.*$`, "m");
  if (pattern.test(frontmatter)) return frontmatter.replace(pattern, line);
  return `${frontmatter}\n${line}`;
}

function closeWorkItem(id) {
  const path = findWorkItemPath(id);
  if (!path) throw new Error(`Work Item not found: ${id}`);
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Work Item has no frontmatter: ${path}`);
  let frontmatter = match[1];
  let body = match[2];
  frontmatter = upsertFrontmatterField(frontmatter, "status", "completed");
  frontmatter = upsertFrontmatterField(frontmatter, "status_reason", "completed");
  frontmatter = upsertFrontmatterField(frontmatter, "completed_date", `'${new Date().toISOString().slice(0, 10)}'`);
  body = body.replace(/- \[ \]/g, "- [x]");
  writeFileSync(path, `---\n${frontmatter}\n---\n${body}`);
}

try {
  closeWorkItem(taskId);
  console.log(`Closed ${taskId} as completed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
