#!/usr/bin/env node
// agent-model-tag.js — optional add-on to claude-code-statusline (MIT).
// A PreToolUse hook on Claude Code's Agent tool. It appends the model a subagent will run on
// to its description, so the terminal's "background agents launched" list and the
// "Agent … finished" lines show it, with a dot per model family:
//   "Deep read batch 1"  ->  "🤖 Deep read batch 1 [🟣 opus: Opus 5.5]"
//
// Resolution follows Claude Code's documented subagent model order
// (code.claude.com/docs/en/sub-agents#choose-a-model, checked 2026-10-11 on v2.1.296):
//   - a fork always runs on the parent model                         [fork:parent]
//   - CLAUDE_CODE_SUBAGENT_MODEL_FORCE on: the env model, else the main model
//   1. the per-invocation `model` parameter
//   2. the agent definition's `model:` frontmatter: project .claude/agents/ walking
//      up from cwd (closest wins), then ~/.claude/agents/, then plugin agents/;
//      `inherit` means the main model
//   3. CLAUDE_CODE_SUBAGENT_MODEL
//   4. the main conversation's model                                 [inherit]
// The tag is a label at launch. /tasks shows the model a running subagent really uses.
// The resolved alias is then expanded to the concrete model so the finished-agent line reads
// "[sonnet: Sonnet 5.5]" rather than "[sonnet]":
//   - inherit / fork:parent -> the session model, read from the last assistant message in the
//     transcript the hook input names (transcript_path)
//   - an alias (sonnet/opus/haiku/fable) -> the newest claude-<alias>-* id recorded in this
//     namespace's subagent transcripts (~/.claude/projects/<ns>/*/subagents/*.jsonl); falls back
//     to ALIAS_FALLBACK (Claude 5 family, checked 2026-10-12) when nothing was observed yet
//   - a full id is shown by its friendly name ("claude-sonnet-5-5" -> "Sonnet 5.5")
// The dot comes from the family of the resolved model: 🟡 fable, 🟣 opus, 🔵 sonnet, 🟢 haiku,
// ⚪ inherit, fork and anything unknown. "agentTag": {"emoji": {...}} in ~/.claude/statusline.json
// overrides any of them (keys fable, opus, sonnet, haiku, other).
// Reads only: agent definitions, plugins/installed_plugins.json, statusline.json, and the model
// field of local transcript tails. No network, no model calls, no writes.
// Silent exit 0 for every other tool and on any parse error; a lookup error never blocks a launch.

const fs = require("fs");
const os = require("os");
const path = require("path");

let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
let j;
try {
  j = JSON.parse(raw);
} catch {
  process.exit(0);
}

if (String(j.tool_name || "") !== "Agent") process.exit(0);

const input = j.tool_input || {};
let desc = String(input.description || "").trim();
if (/\[[^\]]+\]\s*$/.test(desc)) process.exit(0); // already tagged
desc = desc.replace(/^🤖\s*/u, ""); // re-add once, below

const CONFIG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

// Built-in helpers with a fixed model, from the docs' built-in subagents table.
// A user or project agent with the same name overrides these.
const BUILTIN = { "statusline-setup": "sonnet", "claude-code-guide": "haiku" };

function clean(v) {
  return String(v || "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "").trim();
}

function envModel() {
  const v = clean(process.env.CLAUDE_CODE_SUBAGENT_MODEL);
  return v && v !== "inherit" ? v : "";
}

function forceOn() {
  return /^(1|true|yes|on)$/i.test(String(process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE || "").trim());
}

// { name, model } from a definition file's frontmatter, or null.
function frontmatter(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  const head = end < 0 ? "" : text.slice(4, end);
  const field = (k) => {
    const m = head.match(new RegExp("^" + k + ":[ \\t]*(.*)$", "m"));
    return m ? clean(m[1]) : "";
  };
  return { name: field("name"), model: field("model") };
}

function mdFiles(dir, depth = 0) {
  if (depth > 6) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(p, depth + 1));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

// Identity is the `name:` field; fall back to the filename stem when it is absent.
function findIn(dir, type) {
  for (const f of mdFiles(dir)) {
    const fm = frontmatter(f);
    if (!fm) continue;
    if ((fm.name || path.basename(f, path.extname(f))) === type) return fm;
  }
  return null;
}

function projectAgent(type, cwd) {
  if (!cwd) return null;
  const home = path.resolve(CONFIG, "..");
  let dir = path.resolve(cwd);
  for (;;) {
    if (dir !== home) {
      const fm = findIn(path.join(dir, ".claude", "agents"), type);
      if (fm) return fm;
    }
    if (fs.existsSync(path.join(dir, ".git"))) return null; // repository root reached
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// "plugin:sub:name" -> <installPath>/agents/sub/name.md
function pluginAgent(type) {
  const parts = type.split(":");
  if (parts.length < 2) return null;
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(path.join(CONFIG, "plugins", "installed_plugins.json"), "utf8"));
  } catch {
    return null;
  }
  for (const [key, installs] of Object.entries(reg.plugins || {})) {
    if (key.split("@")[0] !== parts[0]) continue;
    for (const inst of [].concat(installs || [])) {
      if (!inst || !inst.installPath) continue;
      const fm = frontmatter(path.join(inst.installPath, "agents", ...parts.slice(1)) + ".md");
      if (fm) return fm;
    }
  }
  return null;
}

function resolve() {
  const type = String(input.subagent_type || "general-purpose").trim();
  if (type === "fork") return "fork:parent";
  if (forceOn()) return envModel() || "inherit";
  const passed = clean(input.model);
  if (passed) return passed;
  const def =
    projectAgent(type, j.cwd) ||
    findIn(path.join(CONFIG, "agents"), type) ||
    pluginAgent(type) ||
    (BUILTIN[type] ? { model: BUILTIN[type] } : null);
  if (def && def.model) return def.model;
  return envModel() || "inherit";
}

// ---- alias -> concrete model ----

const ALIAS_FALLBACK = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", haiku: "claude-haiku-5-5", fable: "claude-fable-5-1" };

// "claude-sonnet-5-5" -> "Sonnet 5.5"; "claude-opus-4-1-20250805[1m]" -> "Opus 4.1"
function friendly(id) {
  const m = String(id || "").match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?/i);
  if (!m) return String(id || "");
  const fam = m[1][0].toUpperCase() + m[1].slice(1);
  return fam + " " + m[2] + (m[3] ? "." + m[3] : "");
}

