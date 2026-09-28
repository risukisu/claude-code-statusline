#!/usr/bin/env node
/**
 * Claude Code status line — a micro terminal dashboard.
 * https://github.com/risukisu/claude-code-statusline
 *
 * Renders four lines from the JSON Claude Code pipes to a status-line command
 * (no network, no model calls — just the stdin payload and a few local git reads):
 *
 *   Line 1 (session):   ⏺  Model ✦ effort  ▕████████░░░░▏ 42% · 420k/1M  │  +156 −23
 *   Line 2 (limits):    ◷ 5h ▕█████│███░░▏ 80% · 2h30m left  │  7d ▕██░░░│░░░░░▏ 20% · 3d12h left
 *   Line 3 (git):       📁  LaunchRoot ▸ repo : branch · ✚ 3 · ⇡2 ⇣1 · ↻ 3h ago · gh:owner/name · PR #12 pending
 *   Line 4 (companion): ╰─ 🦊 a hand-written line for what's going on (optional, off by default)
 *
 * Context bar (line 1): the heat runs blue → amber → orange at the warn line (40%) → red
 * from the danger line (50%), where a /compact hint appears. Limit bars (line 2): the fill
 * is how much of the window you've used, the │ notch is how much of its time has passed,
 * and fill past the notch is overspend. Line 3 leads with the LAUNCH folder
 * (workspace.project_dir), shimmering in its workspace colours; when the session has cd'd
 * into a different repo, a ▸ shows it and the git details describe the repo you're in.
 *
 * Settings live in ~/.claude/statusline.json (all optional): theme, links, quiet, context
 * thresholds, workspace palettes, hidden segments, bar width. See the README.
 *
 * Install: save to ~/.claude/statusline.js and register in ~/.claude/settings.json:
 *   "statusLine": { "type": "command", "command": "node ~/.claude/statusline.js", "refreshInterval": 10 }
 *   (Windows: use the full path, e.g. node C:/Users/<you>/.claude/statusline.js)
 *   refreshInterval is in SECONDS and runs IN ADDITION to event-driven renders (which
 *   fire on every assistant message). Keep it ≥5: each render is a fresh node process,
 *   so a low value multiplied across open sessions is a real process-spawn cost.
 *
 * Context-bar gradient first ported from getagentseal/codeburn. MIT licensed.
 * `node statusline.js --version` prints the installed version.
 */

