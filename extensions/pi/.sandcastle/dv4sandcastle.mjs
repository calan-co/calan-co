#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const [, , command, target] = process.argv;

function usage() {
  console.error('Usage: dv4sandcastle.mjs view <item>');
  process.exitCode = 1;
}

function titleFromFrontmatter(text) {
  return text.match(/^title:\s*(.+)$/m)?.[1]?.trim()?.replace(/^['"]|['"]$/g, '') ?? '';
}

function findBacklogFile(item) {
  const normalized = String(item ?? '').replace(/^wi-/, '');
  const backlogDir = join(cwd, 'backlog');
  if (!existsSync(backlogDir)) return null;
  return readdirSync(backlogDir)
    .filter((name) => name.endsWith('.md'))
    .find((name) => name.startsWith(`${normalized}-`) || name.includes(normalized)) ?? null;
}

function printFile(relativePath, label) {
  const absolutePath = join(cwd, relativePath);
  if (!existsSync(absolutePath)) return;
  const text = readFileSync(absolutePath, 'utf8');
  const title = titleFromFrontmatter(text) || text.match(/^#\s+(.+)$/m)?.[1] || label;
  console.log(`## ${label}`);
  console.log(relativePath);
  console.log(title);
  console.log('');
  console.log(text);
  console.log('');
}

if (command !== 'view' || !target) {
  usage();
} else {
  const issueFile = findBacklogFile(target);
  if (!issueFile) {
    console.error(`No backlog item matched ${target}`);
    process.exitCode = 1;
  } else {
    printFile(`backlog/${issueFile}`, 'Backlog item');
    printFile('docs/prd/sandcastle-backlog-processing.md', 'Reference PRD');
    printFile('backlog/00001-sandcastle-backlog-processing-command-surface-prd.md', 'Parent work item');
  }
}
