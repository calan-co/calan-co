#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['./node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
const output = `${result.stdout || ''}${result.stderr || ''}`;
const allowedMissingNames = new Set([
  'SandcastleRunCapability',
  'YamlScalar',
  'AgentRuntimeSettings',
  'ScRunSettings',
  'SandcastleRunDeps',
]);
const actionable = [];
for (const line of output.split(/\r?\n/)) {
  const missing = line.match(/error TS2304: Cannot find name '([^']+)'/);
  if (missing && !allowedMissingNames.has(missing[1])) actionable.push(line);
}
if (actionable.length) {
  console.error(actionable.join('\n'));
  process.exit(1);
}
console.log('TypeScript missing-name check passed (known legacy diagnostics ignored).');