"use strict";
const { execSync } = require("child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VERSION = "1.1.0";
const EMOJI = { squirrel: "🐿️", fox: "🦊", turtle: "🐢" };
const ANIMALS = ["squirrel", "fox", "turtle"];
const MODES = ["off", "canned"];
const AMBIENT_EVERY_MS = 30_000;
// Render safety net. main() blocks on stdin 'end', but Claude Code cancels a
// superseded render by orphaning the process WITHOUT closing stdin, so 'end'
// may never fire — leaving the node process hung forever at 0% CPU. This caps a
// render's life so an orphan self-terminates instead of accumulating. Overridable
// via env for fast tests.
const RENDER_WATCHDOG_MS = parseInt(process.env.STATUSLINE_WATCHDOG_MS || "", 10) || 8000;

// Honor Claude Code's CLAUDE_CONFIG_DIR (falls back to ~/.claude) so config, souls
// and caches resolve to the real config dir — and tests can point it at a tmp dir.
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CONFIG_FILE = () => path.join(claudeDir(), "statusline-soul.json");
const DASH_FILE = () => path.join(claudeDir(), "statusline.json");
// Per-session cache key (session_id from the status-line stdin) so parallel sessions never
// read each other's git snapshot.
const sessionKey = (id) => (String(id || "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default");
// Per-session git snapshot cache — lets rapid successive renders skip the 4–5 git
// subprocesses. Short TTL keeps dirty/ahead-behind counts responsive.
const GIT_CACHE_FILE = (id) => path.join(claudeDir(), `statusline-git.${sessionKey(id)}.cache.json`);
const GIT_CACHE_TTL_MS = parseInt(process.env.STATUSLINE_GIT_TTL_MS || "", 10) || 3000;
const SOUL_FILE = (animal) => path.join(claudeDir(), "souls", `${animal}.md`);
const COMMAND_FILE = () => path.join(claudeDir(), "commands", "animal.md");

module.exports = { VERSION };

// ─── soul markdown parser ──────────────────────────────────────────────────
// A soul is a markdown file with one bullet list per section. `ambient` is idle chatter,
// `work` is the generic "you're busy" fallback, and the rest match one state each
// (see pickCanned). Any other `## heading` is ignored.
const NOTABLE = ["context", "limits", "behind", "dirty", "ahead"];
const CALM = ["night", "norepo", "synced", "branch"];
const SECTIONS = ["ambient", "work", ...NOTABLE, ...CALM];

function parseSoul(md) {
  const out = { voice: "", rules: "" };
  for (const name of SECTIONS) out[name] = [];
  if (typeof md !== "string") return out;
  let section = null;
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const h = line.match(/^##\s+(\w+)/);
    if (h) { section = h[1].toLowerCase(); continue; }
    const v = line.match(/^voice:\s*(.+)$/i); if (v) { out.voice = v[1].trim(); continue; }
    const r = line.match(/^rules:\s*(.+)$/i); if (r) { out.rules = r[1].trim(); continue; }
    if (SECTIONS.includes(section) && line.trim().startsWith("-")) {
      const item = line.replace(/^\s*-\s+/, "").trim();
      if (item) out[section].push(item);
    }
  }
  return out;
}
module.exports.parseSoul = parseSoul;
module.exports.SECTIONS = SECTIONS;

// ─── themes ────────────────────────────────────────────────────────────────
// Every colour the dashboard prints comes from one theme. `heat` holds the context-bar
// anchors: start, amber (¾ of warn), orange (warn), red (danger), end.
const THEMES = {
  default: {
    fg: [235, 235, 235], dim: [110, 110, 110], faint: [70, 70, 70], empty: [51, 51, 51],
    accent: [232, 116, 79], effort: [180, 142, 245], blue: [91, 158, 245],
    good: [91, 245, 140], warn: [245, 200, 91], bad: [245, 91, 91], speech: [170, 170, 170],
    heat: [[91, 158, 245], [245, 200, 91], [255, 140, 66], [245, 91, 91], [190, 40, 60]],
  },
  "high-contrast": {
    fg: [255, 255, 255], dim: [175, 175, 175], faint: [140, 140, 140], empty: [90, 90, 90],
    accent: [255, 135, 95], effort: [200, 170, 255], blue: [110, 180, 255],
    good: [80, 250, 123], warn: [255, 214, 0], bad: [255, 85, 85], speech: [215, 215, 215],
    heat: [[110, 180, 255], [255, 214, 0], [255, 150, 50], [255, 85, 85], [220, 40, 60]],
  },
  // Okabe–Ito colours: blue / yellow / vermillion stay apart for red-green colour blindness.
  colorblind: {
    fg: [235, 235, 235], dim: [110, 110, 110], faint: [70, 70, 70], empty: [51, 51, 51],
    accent: [230, 159, 0], effort: [204, 121, 167], blue: [86, 180, 233],
    good: [86, 180, 233], warn: [240, 228, 66], bad: [213, 94, 0], speech: [170, 170, 170],
    heat: [[86, 180, 233], [240, 228, 66], [230, 159, 0], [213, 94, 0], [160, 60, 0]],
  },
};
module.exports.THEMES = THEMES;

// P holds the ready-made escape codes for the active theme. With colour off every entry
// is "", so the same template strings print plain text.
const P = {};
let LINKS = true;
function setTheme(name, color = true, links = true) {
  const t = THEMES[name] || THEMES.default;
  const code = (c) => (color ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : "");
  for (const k of Object.keys(t)) if (k !== "heat") P[k] = code(t[k]);
  P.heat = t.heat;
  P.color = color;
  P.reset = color ? "\x1b[0m" : "";
  P.bold = color ? "\x1b[1m" : "";
  P.italic = color ? "\x1b[3m" : "";
  P.sep = ` ${P.faint}·${P.reset} `;
  P.bigSep = `  ${P.faint}│${P.reset}  `;
  LINKS = color && links;
}
setTheme("default");
const rgb = (r, g, b) => (P.color ? `\x1b[38;2;${r};${g};${b}m` : "");
// OSC 8 hyperlink: clickable in terminals that support it, plain text elsewhere.
const link = (url, text) => (LINKS && url ? `\x1b]8;;${url}\x07${text}\x1b]8;;\x07` : text);

// ─── fitting a line to the terminal ───────────────────────────────────────
// Terminal cells a string takes: colour and link codes take none, emoji take two.
function visibleWidth(str) {
  const t = String(str).replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of t) {
    if (ch === "\uFE0F" || ch === "\u200D") continue;
    w += /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  }
  return w;
}
module.exports.visibleWidth = visibleWidth;

// A line is a list of segments; some carry cuts, each a rank and a shorter text ("" drops
// the segment). Cuts apply lowest rank first, only until the line fits in `max` cells.
function fitSegments(segs, max) {
  const texts = segs.map((sg) => sg.text);
  const steps = [];
  segs.forEach((sg, i) => (sg.cuts || []).forEach((c) => steps.push({ i, rank: c.rank, text: c.text })));
  steps.sort((a, b) => a.rank - b.rank);
  for (const st of steps) {
    if (visibleWidth(texts.join("")) <= max) break;
    texts[st.i] = st.text;
  }
  return texts.join("");
}
module.exports.fitSegments = fitSegments;

// ─── dashboard settings: ~/.claude/statusline.json ────────────────────────
const HIDEABLE = ["effort", "tokens", "diff", "limits", "sync", "remote", "pr", "companion"];
const DEFAULT_DASH = {
  theme: "default", links: true, quiet: true, gutter: true, context: { warn: 40, danger: 50 },
  palettes: null, hide: [], barWidth: null,
};
module.exports.DEFAULT_DASH = DEFAULT_DASH;

const hexRGB = (h) => {
  const m = typeof h === "string" && h.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};
const normPath = (p) => String(p).replace(/\\/g, "/").toLowerCase();

function loadDashConfig(file) {
  const out = JSON.parse(JSON.stringify(DEFAULT_DASH));
  let c;
  try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return out; }
  if (!c || typeof c !== "object") return out;
  if (THEMES[c.theme]) out.theme = c.theme;
  if (typeof c.links === "boolean") out.links = c.links;
  if (typeof c.quiet === "boolean") out.quiet = c.quiet;
  if (typeof c.gutter === "boolean") out.gutter = c.gutter;
  const cx = c.context || {};
  const ok = (n) => Number.isFinite(n) && n > 0 && n <= 100;
  if (ok(cx.warn) && ok(cx.danger) && cx.warn < cx.danger) out.context = { warn: cx.warn, danger: cx.danger };
  if (Array.isArray(c.hide)) out.hide = c.hide.filter((h) => HIDEABLE.includes(h));
  if (Number.isInteger(c.barWidth) && c.barWidth >= 4 && c.barWidth <= 40) out.barWidth = c.barWidth;
  if (Array.isArray(c.palettes)) {
    out.palettes = c.palettes.map((p) => {
      const c1 = hexRGB(p && p.from), c2 = hexRGB(p && p.to);
      const match = p && typeof p.match === "string" ? normPath(p.match) : "";
      return match && c1 && c2 ? { test: (dir) => normPath(dir).includes(match), c1, c2 } : null;
    }).filter(Boolean);
  }
  return out;
}
module.exports.loadDashConfig = loadDashConfig;

