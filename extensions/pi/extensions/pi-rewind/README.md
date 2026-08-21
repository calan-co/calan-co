# Pi Rewind

A Pi extension that adds Git-backed workspace checkpoints for session rewind and fork workflows.

Pi's built-in `/tree` rewinds conversation state only. Pi Rewind adds a private shadow Git repository over the live project worktree so `/tree` and `/fork` can optionally restore files to the selected session point.

## How it works

- Creates a private shadow Git repo under `.pi/pi-rewind/`.
- Uses the real project directory as the shadow repo worktree.
- Records checkpoints at session start, before each agent turn, and after each agent turn.
- Associates checkpoint commits with Pi session entry IDs.
- On `/tree` or `/fork`, prompts before restoring the workspace.
- Does not commit to or mutate the project's source VCS metadata.

The project can use Git, Mercurial, SVN, Perforce, Fossil, or no VCS. Pi Rewind only requires the `git` executable as its private snapshot engine.

## Commands

```text
/rewind status
/rewind checkpoint [label]
/rewind restore <entry-id>
```

## Modes

Configure with environment variables before starting Pi.

```bash
PI_REWIND_MODE=safe      # default
PI_REWIND_MODE=full      # track everything except hard safety excludes
PI_REWIND_MODE=custom    # hard safety excludes + PI_REWIND_IGNORE
```

`safe` excludes common generated, dependency, cache, log, and secret-like files. `full` is more comprehensive but can be slow and may snapshot local/private state. `custom` accepts Git-ignore-style patterns:

```bash
PI_REWIND_MODE=custom
PI_REWIND_IGNORE=$'node_modules/\ndist/\n.env*'
```

Hard safety excludes are always applied:

```text
.pi/pi-rewind/
.git/
.hg/
.svn/
.fslckout
```

Disable automatic checkpoints:

```bash
PI_REWIND_DISABLE_AUTO=1
```

## Installation

Add the extension path to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "/Users/macos/dev/pi-extensions/extensions/pi-rewind/index.ts"
  ]
}
```

Then run `/reload` in Pi.

## Safety notes

- Restores are prompted in interactive/RPC mode.
- If the current workspace differs from the latest shadow checkpoint, Pi Rewind asks whether to checkpoint it first, discard it, or cancel.
- In non-UI modes, automatic restore prompts skip workspace restore rather than silently overwriting files.
- Shadow repo data lives in `.pi/pi-rewind/`; delete that directory to remove checkpoint history.
