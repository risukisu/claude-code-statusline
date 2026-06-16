#!/usr/bin/env node
/**
 * Claude Code status line — a micro terminal dashboard.
 * https://github.com/risukisu/claude-code-statusline
 *
 * Renders three lines from the JSON Claude Code pipes to a status-line command
 * (no API calls, no transcript parsing — just the stdin payload):
 *
 *   Line 1 (session):  ⏺  Model ✦ effort  ▕████████░░░░▏ 42% · 420k/1M  │  +156 −23
 *   Line 2 (limits):   ◷ 5h 24% ⇣8 · 1h47m left  │  7d 81% ⇡3 · 2d3h left
 *   Line 3 (git):      📁  LaunchRoot ▸ repo : branch · ✚3 · ⇡2 ⇣1 · ↻3h ago · gh:owner/name · PR #12 pending
 *
 * Pace arrows (line 2): ⇡N = used N% more of the window than the clock has
 * elapsed (burning fast), ⇣N = under pace. Line 3 leads with the LAUNCH folder
 * (workspace.project_dir) carrying a per-workspace identity shimmer — map your
 * own roots to colors in ROOT_PALETTES below. The defaults colour two example
 * workspaces: a personal root cyan→mint and a work root amber→gold. When the
 * session has cd'd into a different repo, a ▸ shows it and the git details
 * describe the repo you're actually in — gh: reads its real `origin` remote.
 *
 * Install: save to ~/.claude/statusline.js and register in ~/.claude/settings.json:
 *   "statusLine": { "type": "command", "command": "node ~/.claude/statusline.js", "refreshInterval": 1 }
 *   (Windows: use the full path, e.g. node C:/Users/<you>/.claude/statusline.js)
 *
 * Context-bar gradient ported from getagentseal/codeburn. MIT licensed.
 */

