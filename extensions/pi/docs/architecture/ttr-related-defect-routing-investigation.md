# Code Context

## Files Retrieved
1. `/Users/macos/dev/babysitter-dv/.doc-vader/extensions/manifest.json` (lines 1-11) — identifies the project-local Doc-Vader extension, which is unrelated to `ttr_*`; it points at the Sandcastle issue-tracker package.
2. `/Users/macos/.pi/agent/settings.json` (line 61, found by grep) — enables `+extensions/triage-control-plane/index.ts` from the installed Pi extension package.
3. `/Users/macos/dev/pi-extensions/package.json` (lines 1-45) — package manifest includes `extensions/triage-control-plane/index.ts`; this is the local source package for the installed TTR workflow.
4. `/Users/macos/dev/pi-extensions/extensions/triage-control-plane/index.ts` (lines 8-18, 80-128, 135-140) — state location, POC commands, intake/assignment tools, and supported lane contract.
5. `/Users/macos/dev/pi-extensions/extensions/triage-control-plane/src/core.ts` (lines 17-21, 161-220, 231-240) — POC data model/resolution and the one-defect/one-unique-work-item constraints.
6. `/Users/macos/dev/pi-extensions/extensions/triage-control-plane/README.md` (lines 55-84, 95-111) — documented no-transport boundary and conditional Intercom handoff rule.
7. `/Users/macos/.pi/agent/triage-control-plane/state.json` (lines 3-31, 34-100, 102-170) — live POC registrations and the four recorded Doc-Vader/Babysitter defects, including `unassigned` ownership and the one existing WI assignment.

## Key Code

### Installed source and possible POC
- The installed extension is the **Triage Control Plane (TTR)** source at `/Users/macos/dev/pi-extensions/extensions/triage-control-plane/`, from git remote `https://github.com/calan-co/pi-extensions.git` (observed with `git -C /Users/macos/dev/pi-extensions remote -v`).
- Local state contains an active `ttr` POC and a `pi-extensions` POC, both session `01a00f3d-dbc5-734d-888b-198769d4babd`, bound to `/Users/macos/dev/pi-extensions`: `state.json:11-16,25-30`.
- This is only a **session identifier**, not a named human owner or confirmed reachable endpoint. The state records no `requesterChannel` for it. The extension's `PocRecord` permits that optional field (`core.ts:17-23`), but `/ttr register` only supplies session ID and project boundary (`index.ts:87-90`).
- No local reporting/contact channel is discoverable. The only documented delivery mechanism is conditional: send an Intercom handoff *only after confirming the emitted POC session is an established reachable channel* (`README.md:69-82`; `index.ts:119-120`). Therefore do not treat the session ID as a verified contact route.
- Git metadata is not a human ownership signal: HEAD author is `Agent Workflows UAT <agent-workflows-uat@example.invalid>` (command below). It is explicitly non-routable.

### Why `ownerPocSessionId` is `unassigned`
- POC lookup is exact, normalized domain-key lookup: `resolvePoc(domain)` reads `state.registrations[normalizedDomain(domain)]` (`core.ts:180-184`), and `intake` writes `poc?.sessionId ?? "unassigned"` (`core.ts:205-211`).
- Registered key is `babysitter-dv` (`state.json:4-10`), but recorded defect domains are descriptive strings such as `babysitter-dv lifecycle run adapter/session binding` and `babysitter-dv task:post shell output contract / lifecycle recovery` (`state.json:104-105,153-156`). They do not equal the registered key, so the observed `unassigned` values are expected under current code—not a recovered/automatic fallback.

### Why a second defect cannot use the existing WI
- `assignWorkItem` first rejects a second assignment on the same defect (`core.ts:232-234`), then searches every other defect for matching `workItem.id` and throws `Work item <id> is already authoritative for defect <id>` (`core.ts:237-240`). This exactly explains the observed rejection.
- The data model only has optional singular `workItem?: WorkItem` on each `Defect` (`core.ts:48-64`). It has neither parent/child fields nor a related-defect/work-item-link collection.
- Tool surface confirms no attach/link operation: exposed TTR commands are only register/poc/pocs/deactivate (`index.ts:13-18,80-110`); the relevant tools are intake, assign, transition, lane preparation, and evidence (`index.ts:113-145`).

## Architecture
`Ttr_intake` resolves a POC from a globally stored, exact domain key and creates one defect record. `ttr_assign_work_item` then makes one work item authoritative for that defect and enforces global uniqueness of that work-item ID across all defects. Supported lanes/evidence operate through that defect's sole work item. There is no relationship layer between defect records, so linked consumer failures cannot currently share a parent work item while preserving separate intakes.

## Review Findings

