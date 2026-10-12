# Agent Model Labels — Design

Date: 2026-10-12. Status: approved in chat; build follows.

## Goal

Claude Code's terminal lists each subagent by its description ("background agents launched",
"Agent … finished"). It never says which model the agent runs on. An optional add-on in this
repo rewrites the description at launch so the line shows the model, its exact version, and a
coloured dot per model family:

```
Agent "🤖 Plan the release [🟡 fable: Fable 5.1]" finished · 2m 10s
Agent "🤖 Fix save findings [🟣 opus: Opus 5.5]" finished · 1m 1s
Agent "🤖 Small edit [🔵 sonnet: Sonnet 5.5]" finished · 30s
Agent "🤖 Read docs [🟢 haiku: Haiku 5.5]" finished · 20s
Agent "🤖 Explore repo [⚪ inherit: Fable 5.1]" finished · 45s
```

The add-on is opt-in. A user who installs only the status line gets no hook, as before.

## What ships

| Path | Purpose |
|---|---|
| `extras/agent-model-tag.js` | the hook: a PreToolUse command on the `Agent` tool, zero dependencies |
| `test/agent-model-tag.test.js` | `node:test` suite, fixtures in a temp folder |
| `README.md` | "Optional: Agent Model Labels" section with the install block |
| `AGENTS.md` | an optional install step, run only when the user asks for the labels |
| `CONTRIBUTING.md` | the transcript rule, narrowed (see below) |
| `CHANGELOG.md`, `statusline.js` `VERSION` | release 1.2.0 |

## How the label is built

1. **Which model was asked for.** Claude Code's documented order
   (code.claude.com/docs/en/sub-agents#choose-a-model):
   - a fork always runs on the parent model;
   - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on: the env model, else the main model;
   - the `model` passed at launch;
   - the agent definition's `model:` frontmatter: project `.claude/agents/` walking up from the
     working folder to the repository root (closest wins), then `~/.claude/agents/`, then the
     plugin's `agents/` folder found through `plugins/installed_plugins.json`; identity is the
     `name:` field, else the filename;
   - the two built-ins with a fixed model (`statusline-setup` → sonnet, `claude-code-guide` → haiku);
   - `CLAUDE_CODE_SUBAGENT_MODEL`;
   - otherwise `inherit`.
2. **The exact version.**
   - `inherit` and `fork` → the model of the last assistant message in the session transcript
     the hook input names (`transcript_path`).
   - an alias (`fable`, `opus`, `sonnet`, `haiku`) → the newest `claude-<alias>-*` id recorded in
     the same project folder's subagent transcripts; when none was seen yet, a built-in table of
     current ids, marked `?` (`haiku: Haiku 5.5?`).
   - a full id → its friendly name (`claude-sonnet-5-5` → `Sonnet 5.5`).
3. **The dot.** By family: 🟡 fable, 🟣 opus, 🔵 sonnet, 🟢 haiku. `inherit`, `fork` and any
   unknown model get ⚪.
4. **The text.** `🤖 <description> [<dot> <label>]`; an empty description becomes `Agent`. A
   description that already ends in `[…]` is left alone, and a leading 🤖 is never doubled.

## Settings

`~/.claude/statusline.json` (the status line's own file; honours `CLAUDE_CONFIG_DIR`) may hold:

```json
{ "agentTag": { "emoji": { "opus": "🧠", "other": "·" } } }
```

Keys: `fable`, `opus`, `sonnet`, `haiku`, `other`. A value must be a string of 1 to 8
characters with no brackets, newlines or control characters; anything else keeps the default.
Unknown keys are ignored. `statusline.js` already ignores keys it does not know.

## The transcript rule

`CONTRIBUTING.md` says the project never reads transcripts. The narrowed rule:
`statusline.js` reads no transcripts. The opt-in add-on reads only the `model` field of
assistant messages, from the tail (last 512 KB) of local transcript files, and nothing leaves
the machine. No network, no model calls, no dependencies, for both.

## Failure behaviour

- Any other tool, or input that is not valid JSON: exit 0 with no output.
- A lookup error: `[⚪ inherit]`; an expansion error: the unexpanded alias (`[🟣 opus]`).
- Never blocks a launch; always exits 0.

## Testing

The 25 fixture cases of the existing hook carried over, with expected labels updated to the
detailed form, plus: exact versions from a fixture session transcript (inherit, fork), an
alias seen in a fixture subagent transcript (no `?`), the table fallback (`?`), a full id, an
unknown alias, each default dot, an emoji override, and a bad override ignored. Every case runs
with `CLAUDE_CONFIG_DIR` set to a temp fixture folder; no case reads the real `~/.claude`.

## Out of scope

Listing running agents inside the status line itself; caching observed versions; any change to
`statusline.js` beyond the version number.