// Last assistant message's model in a transcript (reads only the tail of a large file).
function transcriptModel(file) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"')) continue;
      try {
        const l = JSON.parse(lines[i]);
        if (l.type === "assistant" && l.message && l.message.model) return String(l.message.model);
      } catch { /* partial first line of the tail window */ }
    }
  } catch { /* no transcript yet */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  return "";
}

// Newest claude-<alias>-* id seen in this namespace's subagent transcripts.
function observedModel(alias) {
  const ns = j.transcript_path ? path.dirname(j.transcript_path) : "";
  if (!ns) return "";
  let sessions;
  try { sessions = fs.readdirSync(ns, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return ""; }
  const files = [];
  for (const s of sessions) {
    const dir = path.join(ns, s.name, "subagents");
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const p = path.join(dir, n);
      try { files.push({ p, t: fs.statSync(p).mtimeMs }); } catch { /* ignore */ }
    }
  }
  files.sort((a, b) => b.t - a.t);
  const re = new RegExp("^claude-" + alias + "-", "i");
  for (const f of files.slice(0, 80)) {
    const m = transcriptModel(f.p);
    if (m && re.test(m)) return m;
  }
  return "";
}

// "sonnet" -> "sonnet: Sonnet 5.5", "inherit" -> "inherit: Fable 5.1", id -> "Sonnet 5.5"
function expand(label) {
  if (label === "inherit" || label === "fork:parent") {
    const m = j.transcript_path ? transcriptModel(j.transcript_path) : "";
    const key = label === "fork:parent" ? "fork" : "inherit";
    return m ? key + ": " + friendly(m) : label;
  }
  if (/^claude-/i.test(label)) return friendly(label);
  const alias = label.toLowerCase();
  if (/^[a-z]+$/.test(alias)) {
    const seen = observedModel(alias);
    if (seen) return alias + ": " + friendly(seen);
    const guess = ALIAS_FALLBACK[alias];
    return guess ? alias + ": " + friendly(guess) + "?" : label; // "?" = table default, not observed
  }
  return label;
}

// ---- the dot ----

const DOTS = { fable: "🟡", opus: "🟣", sonnet: "🔵", haiku: "🟢", other: "⚪" };

// Defaults, with any valid override from statusline.json: a string of 1 to 8 characters,
// no brackets, no control characters. Anything else keeps the default.
function dots() {
  const out = Object.assign({}, DOTS);
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(CONFIG, "statusline.json"), "utf8")); } catch { return out; }
  const e = c && c.agentTag && c.agentTag.emoji;
  if (!e || typeof e !== "object") return out;
  for (const k of Object.keys(DOTS)) {
    const v = e[k];
    if (typeof v === "string" && v.length && [...v].length <= 8 && !/[[\]\u0000-\u001f\u007f]/.test(v)) out[k] = v;
  }
  return out;
}

// "opus", "claude-opus-5-5" -> "opus"; inherit, fork:parent and anything unknown -> "other"
function family(label) {
  const k = String(label || "").toLowerCase().replace(/^claude-/, "").split(/[^a-z]/)[0];
  return k !== "other" && Object.prototype.hasOwnProperty.call(DOTS, k) ? k : "other";
}

let model = "inherit";
try {
  model = resolve();
} catch {
  // a lookup bug must never block a launch; fall back to the plain tag
}
let shown = model;
try {
  shown = expand(model);
} catch {
  // expansion is cosmetic; the plain alias is still correct
}
let dot = DOTS.other;
try {
  dot = dots()[family(model)];
} catch {
  // the dot is cosmetic too
}

const out = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: Object.assign({}, input, {
      description: "🤖 " + (desc ? desc + " " : "Agent ") + "[" + dot + " " + shown + "]",
    }),
  },
};
process.stdout.write(JSON.stringify(out));
process.exit(0);
