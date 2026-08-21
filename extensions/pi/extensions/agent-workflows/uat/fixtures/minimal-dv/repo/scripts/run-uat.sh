#!/usr/bin/env bash
set -euo pipefail

./reset-workspace.sh
mkdir -p .uat
printf 'UAT: running /work:process\n' | tee .uat/work-process.log
pi -p '/work:process' 2>&1 | tee -a .uat/work-process.log
printf 'UAT: validating repository state and authoritative run record\n' | tee -a .uat/work-process.log
node scripts/validate-uat.mjs 2>&1 | tee -a .uat/work-process.log
printf 'UAT: checking ready work list\n' | tee -a .uat/work-process.log
node .sandcastle/dv4sandcastle.mjs list | tee .uat/ready-after.json | tee -a .uat/work-process.log
node -e "const fs=require('fs'); const ready=JSON.parse(fs.readFileSync('.uat/ready-after.json','utf8')); if (ready.length) throw new Error('ready work remains: '+JSON.stringify(ready)); console.log('UAT PASS: no ready AFK work remains; wi-004 was skipped as HITL');" 2>&1 | tee -a .uat/work-process.log
