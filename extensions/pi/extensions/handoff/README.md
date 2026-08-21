# Pi Cross-Terminal Handoff

A global Pi extension that adds `/handoff <goal>` for continuing the current session in a fresh Pi process opened in another terminal, multiplexer pane, or workspace tab.

It is inspired by cmux-specific handoff workflows, but is designed to work across common terminal environments.

## What `/handoff` does

1. Builds an algorithmic handoff prompt without calling an LLM.
2. Saves that prompt under `~/.pi/agent/handoffs/`.
3. Launches a new `pi` session with the prompt attached via `@handoff-file.md`.
4. Includes enough provenance for the new session to inspect the original state instead of guessing.

The handoff prompt includes:

- requested goal
- parent Pi session path
- working directory
- current model
- generation timestamp
- git branch, HEAD, upstream, and short status
- recent user/assistant/tool-result entries
- operating instructions for the next session

## Supported launch targets

The extension tries launchers in this order:

1. **cmux** — creates a new terminal surface in the current cmux pane, respawns it with `pi`, and renames the tab.
2. **zellij tab** — opens a new Zellij tab when `$ZELLIJ` is set.
3. **zellij run pane** — fallback Zellij pane launcher when tab launch fails.
4. **tmux** — opens a new tmux window when `$TMUX` is set.
5. **WezTerm** — opens a right split through `wezterm cli split-pane`.
6. **Kitty** — opens a new tab through Kitty remote control.
7. **Ghostty** — opens a new Ghostty window.
8. **Alacritty** — opens a new Alacritty window.
9. **iTerm** — opens a new tab in the current iTerm window through AppleScript.
10. **Terminal.app** — opens a new macOS Terminal window only when running from Apple Terminal or when explicitly opted in with `PI_HANDOFF_ALLOW_TERMINAL_APP=1`.
11. **Fallback** — shows the exact command to run manually, including launcher diagnostics.

GUI AppleScript launchers are skipped over SSH.

## Usage

Reload Pi after installation:

```text
/reload
```

Then run:

```text
/handoff continue fixing the failing auth tests
```

The new session starts with a prompt file like:

```bash
pi --name 'pi handoff: continue-fixing-the-faili' '@~/.pi/agent/handoffs/2026-...md'
```

## Installation

This repository is meant to be loaded as a Pi extension directory.

Add the directory to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "/Users/macos/.pi/agent/extensions/handoff"
  ]
}
```

Or run Pi with it explicitly for testing:

```bash
pi --no-extensions -e ~/.pi/agent/extensions/handoff --list-models anything
```

## cmux behavior

When run inside cmux, `/handoff` uses the cmux CLI:

- `cmux --json identify`
- `cmux --json list-panes --workspace <workspace>`
- `cmux new-surface --type terminal ...`
- `cmux respawn-pane --command <handoff command> ...`
- `cmux rename-tab ...`

If cmux is not installed, the current process is not inside a cmux surface, or any cmux step fails, the extension silently tries the next supported launcher.

## Configuration

Override launcher selection with:

```bash
PI_HANDOFF_LAUNCHER=zellij-tab      # or tmux-window, alacritty-window, manual, etc.
```

Supported override names include `cmux`, `zellij-tab`, `zellij-run`, `tmux-window`, `wezterm-split`, `kitty-tab`, `ghostty-window`, `alacritty-window`, `iterm-tab`, `terminal-app`, `custom`, and `manual`. Short aliases like `zellij`, `tmux`, `wezterm`, `kitty`, `ghostty`, and `alacritty` are also accepted.

For terminals not built in, provide a shell command template:

```bash
PI_HANDOFF_COMMAND_TEMPLATE='alacritty --working-directory {cwd} --title {title} -e sh -lc {display}'
```

Template variables are shell-quoted: `{cwd}`, `{title}`, `{display}`, `{pi}`, and `{promptFile}`.

Terminal.app fallback is intentionally conservative. To allow it outside Apple Terminal:

```bash
PI_HANDOFF_ALLOW_TERMINAL_APP=1
```

## Notes and limitations

- Handoff summarization is intentionally algorithmic and bounded; it captures recent context, not the entire session.
- For missing details, the new session should inspect the parent session file and repository state.
- The extension resolves the absolute `pi` executable path before launching when possible.
- AppleScript fallbacks are macOS-only and skipped over SSH.
