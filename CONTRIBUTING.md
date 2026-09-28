# Contributing to claude-code-statusline

This guide is for working **on** this repo. If you're an agent asked to **install** the status line on someone's machine, read [`AGENTS.md`](AGENTS.md) instead.

## What It Is

A zero-dependency Node script that Claude Code runs as its status line. It prints up to four lines:

- **Line 1, session:** model, effort, context bar, lines changed
- **Line 2, limits:** 5-hour and 7-day rate limits, pace against the clock, reset countdowns
- **Line 3, git:** launch folder, current repo, branch, changes, ahead/behind, remote, PR
- **Line 4, companion (optional):** a squirrel, fox, or turtle with hand-written lines picked by state

**The rule that doesn't bend:** no dependencies, no network, no model calls, no transcript reads. A feature that needs any of those doesn't belong here.

## Setup

Node 18 or newer. There's nothing to install; tests use the built-in `node:test` and `node:assert`.

```bash
node --test            # the whole suite, from the repo root; well under a second
node --test test/lines.test.js
```

## Files You'll Touch

| Path | Purpose |
|---|---|
| `statusline.js` | the whole program |
| `souls/` | the three companions, one markdown file each |
| `commands/animal.md` | the `/animal` slash command Claude Code runs |
| `settings.snippet.json` | the `statusLine` block users merge into `~/.claude/settings.json` |
| `test/` | `node:test` suite, one file per concern |
| `examples/` | a sample stdin payload and the PowerShell workspace launchers |
| `assets/readme/` | README visuals, generated from real renders by `assets/readme/source/` |

## How the Code Is Laid Out

`statusline.js` is one file in three layers:

- **Top:** constants and file-path helpers (`VERSION`, `EMOJI`, `MODES`, timeouts, cache paths), the soul parser, and the `THEMES` table.
- **Middle:** pure helpers, each exported with `module.exports.name = name` and unit-tested: `parseSoul`, `fillLine`, `pickCanned`, `renderLine4`, `loadConfig`, `loadDashConfig`, `heatRGB`, `limitCells`, `gitCacheFresh`, `pruneStaleCaches`, and friends.
- **Bottom:** `main()`, run when the file is executed directly. `--version` prints the version; any other argument exits silently, so a stale hook entry can never paste status lines into a conversation.

### The Render Path

