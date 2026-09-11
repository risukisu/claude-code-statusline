# Contributing — working on claude-code-statusline

This guide is for developing **on** this repo. If you're an agent asked to **install** the tool on a user's machine, read [`AGENTS.md`](AGENTS.md) instead.

---

## What is this?

**claude-code-statusline** is a zero-dependency Node.js status line for Claude Code. It renders up to four lines at the bottom of the terminal:
- **Line 1 (session):** model, effort level, context usage
- **Line 2 (limits):** rate-limit consumption & pace vs. clock
- **Line 3 (git):** branch, dirty files, commits ahead/behind, origin remote, PR status
- **Line 4 (companion, optional):** an animal character (squirrel/fox/turtle) with hand-written lines keyed to your git/context state

**Core principle:** no dependencies, no API calls, no transcript reads — ever. (A live "react" mode that ran `claude -p` per prompt existed until the Unreleased version and was removed; see CHANGELOG.)

---

## Prerequisite: Node.js

```bash
node --version   # any recent version (v18+)
```

No `npm install` — there are no dependencies. Tests use Node's built-in `node:test` + `node:assert`.

---

## Files you'll touch

| Path | Purpose |
|---|---|
| `statusline.js` | the core — renders the lines (`--hook`/`--gen` are inert legacy flags) |
| `souls/` | three character files (`squirrel.md`, `fox.md`, `turtle.md`); edit freely |
| `commands/animal.md` | the `/animal` slash-command definition (Claude Code reads it; don't modify for logic) |
| `settings.snippet.json` | the `statusLine` block users merge into `~/.claude/settings.json` |
| `test/` | `node:test` unit + characterization tests |
| `examples/` | sample JSON payload + PowerShell workspace launchers |
| `AGENTS.md` | install playbook for agents · `README.md` | user docs |

---

## Running tests

```bash
node --test            # all tests (run from the repo root)
node --test test/config.test.js   # a single file
```

Expected: all **~38** tests pass, in well under a second. No network, no setup.

---

## Architecture

`statusline.js` is one file in three layers:
- **Top:** requires + constants (EMOJI, MODES, timeouts, file-path helpers).
- **Middle:** pure, exported helpers (`parseSoul`, `loadConfig`, `renderLine4`, `evaluateBudget`, …) — each has a `module.exports.name = name;` line and is unit-tested.
- **Bottom:** `main()`, dispatched at the end by `if (require.main === module) { … }`; the legacy `--hook`/`--gen` flags exit 0 in silence.

### Execution path (read this before touching line 4)

There is exactly one: **`main()` — the render path.** Claude Code runs it on every status-line refresh. It reads the stdin JSON, gathers git info (cached per session), loads config + soul, and prints lines 1–4. Line 4 is chosen by `renderLine4()` from the soul's hand-written `work`/`ambient` lists — **pure, synchronous, no model call, no transcript read.**

`statusline.js --hook` and `--gen` still exist only as silent no-ops. They were the entry points of the removed live "react" mode, which forwarded every submitted prompt to a background `claude -p --model haiku` child. That child was a full Claude Code session with the user's permission rules and could act on the prompt (in a controlled run inside a project folder it created the file it was asked for; two unexplained file rewrites matched its timing exactly), so the whole path was deleted rather than patched. Do not reintroduce a model call anywhere in this file.

### Key design decisions

1. **No dependencies** — Node builtins only (`fs`, `path`, `child_process`, `crypto`).
2. **Render-only, no model calls** — see above; this is the core safety property.
3. **Per-session isolation** — `GIT_CACHE_FILE(session_id)` via `sessionKey()`, so parallel Claude Code windows never read each other's git snapshot.
4. **Atomic writes** — cache written to a temp file then renamed.
5. **Souls as markdown** — each animal is a plain `.md` users can edit.
6. **Graceful degradation** — missing soul → emoji only; missing git → launch folder, no git info.

---

## Tests

| File | Covers |
|---|---|
| `characterization.test.js` | locks lines 1–3 output (black-box, via stdin/stdout) so refactors can't regress |
| `config.test.js` | `loadConfig` + safe fallbacks |
| `soul.test.js` | soul markdown parsing; all shipped souls parse |
| `lines.test.js` | `pickCanned` / `truncate` |
| `render-line4.test.js` | the line-4 dispatcher, install nudge, canned/off states |
| `cache.test.js` | atomic cache I/O (git snapshot) |
| `sessionkey.test.js` | per-session cache-key isolation |
| `gitcache.test.js`, `gitcache-write.test.js` | git snapshot TTL + write path |
| `watchdog.test.js` | an orphaned render self-terminates |
| `legacy-entrypoints.test.js` | `--hook` / `--gen` exit 0 in silence and spawn nothing |

Tests are isolated (no side effects) and fast. When you add an exported helper, add a test for it.

If `characterization.test.js` fails, you changed lines 1–3 output — make sure it was intentional, then update the assertion.

---

## Editing souls (squirrel/fox/turtle)

Each soul is `souls/<animal>.md`:

```markdown
# Squirrel 🐿️
voice: manic, enthusiastic, scattered — a cheerful hoarder
rules: one line, <= 80 chars, never mean, no emoji (the 🐿️ is added)

## work
- branch buried somewhere? dig one up before you forget.

## ambient
- buried 47 acorns this morning. forgot where 31 are.

```

- `## work` — shown when the repo is dirty or context is high (>70%)
- `## ambient` — shown when idle; rotates ~every 30s

Aim for ≥4 lines per section. The parser is tolerant.

---

## Common tasks

**Add a line-4 feature:** add an exported pure helper → write a failing test → implement → wire into `renderLine4()` (render-only logic; a feature that needs a model call does not belong in this project) → run tests → commit.

**"A user still has `mode: react` or the old `UserPromptSubmit` hook":** both are harmless. `loadConfig` maps `react` to `canned`; `statusline.js --hook` exits 0 without output. Suggest they drop the hook entry from `~/.claude/settings.json` for tidiness.

**"Works locally but not in Claude Code":** verify the `command` path in `settings.json` (Windows: full path, forward slashes), then restart.

---

## Commits

Clear messages, `feat:` / `fix:` / `docs:` convention. Run `node --test` before committing.
