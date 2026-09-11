---
description: Pick or change your status-line animal companion (interactive picker)
argument-hint: "[squirrel|fox|turtle] [canned|off] — or no args for a picker"
---
Set the user's status-line animal companion. Argument (may be empty): "$ARGUMENTS".

Config file: `~/.claude/statusline-soul.json`, shape `{"mode":"off|canned","animal":"squirrel|fox|turtle"}`. (A legacy `"react"` value is treated as `canned` — that live-Haiku mode was removed.)
Soul files live at `~/.claude/souls/<animal>.md` — if any are missing, copy them from this repo's `souls/` folder.

Handle it like this:

1. **No argument given** (the user just typed `/animal`): present an interactive picker with the **AskUserQuestion** tool — do NOT make them type. Ask both in a single call:
   - **Companion** (header "Companion"): 🐿️ Squirrel — manic, enthusiastic hoarder · 🦊 Fox — clever, sly, a little sassy · 🐢 Turtle — slow, patient, wise. If a config already exists, note the current pick in the question text.
   - **Mode** (header "Mode"): **Canned** — rotates hand-written in-character lines keyed to your git/context state; no model calls · **Off** — just a quiet emoji.
   Map the selections: Companion → `animal`; Mode Off → `mode:"off"`, Canned → `"canned"`.

2. **Arguments given** (e.g. `fox`, `fox canned`, `off`): use them directly, no picker. If only an animal is named, default mode to `canned`. If only a mode is named, keep the current animal (or `squirrel`). If `react` is asked for, explain it was removed (the background `claude -p` child it spawned could act on the user's prompts) and write `canned` instead.

Then, in all cases:
- Ensure `~/.claude/souls/` contains `squirrel.md`, `fox.md`, `turtle.md` (copy from this repo's `souls/` if missing).
- Write `~/.claude/statusline-soul.json` with the chosen `{mode, animal}`.
- Confirm in one line, e.g. `🦊 fox · canned — set.` (no restart needed; the status line picks it up on the next refresh).