`main()` is the only execution path. Claude Code runs it after each message and every `refreshInterval` seconds. It reads the stdin JSON, loads `~/.claude/statusline.json` and applies its theme, loads the companion config and soul, reads git (from the per-session cache when it's under 3 seconds old), and prints the lines. Each line is built as a list of segments; `fitSegments()` applies each segment's ranked cuts until the line fits `COLUMNS`, and the gutter is added last. A watchdog ends the process after 8 seconds, because Claude Code cancels a superseded render by orphaning it with stdin still open.

A session's first render (no cache file yet) sweeps `statusline-git.*` caches idle for a day and temp files older than a minute. The sweep matches that one filename pattern and nothing else.

### How Line 4 Picks a Line

`pickCanned(soul, ctx, now)` divides wall-clock time into 30-second slots.

- **Notable states** (`context`, `limits`, `behind`, `dirty`, `ahead`): two slots in three rotate through the states that hold, plus the generic `work` lines, which also stand in for a state the soul has no section for. The third slot is `ambient`.
- **Calm states** (`night`, `norepo`, `synced`, `branch`): when nothing notable holds, the calm states take turns with `ambient`.
- `fillLine()` fills placeholders; a line whose placeholder has no value is dropped from the pool.
- The `context` state starts at the context danger line (`ctxDanger`, 50% by default), the same point where the bar turns red.

Everything is pure and synchronous, so a test pins `now` and gets the same line every time.

## Colours, Themes, and Settings

Every colour comes from one entry in `THEMES`. `setTheme()` turns the active theme into ready-made escape codes on `P` (`P.warn`, `P.dim`, `P.reset`, …), and render code only ever writes `${P.name}`. With `NO_COLOR` set, every entry on `P` is an empty string and the same templates print plain text. To add a theme, add an entry to `THEMES` with the same keys; `heat` holds the five context-bar anchors.

`loadDashConfig()` reads `~/.claude/statusline.json` and validates each key on its own, so one bad value never discards the rest. A new setting needs a default in `DEFAULT_DASH`, a check in `loadDashConfig()`, a test in `dashconfig.test.js`, and a row in the README's settings table.

## Editing Souls

A soul is `souls/<animal>.md`: a header, then one bullet list per section. Unknown sections and non-bullet lines are ignored.

```markdown
# Fox 🦊
voice: clever, sly, lightly sassy
rules: one line, <= 80 chars, never mean, no emoji (the 🦊 is added)

## ambient
- the henhouse can wait. i'm comfortable.

## dirty
- {dirty:file} dirty and no commit. living dangerously.
```

| Section | Fires when | Placeholder |
|---|---|---|
| `ambient` | idle, and every third slot while busy | |
| `work` | any notable state | |
| `dirty` | uncommitted changes | `{dirty}` |
| `ahead` | unpushed commits | `{ahead}` |
| `behind` | upstream has new commits | `{behind}` |
| `context` | context at the danger line (50% by default) | `{ctx}` |
| `limits` | 5-hour window at 80%, or pace 15+ ahead of the clock | `{limit}` |
| `synced` | clean and even with upstream | |
| `branch` | not on `main`/`master` | `{branch}` |
| `norepo` | outside a git repo | |
| `night` | 00:00–04:59 local time | |

`{key:noun}` adds a plural: `{ahead:commit}` → "1 commit" / "2 commits". `test/soul.test.js` checks every shipped line: 80 characters at most with worst-case values filled in, no emoji, no duplicates, only known placeholders, at least 12 ambient lines and 4 per other section.

## Tests

| File | Covers |
|---|---|
| `characterization.test.js` | lines 1–3 end to end through stdin/stdout, and line 4 wiring |
| `lines.test.js` | `pickCanned` rotation, states, placeholders; `fillLine`; `truncate` |
| `soul.test.js` | soul parsing, and the quality rules for the shipped souls |
| `render-line4.test.js` | the line-4 dispatcher, install nudge, off/canned |
| `config.test.js` | `loadConfig` and its fallbacks |
| `cache.test.js` | atomic cache writes, including temp-file cleanup on failure |
| `prune.test.js` | the stale-cache sweep and what it must never touch |
| `gitcache.test.js`, `gitcache-write.test.js` | git snapshot TTL and reuse |
| `sessionkey.test.js` | per-session cache isolation |
| `watchdog.test.js` | an orphaned render exits on its own |
| `flags.test.js` | `--version`, and silence for every other argument |
| `dashconfig.test.js` | `statusline.json` loading and per-key fallbacks |
| `heat.test.js` | the front-loaded context heat scale and the `/compact` hint |
| `limitbar.test.js` | limit bars: fill, notch, overspend colouring |
| `look.test.js` | themes, quiet mode, clickable links, `NO_COLOR`, `hide` |
| `fit.test.js` | narrow-terminal cuts, `visibleWidth`, and the gutter |
| `version.test.js` | `VERSION` matches the newest CHANGELOG entry |

Tests that run the script set `CLAUDE_CONFIG_DIR` to a temp folder; `test/helpers.js` has a `render()` that does it for you, with an optional settings file, companion, and seeded git state. **Do the same for any manual run** while you work on caching or cleanup code: a bare `node statusline.js` reads and tidies your real `~/.claude`.

If `characterization.test.js` fails, you changed what lines 1–3 print. Make sure you meant to, then update the assertion.

## README Visuals

`assets/readme/live.svg`, `live.gif`, and `companions.svg` are drawn from real renders. `build.js` feeds staged payloads through `statusline.js` in a throwaway config folder with a pinned clock and turns the ANSI output into SVG. `rasterize.py` screenshots the frames in headless Chromium and builds the GIF.

```bash
node assets/readme/source/build.js --frames /tmp/sl-frames
python assets/readme/source/rasterize.py gif /tmp/sl-frames assets/readme/live.gif
```

The GIF step needs Python with Pillow and Playwright (`playwright install chromium`). Rebuild after changing what the lines print or which soul lines the demo uses.

`assets/readme/tile.svg` is the project card at the top of the README: a CSS-animated SVG (no script, system fonts, so it plays inside a GitHub `<img>`) whose art is a real render acting out its four lines in 3-second beats. `tile.js` builds it from a list of pieces, each with a beat, a start time, and a resting and an active look; `tile.png` is the static fallback for reduced motion.

```bash
node assets/readme/source/tile.js
python assets/readme/source/rasterize.py png assets/readme/tile-static.svg assets/readme/tile.png
```

`tile.js --art <file>` also writes a narrow strip (beat tabs and terminal only, rendered at 72 columns) for a host page that draws its own frame and title, such as the tile on abialas.pl. `--layout wide <file>` writes the 96-column version, with the sync age and the repo link that 72 columns drop, for a tile that puts the art beside its text. The site uses the wide strip on desktop and the narrow one on phones.

## Releasing

Versions follow [semantic versioning](https://semver.org):

- **Patch** (`1.0.1`): bug fixes, soul lines added or reworded.
- **Minor** (`1.1.0`): a new segment, soul section, placeholder, or option that leaves existing installs working.
- **Major** (`2.0.0`): a change to the soul format, `statusline-soul.json`, the settings block, or the install layout that makes users redo something.

To cut a release:

1. Bump `VERSION` in `statusline.js`.
2. Add a `## [x.y.z] — YYYY-MM-DD` entry at the top of `CHANGELOG.md`, with an upgrade note if users must act. `version.test.js` fails until the two match.
3. Run `node --test`, then open a PR and merge it.
4. Tag the merge commit and publish: `git tag -a vX.Y.Z -m "vX.Y.Z"`, `git push origin vX.Y.Z`, then `gh release create vX.Y.Z --title "vX.Y.Z"` with the CHANGELOG entry as the notes.

## Commits

Short messages with a `feat:` / `fix:` / `docs:` / `test:` prefix. Run `node --test` before you commit.
