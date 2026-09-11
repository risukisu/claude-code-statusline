# AGENTS.md — install instructions for AI agents

**If a user pointed you (an AI coding agent — Claude Code or similar) at this repository and asked you to install this status line on their machine, follow these steps exactly.** Do not improvise paths and do not skip the companion files — an incomplete copy is the #1 cause of "`/animal` doesn't work" reports.

> Human reader? You don't need this file — see the README's **Install** section.
> Working *on* this repo (tests, architecture, contributing)? See [`CONTRIBUTING.md`](CONTRIBUTING.md). This file is only about installing the tool onto a user's machine.

## What you're installing
A 3-line Claude Code status line (`statusline.js`) plus an optional line-4 **animal companion**: the `/animal` slash command and the `souls/` personality files. Everything lives under the user's `~/.claude/` directory — this is a **user-level** install, never per-project.

## Prerequisites — check these first; warn the user if missing
1. **Node.js** on `PATH` (`node --version` works). Required.
2. **A truecolor (24-bit) terminal.** Windows Terminal, iTerm2, WezTerm, Kitty, and the VS Code integrated terminal work. **macOS Terminal.app and the classic Windows `cmd.exe` do NOT** — the gradient bar and colors render as garbage escape codes. If the user is on Terminal.app, tell them to switch to iTerm2 or the VS Code terminal.

## Resolve the config directory for their OS
- **macOS / Linux:** `~/.claude` (i.e. `$HOME/.claude`)
- **Windows:** `C:/Users/<username>/.claude` — use **forward slashes** inside `settings.json`; PowerShell file paths use `$HOME\.claude`.

Create `~/.claude/`, `~/.claude/souls/`, and `~/.claude/commands/` if they don't already exist.

## Install steps — do ALL of them
1. Copy `statusline.js` → `~/.claude/statusline.js`
2. Copy **every** file in `souls/` (`squirrel.md`, `fox.md`, `turtle.md`) → `~/.claude/souls/`
3. Copy `commands/animal.md` → `~/.claude/commands/animal.md`  ← **without this, `/animal` will not exist**
4. **Merge** `settings.snippet.json` into `~/.claude/settings.json`:
   - Add the `statusLine` block. **Do not add any hook** — this tool needs none.
   - **MERGE — do not overwrite.** Preserve every existing key. The result must be valid JSON.
   - On **Windows**, replace `YOUR_USERNAME` with the real username and keep forward slashes, e.g. `node C:/Users/<username>/.claude/statusline.js`.
   - If an older install left a `hooks.UserPromptSubmit` entry running `statusline.js --hook`, remove that one entry (leave the user's other hooks alone). It is inert but pointless.
5. Tell the user, in these words:
   > Installed. **Restart Claude Code** — slash commands only load at session start — then run **`/animal`** to pick a companion.

## Verify before reporting success
- Run: `printf '{}' | node ~/.claude/statusline.js` → expect a few lines of output and no error.
- Confirm these exist: `~/.claude/statusline.js`, `~/.claude/commands/animal.md`, `~/.claude/souls/squirrel.md`.
- Confirm `~/.claude/settings.json` is valid JSON and contains `statusLine`.

If any check fails, fix it before telling the user it's done.

## Important notes
- The companion is **off by default**. Both modes (`off`, `canned`) make **zero** model calls and read no transcript.
- There is no `react` mode any more. If the user asks for it, say it was removed because the background `claude -p` child it spawned could act on their prompts; do not try to recreate it.
- Don't add extra hooks or status lines for other projects.
