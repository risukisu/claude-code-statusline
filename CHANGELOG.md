# Changelog

## Unreleased

### Fixed

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
