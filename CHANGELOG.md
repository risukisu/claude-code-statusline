# Changelog

## Unreleased

### Fixed

- **Status-line renders could leak into permanently-hung processes.** `main()`
  blocked on stdin `end`, but Claude Code cancels a superseded render by orphaning
  the process without closing stdin, so `end` never fired and the `node` process
  hung forever at 0% CPU. On a busy machine with several sessions these piled up
  (observed: 49 orphans, oldest ~40h, ~1.7GB resident) until the whole system
  paged and even terminal input lagged. `main()` now arms a self-terminating
  watchdog (like `hook()` already had), so an orphaned render exits on its own.

- **Each render shelled out to git 4–5× — a subprocess storm.** `git status`,
  `rev-parse`, `config`, and `log` ran on every render; at the minimum
  `refreshInterval` across multiple sessions that was several `node`+git spawns
  per second. The git snapshot is now cached per session with a short TTL, so
  rapid successive renders reuse it instead of re-shelling out. Recommended
  `refreshInterval` raised from `1` to `10` (it is in seconds and runs *in
  addition* to event-driven renders; each render is a fresh process).

- **React `claude -p` generator child is now force-killed on timeout.** It ran
  with the default (ignorable) `SIGTERM`; it now uses `SIGKILL` with an
  env-overridable timeout so a stuck generation can't linger.

- **React companion could burn API usage when multiple sessions were open.**
  The react-mode cache was a single machine-global file keyed by one prompt
  hash, polled by every session's once-per-second status-line render. With two
  or more Claude Code sessions open, each render saw *another* session's cached
  prompt, judged it "new," and fired a `claude -p` (Haiku) call — ping-ponging
  continuously even while idle, and sometimes showing one session's comment in
  another.

  React generation is now driven by a **`UserPromptSubmit` hook** instead of the
  render loop:
  - The status line is **read-only** — it never spawns a generation.
  - Generation fires **once per submitted prompt**, scoped to that session.
  - The cache is **per-session** (keyed by `session_id`); sessions can't read or
    trigger each other's.
  - A **recursion guard** stops the companion's own `claude -p` call from
    re-triggering the hook.
  - A **circuit breaker** caps bursts (more than 20 generations in 2 minutes →
    30-minute cooldown) as a hard backstop, with a quiet "resting" note on line 4.

  **React mode now requires registering the `UserPromptSubmit` hook** — see
  [`settings.snippet.json`](settings.snippet.json) and the Animal companion
  section of the README. `off` and `canned` modes need no hook and make no model
  calls.