// ─── context heat bar ─────────────────────────────────────────────────────
// Front-loaded on purpose: answers get worse long before the window is full, so the
// red arrives at the danger line (50% by default), not at the end.
function heatRGB(pos, warn, danger, stops = THEMES.default.heat) {
  const at = [0, (warn * 0.75) / 100, warn / 100, danger / 100, 1];
  const p = Math.max(0, Math.min(1, pos));
  let i = 0;
  while (i < at.length - 2 && p > at[i + 1]) i++;
  const t = at[i + 1] === at[i] ? 1 : (p - at[i]) / (at[i + 1] - at[i]);
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * t));
}
module.exports.heatRGB = heatRGB;

function heatBar(pctUsed, width, warn, danger) {
  const filled = Math.max(0, Math.min(width, Math.round((pctUsed / 100) * width)));
  let out = "";
  for (let i = 0; i < filled; i++) out += rgb(...heatRGB(i / width, warn, danger, P.heat)) + "█";
  out += P.empty + "░".repeat(width - filled);
  return `${P.faint}▕${out}${P.reset}${P.faint}▏${P.reset}`;
}

function pctColor(p) {
  return p >= 80 ? P.bad : p >= 50 ? P.warn : P.good;
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

// ─── git (short timeouts, never throws) ───────────────────────────────────
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

// One-shot git read: everything line 3 needs, in ≤4 subprocess calls. Cached per
// session so most renders reuse it instead of re-shelling out. `g` is null off-repo.
function computeGitSnapshot(cwd) {
  const g = gitInfo(cwd);
  const topLevel = g ? git("rev-parse --show-toplevel", cwd) : cwd;
  const branch = g
    ? (g.branch === "(detached)" ? (git("rev-parse --short HEAD", cwd) || "detached") : g.branch)
    : null;
  const originUrl = g ? git("config --get remote.origin.url", cwd) : null;
  return { g, topLevel, branch, originUrl };
}
module.exports.computeGitSnapshot = computeGitSnapshot;

// ─── workspace-identity shimmer (port of feedback-shimmer.ps1) ─────────────
// CSS stops: 0% c1 -> 40% c2 -> 60% c1 -> 100% c2, phase sweeps a full
// cycle every 3s of wall clock — each status line refresh shows the next frame.
// Built-in palettes; `palettes` in ~/.claude/statusline.json replaces them.
const ROOT_PALETTES = [
  { match: /^[a-z]:[\\/]+ai_workspace_personal/i, c1: [6, 182, 212], c2: [74, 222, 128] },   // cyan → mint
  { match: /^[a-z]:[\\/]+ai_workspace_appsilon/i, c1: [245, 158, 11], c2: [253, 230, 138] }, // amber → gold
].map((p) => ({ test: (dir) => p.match.test(dir), c1: p.c1, c2: p.c2 }));

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
  return out + P.reset;
}

