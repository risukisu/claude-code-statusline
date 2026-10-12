// test/agent-model-tag.test.js
// Pipe tests for the optional add-on extras/agent-model-tag.js. Every case runs with
// CLAUDE_CONFIG_DIR set to a temp fixture folder, so no test reads the real ~/.claude.
// The fixtures hold a user agent, a plugin agent, a project agent, a session transcript and
// one subagent transcript. The hook only reads; it never writes.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOOK = path.join(__dirname, "..", "extras", "agent-model-tag.js");
const fx = fs.mkdtempSync(path.join(os.tmpdir(), "amt-"));
const cfg = path.join(fx, "config");
const proj = path.join(fx, "proj");
const sub = path.join(proj, "src", "deep");
const plug = path.join(fx, "plugin-install");
const ns = path.join(fx, "projects", "ns");
const session = path.join(ns, "session1.jsonl");

function w(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
const line = (o) => JSON.stringify(o) + "\n";
w(path.join(cfg, "agents", "research", "reader.md"), "---\r\nname: reader\r\nmodel: haiku\r\ntools: Read\r\n---\r\nbody\r\n");
w(path.join(cfg, "agents", "same.md"), "---\nname: same\nmodel: opus\n---\n");
w(path.join(cfg, "agents", "inh.md"), "---\nname: inh\nmodel: inherit\n---\n");
w(path.join(cfg, "agents", "nomodel.md"), "---\nname: nomodel\ndescription: x\n---\n");
w(path.join(cfg, "agents", "file-stem.md"), "---\nmodel: \"sonnet\"  # quoted, comment\n---\n");
w(path.join(proj, ".git", "HEAD"), "ref: x\n");
w(path.join(proj, ".claude", "agents", "same.md"), "---\nname: same\nmodel: sonnet\n---\n");
fs.mkdirSync(sub, { recursive: true });
w(path.join(plug, "agents", "finder.md"), "---\ndescription: y\nmodel: haiku\n---\n");
w(path.join(plug, "agents", "review", "sec.md"), "---\nmodel: opus\n---\n");
w(path.join(cfg, "plugins", "installed_plugins.json"),
  JSON.stringify({ version: 2, plugins: { "toolbox@market": [{ scope: "user", installPath: plug }] } }));
w(session,
  line({ type: "user", message: { content: "hi" } }) +
  line({ type: "assistant", message: { model: "claude-opus-5-5", content: [] } }) +
  line({ type: "assistant", message: { model: "claude-fable-5-1", content: [] } }));
w(path.join(ns, "session1", "subagents", "agent-a.jsonl"),
  line({ type: "assistant", message: { model: "claude-haiku-5-5", content: [] } }));

// Config folders that hold only a statusline.json, for the emoji settings.
const cfgEmoji = path.join(fx, "cfg-emoji");
w(path.join(cfgEmoji, "statusline.json"), JSON.stringify({ agentTag: { emoji: { opus: "🧠", other: "·" } } }));
const cfgBad = path.join(fx, "cfg-bad");
w(path.join(cfgBad, "statusline.json"),
  JSON.stringify({ agentTag: { emoji: { opus: "[x]", haiku: "way-too-long", sonnet: 5, fable: "a\nb", other: "" } } }));
const cfgBroken = path.join(fx, "cfg-broken");
w(path.join(cfgBroken, "statusline.json"), "{ not json");

function run(input, env = {}, raw) {
  const base = { ...process.env };
  delete base.CLAUDE_CODE_SUBAGENT_MODEL; delete base.CLAUDE_CODE_SUBAGENT_MODEL_FORCE;
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw !== undefined ? raw : JSON.stringify(input),
    env: { ...base, CLAUDE_CONFIG_DIR: cfg, ...env }, encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, "the hook always exits 0");
  if (!r.stdout.trim()) return null;
  return JSON.parse(r.stdout).hookSpecificOutput.updatedInput.description;
}
const A = (o, extra = {}) => ({ tool_name: "Agent", cwd: sub, tool_input: { description: "Job", prompt: "p", ...o }, ...extra });
const T = (o) => A(o, { transcript_path: session });