"use strict";
const { execSync } = require("child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EMOJI = { squirrel: "🐿️", fox: "🦊", turtle: "🐢" };
const ANIMALS = ["squirrel", "fox", "turtle"];
const MODES = ["off", "canned", "react"];
const IDLE_AFTER_MS = 90_000;
const AMBIENT_EVERY_MS = 30_000;
const PROMPT_MAX = 500;

const claudeDir = () => path.join(os.homedir(), ".claude");
const CONFIG_FILE = () => path.join(claudeDir(), "statusline-soul.json");
// Per-session cache: keyed by session_id (present in BOTH the status-line stdin and the
// UserPromptSubmit hook stdin) so no session can ever read or trigger another's generation.
const sessionKey = (id) => (String(id || "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default");
const CACHE_FILE = (id) => path.join(claudeDir(), `statusline-soul.${sessionKey(id)}.cache.json`);
const BUDGET_FILE = () => path.join(claudeDir(), "statusline-soul.budget.json");
const SOUL_FILE = (animal) => path.join(claudeDir(), "souls", `${animal}.md`);

// Circuit breaker — machine-wide burst cap so a runaway can never drain the rate limit.
const BURST_MAX = 20;             // this many generations…
const BURST_WINDOW_MS = 120_000;  // …inside this window trips the breaker
const COOLDOWN_MS = 30 * 60_000;  // and it stays tripped (no model calls) this long

module.exports = {}; // extended by later tasks

// ─── transcript parser ─────────────────────────────────────────────────────
function latestUserPrompt(transcriptPath) {
  try {
    const buf = fs.readFileSync(transcriptPath, "utf8");
    const lines = buf.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let o; try { o = JSON.parse(lines[i]); } catch { continue; }
      const msg = o.message || o;
      const isUser = o.type === "user" || (msg && msg.role === "user");
      if (!isUser || !msg) continue;
      const c = msg.content;
      if (typeof c === "string") return c.trim() || null;
      if (Array.isArray(c)) {
        const text = c.filter((b) => b && b.type === "text").map((b) => b.text).join(" ").trim();
        if (text) return text;
      }
    }
    return null;
  } catch {
    return null;
  }
}
module.exports.latestUserPrompt = latestUserPrompt;

// ─── soul markdown parser ──────────────────────────────────────────────────
function parseSoul(md) {
  const out = { voice: "", rules: "", work: [], ambient: [], react: "" };
  if (typeof md !== "string") return out;
  let section = null;
  const reactLines = [];
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const h = line.match(/^##\s+(\w+)/);
    if (h) { section = h[1].toLowerCase(); continue; }
    const v = line.match(/^voice:\s*(.+)$/i); if (v) { out.voice = v[1].trim(); continue; }
    const r = line.match(/^rules:\s*(.+)$/i); if (r) { out.rules = r[1].trim(); continue; }
    if ((section === "work" || section === "ambient") && line.trim().startsWith("-")) {
      const item = line.replace(/^\s*-\s+/, "").trim();
      if (item) out[section].push(item);
    } else if (section === "react") {
      reactLines.push(line);
    }
  }
  out.react = reactLines.join("\n").trim();
  return out;
}
module.exports.parseSoul = parseSoul;

// ─── ANSI helpers ──────────────────────────────────────────────────────────
const ESC = "\x1b[";
const RESET = ESC + "0m";
const BOLD = ESC + "1m";
const rgb = (r, g, b) => `${ESC}38;2;${r};${g};${b}m`;
const DIM = rgb(110, 110, 110);
const FAINT = rgb(70, 70, 70);
const WHITE = rgb(235, 235, 235);
const ORANGE = rgb(232, 116, 79); // ⏺ Claude warm
const VIOLET = rgb(180, 142, 245); // effort
const BLUE = rgb(91, 158, 245); // codeburn blue
const GREEN = rgb(91, 245, 140);
const YELLOW = rgb(245, 200, 91);
const RED = rgb(245, 91, 91);
const sep = ` ${FAINT}·${RESET} `; // ·
const bigSep = `  ${FAINT}│${RESET}  `; // │

// ─── codeburn gradient bar (dashboard.tsx HBar, verbatim color math) ──────
function gradientColor(pct) {
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  let r, g, b;
  if (pct <= 0.33) {
    const t = pct / 0.33;
    r = lerp(91, 245, t); g = lerp(158, 200, t); b = lerp(245, 91, t);
  } else if (pct <= 0.66) {
    const t = (pct - 0.33) / 0.33;
    r = lerp(245, 255, t); g = lerp(200, 140, t); b = lerp(91, 66, t);
  } else {
    const t = (pct - 0.66) / 0.34;
    r = lerp(255, 245, t); g = lerp(140, 91, t); b = lerp(66, 91, t);
  }
  return rgb(r, g, b);
}

function bar(pctUsed, width) {
  const filled = Math.max(0, Math.min(width, Math.round((pctUsed / 100) * width)));
  let out = "";
  for (let i = 0; i < filled; i++) out += gradientColor(i / width) + "█"; // █
  out += rgb(51, 51, 51) + "░".repeat(width - filled); // ░
  return `${FAINT}▕${out}${RESET}${FAINT}▏${RESET}`; // ▕ ... ▏
}

function pctColor(p) {
  return p >= 80 ? RED : p >= 50 ? YELLOW : GREEN;
}

function fmtTokens(n) {
  if (n == null) return "?";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  const m = n / 1_000_000;
  return (m >= 10 || Number.isInteger(m) ? Math.round(m) : m.toFixed(1)) + "M";
}

function relTime(epochSec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epochSec);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function fmtDur(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

// ─── git (max 2 subprocess calls, never throws) ───────────────────────────
function git(args, cwd) {
  try {
    return execSync(`git --no-optional-locks ${args}`, {
      cwd, timeout: 1500, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return null;
  }
}

function gitInfo(cwd) {
  const st = git("status --porcelain=v2 --branch", cwd);
  if (st == null) return null;
  const info = { branch: null, upstream: null, ahead: 0, behind: 0, dirty: 0, syncAge: null };
  for (const line of st.split("\n")) {
    if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
    else if (line.startsWith("# branch.upstream ")) info.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { info.ahead = +m[1]; info.behind = +m[2]; }
    } else if (line && !line.startsWith("#")) info.dirty++;
  }
  if (info.upstream) {
    const t = git("log -1 --format=%ct @{u}", cwd);
    if (t && /^\d+$/.test(t)) info.syncAge = relTime(+t);
  }
  return info;
}

// ─── workspace-identity shimmer (port of feedback-shimmer.ps1) ─────────────
// CSS stops: 0% c1 -> 40% c2 -> 60% c1 -> 100% c2, phase sweeps a full
// cycle every 3s of wall clock — each status line refresh shows the next frame.
const ROOT_PALETTES = [
  { match: /^[a-z]:[\\/]+ai_workspace_personal/i, c1: [6, 182, 212], c2: [74, 222, 128] },   // cyan → mint
  { match: /^[a-z]:[\\/]+ai_workspace_appsilon/i, c1: [245, 158, 11], c2: [253, 230, 138] }, // amber → gold
];

function shimmer(text, c1, c2) {
  const t = (Date.now() % 3000) / 3000;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    let ph = ((i / text.length) - t) % 1;
    if (ph < 0) ph += 1;
    let f;
    if (ph < 0.4) f = ph / 0.4;
    else if (ph < 0.6) f = 1 - (ph - 0.4) / 0.2;
    else f = (ph - 0.6) / 0.4;
    out += rgb(
      Math.round(c1[0] + (c2[0] - c1[0]) * f),
      Math.round(c1[1] + (c2[1] - c1[1]) * f),
      Math.round(c1[2] + (c2[2] - c1[2]) * f),
    ) + text[i];
  }
  return out + RESET;
}

// ─── origin remote of the CURRENT dir (not the session's launch repo) ──────
function parseRemote(url) {
  if (!url) return null;
  const m = url.match(/(?:@|:\/\/)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { host: m[1], owner: m[2], name: m[3] } : null;
}

// ─── rate-limit window: used %, pace vs time elapsed, reset countdown ─────
function limitSeg(label, win, windowLen) {
  if (!win || win.used_percentage == null) return null;
  const p = Math.round(win.used_percentage);
  let seg = `${DIM}${label}${RESET} ${pctColor(p)}${p}%${RESET}`;
  if (win.resets_at) {
    const remaining = win.resets_at - Math.floor(Date.now() / 1000);
    if (remaining > 0 && remaining <= windowLen) {
      const elapsedPct = (1 - remaining / windowLen) * 100;
      const delta = Math.round(win.used_percentage - elapsedPct);
      if (delta >= 2) seg += ` ${delta >= 15 ? RED : YELLOW}⇡${delta}${RESET}`;
      else if (delta <= -2) seg += ` ${GREEN}⇣${-delta}${RESET}`;
      seg += `${sep}${DIM}${fmtDur(remaining)} left${RESET}`;
    }
  }
  return seg;
}

// ─── prompt hashing + cache I/O ───────────────────────────────────────────
function promptHash(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 16);
}
function isNewPrompt(prompt, cache) {
  if (!prompt) return false;
  if (!cache || !cache.promptHash) return true;
  return cache.promptHash !== promptHash(prompt);
}
function readCache(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeCache(file, obj) {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch { /* never throw from the status line */ }
}
module.exports.promptHash = promptHash;
module.exports.isNewPrompt = isNewPrompt;
module.exports.readCache = readCache;
module.exports.writeCache = writeCache;

// ─── circuit breaker (pure) ───────────────────────────────────────────────
// Given the recorded generation timestamps and `now`, decide whether one more
// model call is allowed. Trips (and starts a cooldown) on a burst; auto-resets.
function evaluateBudget(budget, now) {
  budget = budget && Array.isArray(budget.events) ? budget : { events: [], tripUntil: 0 };
  if (budget.tripUntil && now < budget.tripUntil) return { allowed: false, state: "cooldown", budget };
  const events = budget.events.filter((t) => now - t < BURST_WINDOW_MS);
  if (events.length >= BURST_MAX) return { allowed: false, state: "tripped", budget: { events, tripUntil: now + COOLDOWN_MS } };
  return { allowed: true, state: "ok", budget: { events: [...events, now], tripUntil: 0 } };
}
function isPaused(budgetFile, now) {
  const b = readCache(budgetFile);
  return !!(b && b.tripUntil && now < b.tripUntil);
}
module.exports.evaluateBudget = evaluateBudget;
module.exports.isPaused = isPaused;
module.exports.sessionKey = sessionKey;

// ─── line-4 dispatcher ────────────────────────────────────────────────────
function renderLine4(cfg, soul, ctx, now) {
  const emoji = EMOJI[cfg.animal] || EMOJI.squirrel;
  if (cfg.mode === "off") {
    if (!ctx.hasConfig) return `${DIM}${emoji} · /animal to pick a companion${RESET}`;
    return emoji;
  }
  if (!soul) return emoji; // soul file missing → degrade gracefully
  let text = null;
  if (cfg.mode === "react") {
    const c = ctx.cache;
    if (c && c.comment && now - c.ts < IDLE_AFTER_MS) text = c.comment;
    else if (ctx.paused) return `${DIM}${truncate(`${emoji} ~ resting (burst cap — back soon)`, ctx.cols)}${RESET}`;
    else text = pickAmbient(soul, now);
  } else {
    text = pickCanned(soul, ctx, now);
  }
  return text ? truncate(`${emoji} ~ ${text}`, ctx.cols) : emoji;
}
module.exports.renderLine4 = renderLine4;

// ─── main ──────────────────────────────────────────────────────────────────
function main() {
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(raw); } catch { /* render with defaults */ }

  const cols = parseInt(process.env.COLUMNS || "", 10) || 120;
  const barW = cols < 90 ? 12 : 20;

  // — Animal companion setup (render is READ-ONLY: it never spawns a generation) —
  const cfgFile = CONFIG_FILE();
  const hasConfig = fs.existsSync(cfgFile);
  const cfg = loadConfig(cfgFile);
  let soul = null;
  try { soul = cfg.mode === "off" ? null : parseSoul(fs.readFileSync(SOUL_FILE(cfg.animal), "utf8")); } catch {}
  const nowMs = Date.now();
  const line4 = (hasRepo, dirty) => renderLine4(cfg, soul, {
    hasConfig, hasRepo, dirty,
    contextPct: (d.context_window && d.context_window.used_percentage) || 0,
    cols,
    cache: cfg.mode === "react" ? readCache(CACHE_FILE(d.session_id)) : null,
    paused: cfg.mode === "react" ? isPaused(BUDGET_FILE(), nowMs) : false,
  }, nowMs);

  // — Line 1 (session): model · effort · context bar · lines changed —
  const model = (d.model && d.model.display_name) || "Claude";
  let head = `${ORANGE}⏺${RESET}  ${BOLD}${WHITE}${model}${RESET}`;
  const effort = d.effort && d.effort.level;
  if (effort) head += ` ${VIOLET}✦ ${effort}${RESET}`;
  else if (d.thinking && d.thinking.enabled) head += ` ${VIOLET}✦ thinking${RESET}`;

  const cw = d.context_window || {};
  let ctxSeg;
  if (cw.used_percentage != null) {
    const pct = cw.used_percentage;
    const used = (cw.total_input_tokens || 0) + (cw.total_output_tokens || 0);
    ctxSeg = `${bar(pct, barW)} ${pctColor(pct)}${pct}%${RESET}` +
      `${sep}${DIM}${fmtTokens(used)}/${fmtTokens(cw.context_window_size)}${RESET}`;
  } else {
    ctxSeg = `${bar(0, barW)} ${DIM}—${RESET}`;
  }

  const cost = d.cost || {};
  const la = cost.total_lines_added || 0, lr = cost.total_lines_removed || 0;
  const diffSeg = (la || lr) ? `${bigSep}${GREEN}+${la}${RESET} ${RED}−${lr}${RESET}` : "";

  console.log(`${head}  ${ctxSeg}${diffSeg}`);

  // — Line 2 (limits): 5h/7d usage · pace arrow · reset countdown —
  const rl = d.rate_limits || {};
  const limitSegs = [
    limitSeg("5h", rl.five_hour, 5 * 3600),
    limitSeg("7d", rl.seven_day, 7 * 86400),
  ].filter(Boolean);
  if (limitSegs.length) console.log(`${DIM}◷${RESET} ` + limitSegs.join(bigSep));

  // — Line 3 (git): 📁 launch root [▸ current repo] : branch · dirty · ahead/behind · sync · remote · PR —
  const basename = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const cwd = (d.workspace && d.workspace.current_dir) || d.cwd || process.cwd();
  const launchDir = (d.workspace && d.workspace.project_dir) || cwd;
  const pal = ROOT_PALETTES.find((p) => p.match.test(launchDir));
  const folderDisp = pal ? shimmer(basename(launchDir), pal.c1, pal.c2) : `${BLUE}${basename(launchDir)}${RESET}`;
  const g = gitInfo(cwd);

  // where the session actually is, when it differs from the launch root
  let hereSeg = "";
  const topLevel = g ? git("rev-parse --show-toplevel", cwd) : cwd;
  if (topLevel && norm(topLevel) !== norm(launchDir)) {
    hereSeg = ` ${FAINT}▸${RESET} ${WHITE}${basename(topLevel)}${RESET}`;
  }

  if (!g) {
    if (cfg.mode === "react" && d.transcript_path) maybeSpawnGenerator(d.transcript_path);
    console.log(`📁  ${folderDisp}${hereSeg}${sep}${DIM}no repo${RESET}`);
    console.log(line4(false, 0));
    return;
  }

  const branch = g.branch === "(detached)" ? (git("rev-parse --short HEAD", cwd) || "detached") : g.branch;
  const isDefault = branch === "master" || branch === "main";
  const branchCol = isDefault ? WHITE : YELLOW;
  let line3 = `📁  ${folderDisp}${hereSeg} ${FAINT}:${RESET} ${branchCol}${branch}${RESET}`;

  if (g.dirty > 0) line3 += `${sep}${YELLOW}✚ ${g.dirty}${RESET}`;

  const origin = parseRemote(git("config --get remote.origin.url", cwd));

  if (!g.upstream) {
    line3 += `${sep}${origin ? `${YELLOW}unpushed branch${RESET}` : `${DIM}local only${RESET}`}`;
  } else {
    const fly = [];
    if (g.ahead > 0) fly.push(`${YELLOW}⇡${g.ahead}${RESET}`);
    if (g.behind > 0) fly.push(`${RED}⇣${g.behind}${RESET}`);
    if (fly.length) line3 += sep + fly.join(" ");
    else if (g.dirty === 0) line3 += `${sep}${GREEN}✓ synced${RESET}`;
    if (g.syncAge) line3 += `${sep}${DIM}↻ ${g.syncAge}${RESET}`;
  }
  if (origin) line3 += `${sep}${FAINT}${origin.host === "github.com" ? "gh" : origin.host}:${origin.owner}/${origin.name}${RESET}`;

  if (d.pr && d.pr.number) {
    const prCol = { approved: GREEN, pending: YELLOW, changes_requested: RED, draft: DIM }[d.pr.review_state] || DIM;
    const prState = d.pr.review_state ? " " + d.pr.review_state.replace(/_/g, " ") : "";
    line3 += `${sep}${prCol}PR #${d.pr.number}${prState}${RESET}`;
  }

  console.log(line3);

  // — Line 4: animal companion (generation is driven by the UserPromptSubmit hook, never from render) —
  console.log(line4(true, g.dirty));
});
}

