# Pi Autoname

Automatically names Pi sessions from the transcript and adds discoverable `/name` subcommands.

## Features

- Auto-names unnamed sessions after the first turn.
- Dynamically refreshes extension-owned names every few turns by default.
- Uses `@sting8k/pi-vcc` to build a compact whole-thread summary before asking for a title.
- Falls back with recency bias when model access is unavailable.
- Never overwrites a manually named session.
- Adds `/autoname refresh` to force-regenerate the title from the transcript.
- Also attempts to intercept `/name refresh` before the built-in `/name`; current Pi builds handle built-ins first, so use `/autoname refresh`.
- Falls back to a deterministic title when model access is unavailable.

## Usage

Load the extension:

```json
{
  "extensions": [
    "/path/to/pi-extensions/extensions/pi-autoname/index.ts"
  ]
}
```

Commands:

```text
/autoname refresh      Regenerate from transcript
/autoname auto status  Show autoname status
/autoname auto on      Enable automatic naming
/autoname auto off     Disable automatic naming

/name refresh          Regenerate from transcript when input interception runs before built-ins
/name auto status      Show autoname status when input interception runs before built-ins
/name auto on          Enable automatic naming when input interception runs before built-ins
/name auto off         Disable automatic naming when input interception runs before built-ins
```

## Configuration

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PI_AUTONAME_DISABLE_AUTO=1` | unset | Disable automatic naming on startup |
| `PI_AUTONAME_MODE=once\|dynamic` | `dynamic` | Name once or keep refreshing extension-owned names |
| `PI_AUTONAME_PROVIDER` | `openai` | Provider for `@earendil-works/pi-ai` lookup |
| `PI_AUTONAME_MODEL` | `gpt-5.2` | Model for title generation |
| `PI_AUTONAME_FALLBACK_ONLY=1` | unset | Do not call a model; use deterministic fallback only |
| `PI_AUTONAME_MAX_TITLE_LENGTH` | `36` | Maximum generated title length |
| `PI_AUTONAME_MAX_TRANSCRIPT_CHARS` | `12000` | Transcript tail sent when vcc is disabled/unavailable |
| `PI_AUTONAME_DISABLE_VCC=1` | unset | Disable pi-vcc whole-thread summary input |
| `PI_AUTONAME_MIN_TURNS_BETWEEN_UPDATES` | `3` | Dynamic refresh interval |

## Notes

This extension registers `/autoname` for reliable command dispatch. It also registers and intercepts `/name` where Pi allows it, but current Pi builds resolve the built-in `/name` first; in those builds `/name refresh` means "rename to refresh" and `/autoname refresh` is the correct force-refresh command.