const cases = [
  // Which model was asked for (no transcript: versions come from the table, marked "?").
  ["non-Agent tool is ignored", () => run({ tool_name: "Bash", tool_input: { command: "ls" } }), null],
  ["malformed JSON exits quietly", () => run(null, {}, "{not json"), null],
  ["already tagged is left alone", () => run(A({ description: "🤖 Job [opus]" })), null],
  ["per-invocation model wins", () => run(A({ subagent_type: "reader", model: "opus" })), "🤖 Job [🟣 opus: Opus 5.5?]"],
  ["fork always parent", () => run(A({ subagent_type: "fork", model: "haiku" })), "🤖 Job [⚪ fork:parent]"],
  ["user agent frontmatter (subfolder, CRLF)", () => run(A({ subagent_type: "reader" })), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["project agent beats user agent", () => run(A({ subagent_type: "same" })), "🤖 Job [🔵 sonnet: Sonnet 5.5?]"],
  ["user agent used outside the project", () => run({ ...A({ subagent_type: "same" }), cwd: fx }), "🤖 Job [🟣 opus: Opus 5.5?]"],
  ["model: inherit stays inherit", () => run(A({ subagent_type: "inh" })), "🤖 Job [⚪ inherit]"],
  ["no model field falls through", () => run(A({ subagent_type: "nomodel" })), "🤖 Job [⚪ inherit]"],
  ["filename stem when no name, quotes stripped", () => run(A({ subagent_type: "file-stem" })), "🤖 Job [🔵 sonnet: Sonnet 5.5?]"],
  ["plugin agent", () => run(A({ subagent_type: "toolbox:finder" })), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["plugin agent in subfolder", () => run(A({ subagent_type: "toolbox:review:sec" })), "🤖 Job [🟣 opus: Opus 5.5?]"],
  ["built-in claude-code-guide", () => run(A({ subagent_type: "claude-code-guide" })), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["built-in statusline-setup", () => run(A({ subagent_type: "statusline-setup" })), "🤖 Job [🔵 sonnet: Sonnet 5.5?]"],
  ["general-purpose inherits", () => run(A({ subagent_type: "general-purpose" })), "🤖 Job [⚪ inherit]"],
  ["omitted type inherits", () => run(A({})), "🤖 Job [⚪ inherit]"],
  ["env default fills a gap", () => run(A({ subagent_type: "general-purpose" }), { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["frontmatter beats env default", () => run(A({ subagent_type: "same" }), { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }), "🤖 Job [🔵 sonnet: Sonnet 5.5?]"],
  ["env default 'inherit' = unset", () => run(A({}), { CLAUDE_CODE_SUBAGENT_MODEL: "inherit" }), "🤖 Job [⚪ inherit]"],
  ["FORCE + env beats dispatch", () => run(A({ subagent_type: "reader", model: "opus" }), { CLAUDE_CODE_SUBAGENT_MODEL: "haiku", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" }), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["FORCE alone = main model", () => run(A({ subagent_type: "reader", model: "opus" }), { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" }), "🤖 Job [⚪ inherit]"],
  ["FORCE never touches a fork", () => run(A({ subagent_type: "fork" }), { CLAUDE_CODE_SUBAGENT_MODEL: "haiku", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" }), "🤖 Job [⚪ fork:parent]"],
  ["empty description gets a name", () => run(A({ description: "", subagent_type: "reader" })), "🤖 Agent [🟢 haiku: Haiku 5.5?]"],
  ["robot prefix not doubled", () => run(A({ description: "🤖 Job", subagent_type: "reader" })), "🤖 Job [🟢 haiku: Haiku 5.5?]"],

  // The exact version, from the fixture transcripts.
  ["inherit names the session model", () => run(T({ subagent_type: "general-purpose" })), "🤖 Job [⚪ inherit: Fable 5.1]"],
  ["fork names the session model", () => run(T({ subagent_type: "fork" })), "🤖 Job [⚪ fork: Fable 5.1]"],
  ["alias seen in a subagent transcript has no ?", () => run(T({ model: "haiku" })), "🤖 Job [🟢 haiku: Haiku 5.5]"],
  ["alias never seen falls back to the table", () => run(T({ model: "sonnet" })), "🤖 Job [🔵 sonnet: Sonnet 5.5?]"],
  ["fable alias", () => run(A({ model: "fable" })), "🤖 Job [🟡 fable: Fable 5.1?]"],
  ["full id shows its friendly name", () => run(A({ model: "claude-sonnet-5-5" })), "🤖 Job [🔵 Sonnet 5.5]"],
  ["dated id with a context suffix", () => run(A({ model: "claude-opus-4-1-20250805[1m]" })), "🤖 Job [🟣 Opus 4.1]"],
  ["unknown alias stays as given", () => run(A({ model: "mystery" })), "🤖 Job [⚪ mystery]"],

  // Emoji settings in statusline.json.
  ["emoji override for a family", () => run(A({ model: "opus" }), { CLAUDE_CONFIG_DIR: cfgEmoji }), "🤖 Job [🧠 opus: Opus 5.5?]"],
  ["emoji override for other", () => run(A({}), { CLAUDE_CONFIG_DIR: cfgEmoji }), "🤖 Job [· inherit]"],
  ["override leaves other families alone", () => run(A({ model: "haiku" }), { CLAUDE_CONFIG_DIR: cfgEmoji }), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["bracket in a value is ignored", () => run(A({ model: "opus" }), { CLAUDE_CONFIG_DIR: cfgBad }), "🤖 Job [🟣 opus: Opus 5.5?]"],
  ["over-long value is ignored", () => run(A({ model: "haiku" }), { CLAUDE_CONFIG_DIR: cfgBad }), "🤖 Job [🟢 haiku: Haiku 5.5?]"],
  ["non-string value is ignored", () => run(A({ model: "sonnet" }), { CLAUDE_CONFIG_DIR: cfgBad }), "🤖 Job [🔵 sonnet: Sonnet 5.5?]"],
  ["newline in a value is ignored", () => run(A({ model: "fable" }), { CLAUDE_CONFIG_DIR: cfgBad }), "🤖 Job [🟡 fable: Fable 5.1?]"],
  ["empty value is ignored", () => run(A({}), { CLAUDE_CONFIG_DIR: cfgBad }), "🤖 Job [⚪ inherit]"],
  ["broken statusline.json keeps the defaults", () => run(A({ model: "opus" }), { CLAUDE_CONFIG_DIR: cfgBroken }), "🤖 Job [🟣 opus: Opus 5.5?]"],
];

for (const [name, fn, want] of cases) {
  test(name, () => assert.strictEqual(fn(), want));
}