// ─── origin remote of the CURRENT dir (not the session's launch repo) ──────
// Only host/owner/name are kept, so credentials in an https remote never reach the screen.
function parseRemote(url) {
  if (!url) return null;
  const m = url.match(/(?:@|:\/\/)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { host: m[1], owner: m[2], name: m[3] } : null;
}

// ─── rate-limit windows: usage bar with a clock notch, reset countdown ────
// Pace = % of the window used minus % of the window's time elapsed. Positive = burning fast.
function windowPace(win, windowLen) {
  if (!win || win.used_percentage == null || !win.resets_at) return null;
  const remaining = win.resets_at - Math.floor(Date.now() / 1000);
  if (remaining <= 0 || remaining > windowLen) return null;
  const elapsedPct = (1 - remaining / windowLen) * 100;
  return { delta: Math.round(win.used_percentage - elapsedPct), elapsedPct, remaining };
}

// The cells of a limit bar: "fill" (used, within pace), "over" (used past the notch),
// "empty", and one "notch" where the clock is. No reset time → no notch.
function limitCells(usedPct, elapsedPct, width) {
  const clamp = (n) => Math.max(0, Math.min(width, Math.round((n / 100) * width)));
  const filled = clamp(usedPct);
  const notch = elapsedPct == null ? null : clamp(elapsedPct);
  const out = [];
  for (let i = 0; i < width; i++) {
    if (i === notch) out.push("notch");
    out.push(i < filled ? (notch != null && i >= notch ? "over" : "fill") : "empty");
  }
  if (notch === width) out.push("notch");
  return out;
}
module.exports.limitCells = limitCells;

function limitParts(label, win, windowLen, width, quiet) {
  if (!win || win.used_percentage == null) return null;
  const p = Math.round(win.used_percentage);
  const pace = windowPace(win, windowLen);
  const cells = limitCells(win.used_percentage, pace ? pace.elapsedPct : null, width);
  const fillCol = p >= 50 ? P.warn : P.good; // tops out at amber, so only overspend is red
  const glyph ={ fill: `${fillCol}█`, over: `${P.bad}█`, empty: `${P.empty}░`, notch: `${P.fg}│` };
  const barStr = `${P.faint}▕${cells.map((c) => glyph[c]).join("")}${P.reset}${P.faint}▏${P.reset}`;
  const calm = quiet && p < 50 && !cells.includes("over");
  return {
    main: `${P.dim}${label}${P.reset} ${barStr} ${calm ? P.dim : pctColor(p)}${p}%${P.reset}`,
    left: pace ? `${P.sep}${P.dim}${fmtDur(pace.remaining)} left${P.reset}` : "",
  };
}

// ─── cache I/O (git snapshot) ─────────────────────────────────────────────
function readCache(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeCache(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch {
    // Never throw from the status line, and don't leave the temp file behind either
    // (on Windows the rename fails while another render has the target open).
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Sweep this project's own leftovers: git snapshots from sessions idle for a day, and
// temp files a killed write never renamed. Matches nothing but statusline-git.* caches.
const CACHE_NAME = /^statusline-git\.[A-Za-z0-9_-]{1,64}\.cache\.json(\.\d+\.tmp)?$/;
const CACHE_MAX_AGE_MS = 24 * 3600_000;
const TMP_MAX_AGE_MS = 60_000;
function pruneStaleCaches(dir, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const m = name.match(CACHE_NAME);
    if (!m) continue;
    const file = path.join(dir, name);
    try {
      const age = now - fs.statSync(file).mtimeMs;
      if (age > (m[1] ? TMP_MAX_AGE_MS : CACHE_MAX_AGE_MS)) fs.unlinkSync(file);
    } catch { /* another render got there first */ }
  }
}
module.exports.pruneStaleCaches = pruneStaleCaches;
// A per-session git snapshot may be reused only if it is for the same directory
// (never show the wrong repo after a cd) and younger than the TTL. Renders that
// hit a fresh cache skip all 4–5 git subprocesses.
function gitCacheFresh(cache, cwd, now, ttlMs) {
  return !!(cache && cache.cwd === cwd && typeof cache.gitTs === "number" && now - cache.gitTs < ttlMs);
}
module.exports.readCache = readCache;
module.exports.writeCache = writeCache;
module.exports.gitCacheFresh = gitCacheFresh;

module.exports.sessionKey = sessionKey;

// ─── line-4 dispatcher ────────────────────────────────────────────────────
// The companion speaks under line 3: a ╰─ connector, the animal, and its line in italics,
// so it reads as speech rather than one more readout.
function renderLine4(cfg, soul, ctx, now) {
  const emoji = EMOJI[cfg.animal] || EMOJI.squirrel;
  if (cfg.mode === "off") {
    if (!ctx.hasConfig) {
      // Only advertise /animal when the command is actually installed — a statusline-only
      // install must not nudge toward a command that doesn't exist.
      return ctx.hasCommand
        ? `${P.dim}${truncate(`${emoji} · restart Claude Code, then /animal to pick a companion`, ctx.cols)}${P.reset}`
        : emoji;
    }
    return emoji;
  }
  if (!soul) return emoji; // soul file missing → degrade gracefully
  const text = pickCanned(soul, ctx, now); // hand-written lines only — never a model call
  if (!text) return emoji;
  return `${P.faint}╰─${P.reset} ${emoji} ${P.italic}${P.speech}${truncate(text, (ctx.cols || 120) - 6)}${P.reset}`;
}
module.exports.renderLine4 = renderLine4;

// ─── main ──────────────────────────────────────────────────────────────────
function main() {
let raw = "";
// Never hang: if stdin never delivers EOF (cancelled/orphaned render), self-exit.
const watchdog = setTimeout(() => process.exit(0), RENDER_WATCHDOG_MS);
watchdog.unref();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("error", () => process.exit(0)); // broken pipe → don't linger
process.stdin.on("end", () => {
  clearTimeout(watchdog);
  let d = {};
  try { d = JSON.parse(raw); } catch { /* render with defaults */ }

  const dash = loadDashConfig(DASH_FILE());
  setTheme(dash.theme, !process.env.NO_COLOR, dash.links);
  const hidden = new Set(dash.hide);
  const { warn, danger } = dash.context;

  const cols = parseInt(process.env.COLUMNS || "", 10) || 120;
  const barW = dash.barWidth || (cols < 90 ? 12 : 20);
  const limitW = cols < 90 ? 6 : 10;

  // — Animal companion setup (canned lines only: no model calls, no transcript reads) —
  const cfgFile = CONFIG_FILE();
  const hasConfig = fs.existsSync(cfgFile);
  const hasCommand = fs.existsSync(COMMAND_FILE());
  const cfg = loadConfig(cfgFile);
  let soul = null;
  try { soul = cfg.mode === "off" ? null : parseSoul(fs.readFileSync(SOUL_FILE(cfg.animal), "utf8")); } catch {}
  const nowMs = Date.now();
  const five = (d.rate_limits || {}).five_hour;
  const fivePace = windowPace(five, 5 * 3600);

  // Lines are collected, fitted to the width Claude Code reports, then printed with the
  // gutter. Claude Code keeps a small margin of its own, hence the 2 spare cells.
  const out = [];
  const gutterW = dash.gutter ? 2 : 0;
  const room = cols - 2 - gutterW;
  let pal = null;
  const emit = () => {
    const theme = THEMES[dash.theme] || THEMES.default;
    out.forEach((line, i) => {
      if (!dash.gutter) return console.log(line);
      const t = out.length > 1 ? i / (out.length - 1) : 0;
      const c = pal ? pal.c1.map((v, k) => Math.round(v + (pal.c2[k] - v) * t)) : theme.blue;
      console.log(`${rgb(...c)}▌${P.reset} ${line}`);
    });
  };
  const line4 = (git) => {
    if (hidden.has("companion")) return;
    out.push(renderLine4(cfg, soul, {
      hasConfig, hasCommand, cols: cols - gutterW,
      ...git,
      contextPct: (d.context_window && d.context_window.used_percentage) || 0,
      ctxDanger: danger,
      limitPct: five && five.used_percentage != null ? five.used_percentage : null,
      pace: fivePace ? fivePace.delta : null,
      hour: new Date(nowMs).getHours(),
    }, nowMs));
  };

  // — Line 1 (session): model · effort · context bar · lines changed —
  // Narrow terminal: drop the token count, then the diff, then the effort.
  const model = (d.model && d.model.display_name) || "Claude";
  const l1 = [{ text: `${P.accent}⏺${P.reset}  ${P.bold}${P.fg}${model}${P.reset}` }];
  const effort = (d.effort && d.effort.level) || (d.thinking && d.thinking.enabled ? "thinking" : null);
  if (effort && !hidden.has("effort")) l1.push({ text: ` ${P.effort}✦ ${effort}${P.reset}`, cuts: [{ rank: 3, text: "" }] });

  const cw = d.context_window || {};
  if (cw.used_percentage != null) {
    const pct = Math.round(cw.used_percentage);
    const used = (cw.total_input_tokens || 0) + (cw.total_output_tokens || 0);
    const pctCol = pct >= danger ? P.bad + P.bold : pct >= warn ? P.warn : dash.quiet ? P.dim : P.good;
    l1.push({ text: `  ${heatBar(pct, barW, warn, danger)} ${pctCol}${pct}%${P.reset}` });
    if (!hidden.has("tokens")) {
      l1.push({ text: `${P.sep}${P.dim}${fmtTokens(used)}/${fmtTokens(cw.context_window_size)}${P.reset}`, cuts: [{ rank: 1, text: "" }] });
    }
    if (pct >= danger) l1.push({ text: `${P.sep}${P.bad}⚠ /compact${P.reset}` });
  } else {
    l1.push({ text: `  ${heatBar(0, barW, warn, danger)} ${P.dim}—${P.reset}` });
  }

  const cost = d.cost || {};
  const la = cost.total_lines_added || 0, lr = cost.total_lines_removed || 0;
  if ((la || lr) && !hidden.has("diff")) {
    l1.push({ text: `${P.bigSep}${P.good}+${la}${P.reset} ${P.bad}−${lr}${P.reset}`, cuts: [{ rank: 2, text: "" }] });
  }
  out.push(fitSegments(l1, room));

  // — Line 2 (limits): usage bar with a clock notch · % · reset countdown —
  // Narrow terminal: drop the 7d countdown, then the 5h countdown, then the 7d window.
  const rl = d.rate_limits || {};
  if (!hidden.has("limits")) {
    const p5 = limitParts("5h", rl.five_hour, 5 * 3600, limitW, dash.quiet);
    const p7 = limitParts("7d", rl.seven_day, 7 * 86400, limitW, dash.quiet);
    const l2 = [{ text: `${P.dim}◷${P.reset} ` }];
    if (p5) {
      l2.push({ text: p5.main });
      if (p5.left) l2.push({ text: p5.left, cuts: [{ rank: 2, text: "" }] });
    }
    if (p7) {
      l2.push({ text: (p5 ? P.bigSep : "") + p7.main, cuts: p5 ? [{ rank: 3, text: "" }] : [] });
      if (p7.left) l2.push({ text: p7.left, cuts: [{ rank: 1, text: "" }] });
    }
    if (p5 || p7) out.push(fitSegments(l2, room));
  }

  // — Line 3 (git): 📁 launch root [▸ current repo] : branch · dirty · ahead/behind · sync · remote · PR —
  // Narrow terminal: drop the remote, then the sync age, then the PR's review words, then
  // the ▸ repo name, then the PR. Branch, changes, and ahead/behind always stay.
  const basename = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const cwd = (d.workspace && d.workspace.current_dir) || d.cwd || process.cwd();
  const launchDir = (d.workspace && d.workspace.project_dir) || cwd;
  pal = (dash.palettes || ROOT_PALETTES).find((p) => p.test(launchDir)) || null;
  const folderDisp = pal ? shimmer(basename(launchDir), pal.c1, pal.c2) : `${P.blue}${basename(launchDir)}${P.reset}`;
  // Per-session git cache: reuse a fresh snapshot, else read git once and store it.
  const gitCacheFile = GIT_CACHE_FILE(d.session_id);
  let snap = readCache(gitCacheFile);
  if (!snap) pruneStaleCaches(claudeDir(), nowMs); // a session's first render tidies up after old ones
  if (!gitCacheFresh(snap, cwd, nowMs, GIT_CACHE_TTL_MS)) {
    const sn = computeGitSnapshot(cwd);
    snap = { cwd, gitTs: nowMs, g: sn.g, topLevel: sn.topLevel, branch: sn.branch, originUrl: sn.originUrl };
    writeCache(gitCacheFile, snap);
  }
  const g = snap.g;
  const topLevel = snap.topLevel;

  const l3 = [{ text: `📁  ${folderDisp}` }];
  // where the session actually is, when it differs from the launch root
  if (topLevel && norm(topLevel) !== norm(launchDir)) {
    l3.push({ text: ` ${P.faint}▸${P.reset} ${P.fg}${basename(topLevel)}${P.reset}`, cuts: [{ rank: 4, text: "" }] });
  }

  if (!g) {
    l3.push({ text: `${P.sep}${P.dim}no repo${P.reset}` });
    out.push(fitSegments(l3, room));
    line4({ hasRepo: false, dirty: 0 });
    emit();
    return;
  }

  const branch = snap.branch;
  const isDefault = branch === "master" || branch === "main";
  l3.push({ text: ` ${P.faint}:${P.reset} ${isDefault ? P.fg : P.warn}${branch}${P.reset}` });
  if (g.dirty > 0) l3.push({ text: `${P.sep}${P.warn}✚ ${g.dirty}${P.reset}` });

  const origin = parseRemote(snap.originUrl);
  if (!g.upstream) {
    l3.push({ text: `${P.sep}${origin ? `${P.warn}unpushed branch${P.reset}` : `${P.dim}local only${P.reset}`}` });
  } else {
    const fly = [];
    if (g.ahead > 0) fly.push(`${P.warn}⇡${g.ahead}${P.reset}`);
    if (g.behind > 0) fly.push(`${P.bad}⇣${g.behind}${P.reset}`);
    if (fly.length) l3.push({ text: P.sep + fly.join(" ") });
    else if (g.dirty === 0) l3.push({ text: `${P.sep}${dash.quiet ? P.dim : P.good}✓ synced${P.reset}` });
    if (g.syncAge && !hidden.has("sync")) l3.push({ text: `${P.sep}${P.dim}↻ ${g.syncAge}${P.reset}`, cuts: [{ rank: 2, text: "" }] });
  }
  if (origin && !hidden.has("remote")) {
    const label = `${origin.host === "github.com" ? "gh" : origin.host}:${origin.owner}/${origin.name}`;
    l3.push({
      text: `${P.sep}${P.faint}${link(`https://${origin.host}/${origin.owner}/${origin.name}`, label)}${P.reset}`,
      cuts: [{ rank: 1, text: "" }],
    });
  }

  if (d.pr && d.pr.number && !hidden.has("pr")) {
    const prCol = { approved: P.good, pending: P.warn, changes_requested: P.bad, draft: P.dim }[d.pr.review_state] || P.dim;
    const prState = d.pr.review_state ? " " + d.pr.review_state.replace(/_/g, " ") : "";
    const label = d.pr.kind === "mr" ? `MR !${d.pr.number}` : `PR #${d.pr.number}`;
    const pr = (text) => `${P.sep}${prCol}${link(d.pr.url, text)}${P.reset}`;
    l3.push({ text: pr(label + prState), cuts: [{ rank: 3, text: pr(label) }, { rank: 5, text: "" }] });
  }
  out.push(fitSegments(l3, room));

  // — Line 4: animal companion (canned lines; no model call) —
  line4({
    hasRepo: true, dirty: g.dirty, ahead: g.ahead, behind: g.behind,
    upstream: !!g.upstream, branch,
  });
  emit();
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

// ─── line selection ───────────────────────────────────────────────────────
// Placeholders: {dirty} {ahead} {behind} {ctx} {limit} {branch}; {key:noun} adds a count
// with a plural ("{dirty:file}" → "1 file" / "3 files"). A line whose placeholder has no
// value, or names an unknown key, is skipped rather than shown half-filled.
const PLACEHOLDERS = ["dirty", "ahead", "behind", "ctx", "limit", "branch"];
function fillLine(line, vals) {
  let ok = true;
  const out = line.replace(/\{([a-z]+)(?::([a-z]+))?\}/g, (_, key, noun) => {
    const v = PLACEHOLDERS.includes(key) ? vals[key] : null;
    if (v == null || v === "") { ok = false; return ""; }
    return noun ? `${v} ${noun}${v === 1 ? "" : "s"}` : String(v);
  });
  return ok ? out : null;
}
module.exports.fillLine = fillLine;

// Which states hold right now, each list in priority order. Context speaks from the
// danger line (ctxDanger, 50% by default) — the same point the bar turns red.
function activeStates(ctx) {
  const on = {
    context: ctx.contextPct >= (ctx.ctxDanger || DEFAULT_DASH.context.danger),
    limits: ctx.limitPct >= 80 || ctx.pace >= 15,
    behind: ctx.hasRepo && ctx.behind > 0,
    dirty: ctx.hasRepo && ctx.dirty > 0,
    ahead: ctx.hasRepo && ctx.ahead > 0,
    night: ctx.hour != null && ctx.hour < 5,
    norepo: !ctx.hasRepo,
    synced: ctx.hasRepo && !!ctx.upstream && !ctx.dirty && !ctx.ahead && !ctx.behind,
    branch: ctx.hasRepo && !!ctx.branch && ctx.branch !== "main" && ctx.branch !== "master",
  };
  return { notable: NOTABLE.filter((n) => on[n]), calm: CALM.filter((n) => on[n]) };
}

// One slot = AMBIENT_EVERY_MS of wall clock. Busy (a notable state holds): two slots in
// three go to the notable states in turn, plus the generic `work` lines, which also stand
// in for a state the soul has no section for; every third slot goes to ambient so the
// character still shows. Otherwise the calm states that hold take turns with ambient.
function pickCanned(soul, ctx, now) {
  const vals = {
    dirty: ctx.dirty, ahead: ctx.ahead, behind: ctx.behind, branch: ctx.branch,
    ctx: ctx.contextPct != null ? Math.round(ctx.contextPct) : null,
    limit: ctx.limitPct != null ? Math.round(ctx.limitPct) : null,
  };
  const lines = (name) => (soul[name] || []).map((l) => fillLine(l, vals)).filter((l) => l != null);
  const ambient = lines("ambient").length ? lines("ambient") : lines("work");
  const slot = Math.floor(now / AMBIENT_EVERY_MS);
  const { notable, calm } = activeStates(ctx);

  const busy = notable.length
    ? [...new Set([...notable.map((n) => (lines(n).length ? n : "work")), "work"])].map(lines).filter((p) => p.length)
    : [];
  let pools, k;
  if (busy.length) {
    if (slot % 3 === 2 && ambient.length) return ambient[Math.floor(slot / 3) % ambient.length];
    pools = busy;
    k = slot - Math.floor(slot / 3); // counts only the busy slots
  } else {
    pools = [...calm.map(lines), ambient].filter((p) => p.length);
    k = slot;
  }
  if (!pools.length) return null;
  const pool = pools[k % pools.length];
  return pool[Math.floor(k / pools.length) % pool.length];
}
function truncate(text, cols) {
  const max = Math.max(8, (cols || 120) - 4);
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
module.exports.pickCanned = pickCanned;
module.exports.truncate = truncate;

// ─── entry point ──────────────────────────────────────────────────────────
// Claude Code runs the status line with no arguments. `--version` prints the version; any
// other argument exits silently, so a stale hook entry from an older install can never
// paste status lines into a conversation (hook output is injected into Claude's context).
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`claude-code-statusline ${VERSION}`);
    process.exit(0);
  }
  if (args.length) process.exit(0);
  main();
}