function loadConfig(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      mode: MODES.includes(c.mode) ? c.mode : "off",
      animal: ANIMALS.includes(c.animal) ? c.animal : "squirrel",
    };
  } catch {
    return { mode: "off", animal: "squirrel" };
  }
}
module.exports.loadConfig = loadConfig;

// ─── hybrid line-selection cadence ────────────────────────────────────────
function pickAmbient(soul, now) {
  const list = soul.ambient.length ? soul.ambient : soul.work;
  if (!list.length) return null;
  return list[Math.floor(now / AMBIENT_EVERY_MS) % list.length];
}
function pickCanned(soul, ctx, now) {
  const notable = (ctx.hasRepo && ctx.dirty > 0) || ctx.contextPct >= 70;
  const list = notable && soul.work.length ? soul.work
    : soul.ambient.length ? soul.ambient : soul.work;
  if (!list.length) return null;
  return list[Math.floor(now / AMBIENT_EVERY_MS) % list.length];
}
function truncate(text, cols) {
  const max = Math.max(8, (cols || 120) - 4);
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
module.exports.pickAmbient = pickAmbient;
module.exports.pickCanned = pickCanned;
module.exports.truncate = truncate;

// ─── react mode generator ─────────────────────────────────────────────────

function buildGenArgs(sysPromptFile) {
  return [
    "-p", "--safe-mode", "--no-session-persistence",
    "--model", "haiku", "--system-prompt-file", sysPromptFile,
  ];
}
module.exports.buildGenArgs = buildGenArgs;

// Runs in the detached --gen child: generate one comment, write the cache, exit.
// Cross-platform-safe: multi-line soul via a temp file; user prompt via stdin — never a shell arg.
function generate() {
  let sysFile;
  const session = process.env.SOUL_SESSION || "default";
  const cacheFile = CACHE_FILE(session);
  try {
    const cfg = loadConfig(CONFIG_FILE());
    if (cfg.mode !== "react") return;
    const prompt = (process.env.SOUL_PROMPT || latestUserPrompt(process.env.SOUL_TRANSCRIPT || "") || "").slice(0, PROMPT_MAX);
    if (!prompt.trim()) return;

    // per-session dedup: this prompt was already commented on → nothing to do
    const prev = readCache(cacheFile);
    if (prev && prev.comment && prev.promptHash === promptHash(prompt)) return;

    // circuit breaker: machine-wide burst cap — a runaway can never drain the rate limit
    const decision = evaluateBudget(readCache(BUDGET_FILE()), Date.now());
    writeCache(BUDGET_FILE(), decision.budget);
    if (!decision.allowed) return; // tripped or cooling down → no model call

    const soul = parseSoul(fs.readFileSync(SOUL_FILE(cfg.animal), "utf8"));
    sysFile = path.join(os.tmpdir(), `soul-sys-${process.pid}.txt`);
    fs.writeFileSync(sysFile, soul.react || "Reply with ONE short witty line (<= 80 chars).");
    const { execFileSync } = require("node:child_process");
    const out = execFileSync("claude", buildGenArgs(sysFile), {
      input: prompt,
      timeout: 20000, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
      shell: process.platform === "win32", windowsHide: true,
      // recursion guard: our own `claude -p` must NOT re-trigger the UserPromptSubmit hook
      env: { ...process.env, CLAUDE_SOUL_GEN: "1" },
    }).trim();
    const comment = (out.split("\n").filter(Boolean).pop() || "").trim();
    writeCache(cacheFile, { comment, ts: Date.now(), promptHash: promptHash(prompt) });
    pruneStaleCaches();
  } catch {
    /* never throw from a background generation */
  } finally {
    try { if (sysFile) fs.unlinkSync(sysFile); } catch {}
  }
}

// Remove per-session cache files whose sessions have been idle > 24h, so they never accumulate.
function pruneStaleCaches() {
  try {
    const dir = claudeDir(), now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      if (!/^statusline-soul\..+\.cache\.json$/.test(f)) continue;
      const p = path.join(dir, f);
      try { if (now - fs.statSync(p).mtimeMs > 24 * 3600_000) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

// Runs as the UserPromptSubmit hook: fire ONE detached generation for THIS prompt, then exit 0.
// Must be fast and silent — Claude waits for it, and any stdout would be injected into context.
function hook() {
  if (process.env.CLAUDE_SOUL_GEN) return process.exit(0);      // recursion guard: never react to our own claude -p
  if (loadConfig(CONFIG_FILE()).mode !== "react") return process.exit(0); // fast bail when off/canned
  let raw = "";
  const done = () => {
    try {
      let j = {}; try { j = JSON.parse(raw); } catch {}
      const prompt = String(j.prompt || "").slice(0, PROMPT_MAX);
      if (prompt.trim()) {
        const { spawn } = require("node:child_process");
        spawn(process.execPath, [__filename, "--gen"], {
          detached: true, windowsHide: true, stdio: "ignore",
          env: { ...process.env, SOUL_SESSION: j.session_id || "default", SOUL_PROMPT: prompt },
        }).unref();
      }
    } catch {}
    process.exit(0);
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", done);
  setTimeout(() => process.exit(0), 2000).unref(); // safety: never hang the prompt
}
module.exports.hook = hook;

if (require.main === module) {
  if (process.argv.includes("--gen")) generate();
  else if (process.argv.includes("--hook")) hook();
  else main();
}
