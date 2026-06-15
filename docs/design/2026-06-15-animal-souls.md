# Animal Souls — design spec

- **Project:** claude-code-statusline
- **Date:** 2026-06-15
- **Status:** approved design, pending spec review → implementation plan
- **Author:** risu + Claude

## 1. Goal

Give line 4 of the status line (today a static `🐿️`) an optional **animal companion** with a
personality. It can sit quietly as an emoji, drop canned in-character lines, or react to what
you're actually doing via a cheap Haiku call. Three modes, fully opt-in, **default behavior is
unchanged**. The whole feature is self-contained in `statusline.js` + markdown soul files + one
slash command — **no `settings.json` edits and no hooks**, which keeps the upgrade path for
existing installers trivial.

## 2. Constraints & grounding (measured, not assumed)

The status line is a command Claude Code runs on every refresh (≈1s). It must stay fast and must
never block. So the model is never called inline — generation is decoupled and the render path only
ever *reads a cached line*.

Latency was measured on this machine (subscription auth, no `ANTHROPIC_API_KEY` set):

| invocation | auth | latency |
|---|---|---|
| `claude -p` (plain) | login ✅ | 16.9s (boots all MCP servers + plugins) |
| `claude -p --bare` | needs API key ❌ | 1.0s |
| `claude -p --strict-mcp-config` (no MCP) | login ✅ | 11.7s |
| **`claude -p --safe-mode`** | **login ✅** | **2.8s** |

**Decision:** react mode uses `--safe-mode`. It keeps the user's existing Claude Code login (works
for everyone, no API key), discards MCP/plugins/skills/CLAUDE.md, and returns in ~2.8s — ideal for
an ambient line that lands a beat after the prompt.

Confirmed from official docs (claude-code-guide agent, 2026-06-15): the `statusLine` stdin payload
includes `transcript_path`, `session_id`, `cwd`, `workspace.*`, `model`, `cost`, `context_window`,
`rate_limits`, `pr`. So react mode can see prompts by tailing the transcript Claude already points
it at — no hook required.

## 3. Modes

Line 4 reads `~/.claude/statusline-soul.json`. **No file = `off` = today's behavior, byte for byte.**

| mode | line 4 example | transcript read? | cost |
|---|---|---|---|
| **off** (default) | `🐿️` | no | none |
| **canned** | `🦊 ~ 14 files dirty and no commit. bold.` | no | none |
| **react** | `🦊 ~ refactoring auth? try not to lock yourself out` | yes (react only) | ~1 Haiku call / prompt |

Config schema (`~/.claude/statusline-soul.json`):

```json
{ "mode": "off | canned | react", "animal": "squirrel | fox | turtle" }
```

`off` shows the chosen animal's emoji if one is set, else `🐿️`.

## 4. Cadence — hybrid (option C)

The companion reacts when there's something to react to, the line lingers, and when you've been idle
it rotates in-character ambient flavor so it feels alive without being noisy.

- **Trigger (canned mode):** a notable **state change** computed from data the script already has —
  repo goes dirty/clean, context crosses a threshold, branch change. Shows a `work` line. *No
  transcript reading.*
- **Trigger (react mode):** a **new prompt** (detected by tailing the transcript). Fires generation;
  shows the resulting `react` line once ready (~3s later), lingering until the next prompt.
- **Idle (both modes):** if no trigger for `IDLE_AFTER` (≈90s), rotate `ambient` in-character lines,
  changing every `AMBIENT_EVERY` (≈30s). **Ambient lines are always canned** — idle never costs a
  Haiku call, even in react mode.

This cleanly bounds cost to "one Haiku call per prompt, only in react mode," exactly the trade-off
the user accepted.

## 5. Souls — editable markdown

Ship `souls/squirrel.md`, `souls/fox.md`, `souls/turtle.md`. Installed to `~/.claude/souls/`.
`statusline.js` reads the active soul at runtime; the user can edit any of them. Each file has three
content sections plus a header:

```md
# Fox 🦊
voice: clever, sly, lightly sassy — efficiency-minded, enjoys a little needling
rules: one line, ≤ 80 chars, never mean, no emoji (the 🦊 is prepended)

## work        ← canned mode, on a state-change trigger
- 14 files dirty and no commit. living dangerously.
- that's a lot of context burned for one function.

## ambient     ← hybrid idle slot, both modes (in-character animal nature)
- the henhouse can wait. i'm comfortable.
- i've got nine ways into this problem.
- left no tracks. as usual.

## react       ← react mode: used as --append-system-prompt
You are Fox, a clever and lightly sassy terminal companion watching a developer work.
Given their latest prompt, reply with ONE short witty line (≤ 80 chars), in character.
Mostly react to what they're doing; occasionally let your sly fox nature show. Never mean.
```

Personalities:
- 🐿️ **squirrel** — manic, enthusiastic hoarder; scattered energy. ambient: acorns, winter, twitchy tail.
- 🦊 **fox** — clever, sly, **lightly sassy**, efficiency-minded. ambient: dens, henhouses, leaving no tracks.
- 🐢 **turtle** — slow, patient, wise; gently chides rushing. ambient: shells, longevity, "slow is smooth."

