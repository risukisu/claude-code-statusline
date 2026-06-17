# Contributing — working on claude-code-statusline

This guide is for developing **on** this repo. If you're an agent asked to **install** the tool on a user's machine, read [`AGENTS.md`](AGENTS.md) instead.

---

## What is this?

**claude-code-statusline** is a zero-dependency Node.js status line for Claude Code. It renders up to four lines at the bottom of the terminal:
- **Line 1 (session):** model, effort level, context usage
- **Line 2 (limits):** rate-limit consumption & pace vs. clock
- **Line 3 (git):** branch, dirty files, commits ahead/behind, origin remote, PR status
- **Line 4 (companion, optional):** an animal character (squirrel/fox/turtle) that reacts to your prompts

**Core principle:** no dependencies, no API calls by default, no transcript reads except in opt-in react mode.

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
| `statusline.js` | the core — renders the lines, plus the `--gen` and `--hook` execution paths |
| `souls/` | three character files (`squirrel.md`, `fox.md`, `turtle.md`); edit freely |
| `commands/animal.md` | the `/animal` slash-command definition (Claude Code reads it; don't modify for logic) |
| `settings.snippet.json` | the `statusLine` + `UserPromptSubmit` hook blocks users merge into `~/.claude/settings.json` |
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
- **Top:** requires + constants (EMOJI, MODES, timeouts, file-path helpers, circuit-breaker thresholds).
- **Middle:** pure, exported helpers (`parseSoul`, `loadConfig`, `renderLine4`, `evaluateBudget`, …) — each has a `module.exports.name = name;` line and is unit-tested.
- **Bottom:** the three execution paths, dispatched at the end by `if (require.main === module) { … }`.

### Execution paths (read this before touching line 4)

The companion's design rule: **the render path never calls a model. Generation is event-driven, fired once per user prompt by a hook.** This is what keeps it from leaking API usage across concurrent sessions.

- **`main()` — the render path** (default; Claude Code runs it ~once/second). Reads the stdin JSON, gathers git info, loads config + soul, and prints lines 1–4. For line 4 it **only reads** the current session's cache file (keyed by `session_id`) — it is **read-only and never spawns a generation.**
- **`hook()` — the `UserPromptSubmit` hook** (`statusline.js --hook`). This is the **only** thing that triggers generation. It fires once when the user submits a prompt, reads `session_id` + `prompt` from the hook's stdin, spawns the detached `--gen` child, and exits 0 immediately (it must not block the prompt or print to stdout). A recursion guard (`CLAUDE_SOUL_GEN`) stops the companion's own `claude -p` from re-triggering it.
- **`generate()` — the generation path** (`statusline.js --gen`, spawned detached by `hook()`). Reads the soul + the prompt (from env), checks the **circuit breaker** (`evaluateBudget` — caps machine-wide bursts at ~20 generations / 2 min → 30-min cooldown), runs `claude -p --safe-mode --model haiku`, and writes the **per-session** cache file so the next render shows it. Prunes stale per-session caches after 24h.

### Key design decisions

1. **No dependencies** — Node builtins only (`fs`, `path`, `child_process`, `crypto`).
2. **Read-only render + hook-driven generation** — see above; this is the core safety property.
3. **Per-session isolation** — `CACHE_FILE(session_id)` via `sessionKey()`, so parallel Claude Code windows never read or trigger each other's generations.
4. **Circuit breaker** — a machine-wide burst cap (`evaluateBudget`) as a hard backstop against runaways.
5. **Atomic writes** — cache written to a temp file then renamed.
6. **Souls as markdown** — each animal is a plain `.md` users can edit.
7. **Graceful degradation** — missing soul → emoji only; missing git → launch folder, no git info; missing cache → ambient line.

---

## Tests

| File | Covers |
|---|---|
| `characterization.test.js` | locks lines 1–3 output (black-box, via stdin/stdout) so refactors can't regress |
| `config.test.js` | `loadConfig` + safe fallbacks |
| `soul.test.js` | soul markdown parsing; all shipped souls parse |
| `lines.test.js` | `pickAmbient` / `pickCanned` / `truncate` |
| `render-line4.test.js` | the line-4 dispatcher, install nudge, react/paused states |
| `transcript.test.js` | transcript JSONL tail parsing |
| `cache.test.js` | prompt hashing + atomic cache I/O |
| `sessionkey.test.js` | per-session cache-key isolation |
| `breaker.test.js` | the burst-cap circuit breaker (`evaluateBudget`) |
| `genargs.test.js` | the `claude -p` argument builder |

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

## react
You are Squirrel, a manic terminal companion. Reply with ONE short line (<= 80 chars), in character.
```

- `## work` — shown when the repo is dirty or context is high (>70%)
- `## ambient` — shown when idle; rotates ~every 30s
- `## react` — the system prompt sent to Haiku in react mode

Aim for ≥4 lines per section. The parser is tolerant.

---

## Common tasks

**Add a line-4 feature:** add an exported pure helper → write a failing test → implement → wire into `renderLine4()` (render-only logic) or `generate()` (if it needs a model call) → run tests → commit.

**"A user reports react mode isn't generating":**
1. Is the `UserPromptSubmit` hook registered in their `~/.claude/settings.json`? (`generate()` is fired by the hook, not by the render path.)
2. Did they **restart** Claude Code after adding the hook? Hooks load at session start.
3. Is the soul file present at `~/.claude/souls/<animal>.md`, and is `mode` set to `react`?
4. Is the circuit breaker tripped? Check `~/.claude/statusline-soul.budget.json` (`tripUntil` in the future = cooling down).
5. Inspect the per-session cache: `~/.claude/statusline-soul.<session_id>.cache.json`.

**"Works locally but not in Claude Code":** verify the `command` path in `settings.json` (Windows: full path, forward slashes), then restart.

---

## Commits

Clear messages, `feat:` / `fix:` / `docs:` convention. Run `node --test` before committing.
