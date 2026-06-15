---
description: Pick or change your status-line animal companion (squirrel/fox/turtle)
argument-hint: "[squirrel|fox|turtle] [canned|react|off]"
---
The user wants to configure their status-line animal companion. Argument: "$ARGUMENTS".

Config file: `~/.claude/statusline-soul.json` with shape `{"mode":"off|canned|react","animal":"squirrel|fox|turtle"}`.
Soul files must exist at `~/.claude/souls/<animal>.md` — if missing, copy them from this repo's `souls/` folder.

Do this:
1. If no argument: read the current config (if any) and report it, then list the three animals
   (🐿️ squirrel, 🦊 fox, 🐢 turtle) and the three modes, and ask which they want.
2. If an animal is given (e.g. `fox`): set `animal` to it. Default `mode` to `canned` unless a mode is also given.
3. If mode `react` is requested: BEFORE writing, explain that react mode runs a `claude -p --safe-mode --model haiku`
   call (~3s) on every prompt you submit, using their own Claude Code login and counting toward their rate limits,
   and that their latest prompt text is sent to Haiku. Confirm, then write the config.
4. If `off`: set `mode` to `off` (companion becomes a quiet emoji).
5. Write `~/.claude/statusline-soul.json`, ensure `~/.claude/souls/` is populated, and confirm the new setting.
