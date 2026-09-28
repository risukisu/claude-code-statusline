# Changelog

Notable changes to claude-code-statusline, newest first. The project follows
[Semantic Versioning](https://semver.org): patch releases fix things, minor releases add
segments, soul sections, or options without breaking an existing install, and a major
release changes the soul format, the config file, or the install layout.

## [1.0.0] — 2026-09-28

The first tagged release.

### What Ships

- Line 1, session: model, reasoning effort, a blue → amber → red context bar,
  tokens used of the window, and lines added and removed.
- Line 2, limits: 5-hour and 7-day usage, pace against the clock (`⇡` burning fast,
  `⇣` under pace), and time until each window resets.
- Line 3, git: the launch folder in its own shimmering workspace colour, the repo
  you're in when it differs, branch, uncommitted files, ahead/behind or `✓ synced`,
  age of the upstream's last commit, the origin remote, and the open PR's review state.
- Line 4, companion (optional, off by default): a squirrel, fox, or turtle that
  comments on your work with hand-written lines. Pick one with `/animal`.
- No network, no API keys, no model calls, no dependencies. `node` and a few local
  `git` reads.

### New Since the Pre-Release Builds

- **Companions notice what's going on.** Souls gained nine state sections: `dirty`,
  `ahead`, `behind`, `context`, `limits`, `synced`, `branch`, `norepo`, and `night`.
  Lines can carry live values: `{dirty}`, `{ahead}`, `{behind}`, `{ctx}`, `{limit}`,
  `{branch}`, and `{dirty:file}` for "1 file" / "3 files". While you're busy, two lines
  in three speak to the state and the third is idle chatter, so the character still
  shows. Old souls with only `work` and `ambient` keep working.
- **Eight times the lines.** Each shipped soul went from 8 lines to 66–68.
- **`node statusline.js --version`** prints the installed version.

### Fixed

- **Cache files piled up in `~/.claude`.** Each session's git snapshot cache stayed
  forever, and on Windows a failed atomic write left its temp file behind (one machine
  had 88 caches and 322 temp files). A failed write now removes its temp file, and a
  session's first render sweeps `statusline-git.*` caches idle for a day and temp files
  older than a minute. It touches no other file.
- **Cancelled renders hung forever.** Claude Code orphans a superseded render without
  closing its stdin; the process now exits on its own after 8 seconds.
- **Every render ran git 4–5 times.** The git snapshot is cached per session for 3
  seconds, and the recommended `refreshInterval` is `10`.

### Upgrading From a Pre-1.0 Checkout

- Copy `statusline.js`, `souls/`, and `commands/animal.md` into `~/.claude/` again.
- An experimental live companion mode existed before 1.0 and is gone. If your
  `~/.claude/statusline-soul.json` still names it, the companion reads as `off`; run
  `/animal` to pick again.
- If `~/.claude/settings.json` has a `UserPromptSubmit` hook running
  `statusline.js --hook`, delete that entry. It does nothing now.

[1.0.0]: https://github.com/risukisu/claude-code-statusline/releases/tag/v1.0.0