1. **Medium — POC routing fails for descriptive subdomains.** Exact domain matching means the active `babysitter-dv` registration does not cover the recorded descriptive Babysitter domains; all four observed defects are unassigned (`state.json:36-37,104-105,155-156,215-216`; `core.ts:180-211`). This prevents the intended POC handoff flow.
2. **Medium — coherent multi-defect tracking is structurally impossible.** The global duplicate-WI prohibition (`core.ts:237-240`) prevents using `wi-005`—currently authoritative for the prompt defect (`state.json:83-100`)—for related session metadata/output/recovery defects, while the model/tool API has no relation/parent capability (`core.ts:48-64`, `index.ts:113-145`). This pushes users toward duplicate WIs or untracked related defects.
3. **No discoverable named owner or verified reporting channel.** A local `ttr`/`pi-extensions` POC session is discoverable (`state.json:11-16,25-30`), but is not a person, has no requester channel, and documented Intercom use requires separate reachability confirmation (`README.md:69-82`).

## Requested Extension Change
Add a first-class **related-defect-to-parent-work-item** relation (for example `ttr_link_related_defect({ defectId, parentDefectId })`): retain one authoritative WI on the parent, record each child defect's `parentDefectId`/`relatedWorkItemId`, and make lane/evidence preambles resolve that inherited WI without allowing a second authoritative assignment. Also make POC routing usable for scoped defect domains by supporting an explicit canonical/parent domain (or registered aliases/prefix policy) in intake, while preserving exact assignment when no mapping is configured. This permits the linked Doc-Vader/Babysitter prompt, metadata, output, and recovery defects to be independently evidenced but coherently tracked under one WI.

## Commands / Evidence
- `grep -RInE --exclude-dir=node_modules 'ttr_intake|ttr_assign_work_item|ownerPocSessionId|already authoritative' /Users/macos/dev/pi-extensions /Users/macos/.pi/agent/triage-control-plane` — located implementation and live state.
- `nl -ba /Users/macos/.pi/agent/triage-control-plane/state.json | sed -n '1,260p'` — line-numbered registrations/defects evidence.
- `nl -ba /Users/macos/dev/pi-extensions/extensions/triage-control-plane/src/core.ts | sed -n '185,250p'` — line-numbered resolver/uniqueness evidence.
- `nl -ba /Users/macos/dev/pi-extensions/extensions/triage-control-plane/index.ts | sed -n '1,145p'` — line-numbered tool/routing evidence.
- `git -C /Users/macos/dev/pi-extensions remote -v` and `git -C /Users/macos/dev/pi-extensions show -s --format=fuller HEAD` — source repository and non-routable commit-author evidence.

## Start Here
Open `/Users/macos/dev/pi-extensions/extensions/triage-control-plane/src/core.ts`: it contains both limitations—exact POC resolution and the global one-WI-per-defect invariant.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete implementation/state findings with exact paths and line ranges are listed above; two medium-severity workflow limitations and reporting-channel status are evidenced."
    }
  ],
  "changedFiles": [
    "/Users/macos/dev/babysitter-dv/context.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep -RInE --exclude-dir=node_modules 'ttr_intake|ttr_assign_work_item|ownerPocSessionId|already authoritative' /Users/macos/dev/pi-extensions /Users/macos/.pi/agent/triage-control-plane",
      "result": "passed",
      "summary": "Located TTR source implementation and persisted unassigned defect state."
    },
    {
      "command": "nl -ba /Users/macos/.pi/agent/triage-control-plane/state.json | sed -n '1,260p'",
      "result": "passed",
      "summary": "Verified active POC sessions, no requester channel, and affected defect records."
    },
    {
      "command": "git -C /Users/macos/dev/pi-extensions remote -v; git -C /Users/macos/dev/pi-extensions show -s --format=fuller HEAD",
      "result": "passed",
      "summary": "Verified source remote and that the visible commit author is a non-routable UAT identity."
    }
  ],
  "validationOutput": [
    "Read-only local investigation completed; no source or state changes were made.",
    "The sole written artifact is the required findings file."
  ],
  "residualRisks": [
    "POC session 01a00f3d-dbc5-734d-888b-198769d4babd is locally registered but reachability cannot be established from the examined state; do not contact it based on this report.",
    "Local pi-extensions working tree had pre-existing modified/untracked files, so source behavior may differ from committed HEAD; findings cite the current files read.",
    "No GitHub issue tracker/contact metadata was found locally, so absence of a reporting channel is limited to inspected local configuration and source."
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only investigation; no implementation diff. Required context.md report written.",
  "reviewFindings": [
    "medium: /Users/macos/dev/pi-extensions/extensions/triage-control-plane/src/core.ts:180-211 - exact domain lookup leaves descriptive Babysitter defect domains unassigned despite an active babysitter-dv POC.",
    "medium: /Users/macos/dev/pi-extensions/extensions/triage-control-plane/src/core.ts:232-240 - a work item cannot be authoritative for more than one defect, and no related-defect model/tool exists.",
    "no named/verified reporting POC: /Users/macos/.pi/agent/triage-control-plane/state.json:11-16,25-30 and /Users/macos/dev/pi-extensions/extensions/triage-control-plane/README.md:69-82."
  ],
  "manualNotes": "Do not contact any POC from this report: task constraints prohibited contact, and the extension itself requires independent reachability confirmation."
}
```