> **On content depth:** the example lines in this section are illustrative stubs. The shipped soul
> files are authored as a first-class content pass during implementation — a generous set per section
> (roughly 8–15 lines each), in the project's voice and run through `copy-deslop`. The voice/rules
> header and the three sections (`work` / `ambient` / `react`) are the contract; the line inventory
> is meant to grow and be edited freely.

## 6. Architecture

### Files

| path | role | new? |
|---|---|---|
| `statusline.js` | render path + `--gen` generator (one file, two jobs) | modified |
| `souls/{squirrel,fox,turtle}.md` | the three personalities | new |
| `commands/animal.md` | `/animal` slash command | new |
| `~/.claude/statusline-soul.json` | config (mode + animal) | runtime |
| `~/.claude/statusline-soul.cache.json` | react cache | runtime |

`statusline.js` gains `fs`/`os`/`path` requires; resolves `~/.claude` via `os.homedir()`.

### Dual-mode `statusline.js`

- **Render (default):** after lines 1–3, call `line4()`. It reads config; on `off` prints the emoji
  (and the first-run nudge if no config exists); on `canned` picks a `work`/`ambient` line per the
  cadence; on `react` reads the cache's `comment` and, if a *new* prompt is detected, spawns the
  generator detached and keeps showing the cached line.
- **Generate (`node statusline.js --gen`):** reads config + soul, reads the latest prompt from the
  transcript tail, runs the Haiku call, writes the cache atomically (temp file + rename), exits.

Detached spawn (cross-platform via node, no shell redirection):

```js
const child = spawn(process.execPath, [__filename, "--gen"], { detached: true, stdio: "ignore" });
child.unref();
```

The generator's call (validated):

```
claude -p --safe-mode --no-session-persistence --tools "" --model haiku \
  --append-system-prompt "<soul .react section>" "<latest prompt, truncated ~500 chars>"
```

(`--tools ""` forbids tool use — leaner, safer; not separately benchmarked but additive.)

### React data flow

1. You submit a prompt → Claude Code appends it to the transcript JSONL.
2. Within ≤1s the status line refreshes, tails the transcript, finds the latest user message, hashes it.
3. If `mode==react` and the hash differs from `cache.promptHash`: write the new hash to the cache
   (so repeated refreshes don't double-spawn), set `generating=now`, spawn `--gen` detached.
4. Render shows the *previous* `cache.comment` meanwhile (never blocks).
5. ~3s later the generator writes the new `comment`; the next refresh shows it; it lingers until the
   next prompt, then idle rotation may take over.

### Cache schema (`~/.claude/statusline-soul.cache.json`)

```json
{ "promptHash": "<sha of last prompt>", "comment": "<line>", "ts": 1700000000, "generating": 0 }
```

`generating` is an epoch stamp used as a soft lock (ignored if older than ~30s, so a failed gen
never wedges the companion).

### Robustness

- All reads guarded; any missing file / parse error / failed `git` / failed spawn degrades to "just
  the emoji." The companion can never break lines 1–3 or throw.
- Output truncated to `COLUMNS` so line 4 never wraps; soul lines capped ≤ ~80 chars (prompt + a
  hard truncate backstop).

## 7. Selection, first run, upgrade

- **`/animal` slash command** (`commands/animal.md`) — writes the config JSON via Claude:
  - `/animal` → show current setting + the three animals + a one-paragraph explainer of the modes.
  - `/animal fox` → set `animal=fox`, `mode=canned`.
  - `/animal fox react` → **first explain the cost** (each prompt triggers a ~3s Haiku call on your
    own subscription, counting toward your rate limits), then confirm and set `mode=react`.
  - `/animal off` → `mode=off`.
- **First-run nudge, no hook:** when no config file exists, line 4 renders
  `🐿️ · /animal to pick a companion` (dim). It disappears once a config exists. Fully self-contained.
- **Upgrade path for already-installed users:** overwrite `statusline.js`, drop in `souls/` and
  `commands/animal.md`, run `/animal`. No `settings.json` changes, no re-install.

## 8. README / docs

- New optional "Animal companion" section: the three modes, the `/animal` command, the cost note for
  react, and how to edit a soul.
- Line-4 description updated from "deliberate placeholder" to "your companion (optional)."
- Honesty fix for the "no transcript parsing" claim: **the default and canned modes still read no
  transcript**; only react mode opts into reading the prompt tail. State this plainly.

## 9. Privacy

In react mode your latest prompt text is sent to Haiku (your own Claude Code auth — same trust
boundary as the session itself). Document it in the README and in the `/animal … react` confirmation.

## 10. Out of scope (YAGNI for v1)

- Tier-2 "reacts to completed work" via a Stop-style trigger (the transcript tail already lets us add
  it later without settings changes).
- Direct Anthropic-API fast path / API-key support (the `--safe-mode` keyless path is fast enough).
- LLM-generated ambient/idle lines (kept canned to bound cost).
- Animated fades / a formal state machine for line 4.
- Per-animal emoji customization beyond the three.

## 11. To verify at implementation

- Exact transcript JSONL line schema for "latest user message" (read a real transcript; confirm the
  field that holds user prompt text and the type discriminator).
- Detached-spawn behavior on Windows PowerShell host vs. macOS/Linux (node `spawn detached+unref`
  should be uniform, but confirm the `--gen` child survives the render process exiting).
- Final flag set timing with `--tools ""` added.
