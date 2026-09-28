#!/usr/bin/env node
// Builds the README visuals from the status line's REAL output.
//
//   node assets/readme/source/build.js            → hero.svg + companions.svg
//   node assets/readme/source/build.js --frames D → also writes the GIF frames (SVG) into D
//
// Each render runs statusline.js in a throwaway CLAUDE_CONFIG_DIR (never your ~/.claude),
// with a pre-seeded git snapshot for line 3, a chosen soul for line 4, and a pinned clock.
// The ANSI colours it prints become SVG <tspan>s, so every pixel of text is what the
// script draws in a terminal. rasterize.py turns the frames into hero.gif.
"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "..");
const OUT = path.join(__dirname, "..");
const STATUSLINE = path.join(ROOT, "statusline.js");
const { parseSoul, pickCanned, fillLine, VERSION } = require(STATUSLINE);

// ─── the demo session ─────────────────────────────────────────────────────
const LAUNCH = "D:\\AI_WORKSPACE_Personal"; // matches a ROOT_PALETTES entry, so it shimmers
const REPO = "D:\\AI_WORKSPACE_Personal\\projects\\my-app";
const SESSION = "readme-demo";
const T0 = (() => { // a weekday afternoon, local time, aligned to a line-4 slot
  const t = new Date(2026, 8, 28, 14, 0, 0).getTime();
  return t - (t % 30_000);
})();

function payload(now, ctxPct) {
  const s = Math.floor(now / 1000);
  return {
    session_id: SESSION,
    model: { display_name: "Opus 5.5" },
    effort: { level: "high" },
    context_window: {
      used_percentage: ctxPct, total_input_tokens: ctxPct * 10_000, total_output_tokens: 0,
      context_window_size: 1_000_000,
    },
    cost: { total_lines_added: 156, total_lines_removed: 23 },
    rate_limits: {
      five_hour: { used_percentage: 58, resets_at: s + 1 * 3600 + 47 * 60 + 30 },
      seven_day: { used_percentage: 41, resets_at: s + 2 * 86400 + 3 * 3600 + 30 },
    },
    workspace: { project_dir: LAUNCH, current_dir: REPO },
    pr: { number: 12, url: "https://github.com/you/my-app/pull/12", review_state: "approved" },
  };
}

const GIT = { branch: "feat/souls", upstream: "origin/feat/souls", ahead: 2, behind: 0, dirty: 3, syncAge: "3h ago" };

// ─── one real render ──────────────────────────────────────────────────────
function render({ now, ctxPct = 61, animal = "fox", git = GIT, cols = 140, data }) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "sl-readme-"));
  try {
    fs.mkdirSync(path.join(cfg, "souls"));
    fs.copyFileSync(path.join(ROOT, "souls", `${animal}.md`), path.join(cfg, "souls", `${animal}.md`));
    fs.writeFileSync(path.join(cfg, "statusline-soul.json"), JSON.stringify({ mode: "canned", animal }));
    fs.writeFileSync(path.join(cfg, `statusline-git.${SESSION}.cache.json`), JSON.stringify({
      cwd: REPO, gitTs: now, g: git, topLevel: REPO, branch: git.branch,
      originUrl: "git@github.com:you/my-app.git",
    }));
    return execFileSync(process.execPath, ["-r", path.join(__dirname, "fake-now.js"), STATUSLINE], {
      input: JSON.stringify(data || payload(now, ctxPct)), encoding: "utf8", timeout: 5000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, FAKE_NOW_MS: String(now), COLUMNS: String(cols) },
    }).replace(/\n$/, "").split("\n");
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true });
  }
}

// ─── ANSI → SVG ───────────────────────────────────────────────────────────
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DEFAULT_FG = "#d7dce2";

function spans(line) {
  const out = [];
  let fg = DEFAULT_FG, bold = false, italic = false;
  for (const part of line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      const c = m[1].split(";").map(Number);
      if (c[0] === 0) { fg = DEFAULT_FG; bold = false; italic = false; }
      else if (c[0] === 1) bold = true;
      else if (c[0] === 3) italic = true;
      else if (c[0] === 38 && c[1] === 2) fg = `rgb(${c[2]},${c[3]},${c[4]})`;
      continue;
    }
    if (part) out.push({ text: part, fg, bold, italic });
  }
  return out;
}

const MONO = "'Cascadia Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// The gutter ▌ is drawn as a bar the full line height, as terminal cells butt together;
// a font's ▌ glyph is shorter and would leave gaps between lines.
function textLine(line, x, y, size, lh = 31) {
  const sp = spans(line);
  let gutter = "";
  if (sp[0] && sp[0].text.startsWith("▌")) {
    gutter = `<rect x="${x}" y="${y - Math.round(lh * 0.72)}" width="${Math.round(size * 0.45)}" height="${lh}" fill="${sp[0].fg}"/>`;
    sp[0] = { ...sp[0], text: " " + sp[0].text.slice(1) };
  }
  return gutter + textSpans(sp, x, y, size);
}
function textSpans(sp, x, y, size) {
  const t = sp.map((s) =>
    `<tspan fill="${s.fg}"${s.bold ? ' font-weight="700"' : ""}${s.italic ? ' font-style="italic"' : ""}>${esc(s.text)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" xml:space="preserve">${t}</text>`;
}

// Pixel wordmark: the banner's block letters, drawn with the context bar's █ as the unit.
const GLYPHS = {
  S: ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
};
function wordmark(word, x, y, cell) {
  let rects = "", shadow = "";
  [...word].forEach((ch, i) => {
    const g = GLYPHS[ch];
    const ox = x + i * cell * 6;
    g.forEach((row, r) => [...row].forEach((on, c) => {
      if (on !== "1") return;
      const rx = ox + c * cell, ry = y + r * cell;
      rects += `<rect x="${rx}" y="${ry}" width="${cell}" height="${cell}"/>`;
      shadow += `<rect x="${rx + 4}" y="${ry + 4}" width="${cell}" height="${cell}"/>`;
    }));
  });
  return `<g fill="none" stroke="url(#mark)" stroke-width="1.2" opacity="0.55">${shadow}</g>` +
    `<g fill="url(#mark)">${rects}</g>`;
}

const C = { bg: "#0b0e14", panel: "#10141b", rule: "#222a35", fg: "#d7dce2", muted: "#7d8590", cyan: "#06b6d4", mint: "#4ade80" };

function hero(lines) {
  const W = 1200, H = 470, size = 17, lh = 31;
  const px = 50, py = 200, pw = W - 2 * px;
  const rows = lines.map((l, i) => textLine(l, px + 34, py + 92 + i * lh, size)).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">claude-code-statusline</title>
  <desc id="d">A four-line status line under the Claude Code prompt: model and context bar, rate limits with pace, git state of the current repo, and a fox companion commenting on uncommitted files.</desc>
  <defs>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.cyan}"/><stop offset="1" stop-color="${C.mint}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="22" fill="${C.bg}"/>
  <g id="title">
    ${wordmark("STATUSLINE", 56, 46, 8)}
    <text x="56" y="150" font-family="${SANS}" font-size="24" fill="${C.fg}">A four-line dashboard for the bottom of your Claude Code terminal.</text>
    <text x="1144" y="60" text-anchor="end" font-family="${MONO}" font-size="16" fill="${C.muted}">claude-code-statusline</text>
    <text x="1144" y="86" text-anchor="end" font-family="${MONO}" font-size="16" fill="${C.cyan}">v${VERSION}</text>
  </g>
  <g id="terminal">
    <rect x="${px}" y="${py}" width="${pw}" height="${H - py - 50}" rx="12" fill="${C.panel}" stroke="${C.rule}"/>
    <rect x="${px + 20}" y="${py + 18}" width="${pw - 40}" height="40" rx="8" fill="none" stroke="#3a4350"/>
    <text x="${px + 36}" y="${py + 44}" font-family="${MONO}" font-size="${size}" fill="${C.muted}">&gt; <tspan fill="${C.fg}">commit the soul files</tspan><tspan fill="${C.cyan}">▌</tspan></text>
  ${rows}
  </g>
  <text x="56" y="${H - 20}" font-family="${MONO}" font-size="15" fill="${C.muted}">zero dependencies · no network · no model calls · node + git · MIT</text>
</svg>
`;
}

function companions(rows) {
  const W = 1200, rowH = 64, top = 84, H = top + rows.length * rowH + 30, size = 19;
  const body = rows.map((r, i) => {
    const y = top + i * rowH;
    return `<g>
    <rect x="50" y="${y}" width="${W - 100}" height="${rowH - 12}" rx="10" fill="${C.panel}" stroke="${C.rule}"/>
    <text x="74" y="${y + 33}" font-family="${MONO}" font-size="16" fill="${C.muted}">${esc(r.state)}</text>
    ${textLine(r.line, 290, y + 33, size)}
  </g>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">Animal companions</title>
  <desc id="d">Line 4 of the status line in three states: a squirrel on uncommitted files, a fox on a branch behind its upstream, and a turtle on a nearly full context window.</desc>
  <rect width="${W}" height="${H}" rx="22" fill="${C.bg}"/>
  <text x="56" y="52" font-family="${SANS}" font-size="24" fill="${C.fg}">Line 4 reads the room.</text>
  <text x="1144" y="52" text-anchor="end" font-family="${MONO}" font-size="16" fill="${C.muted}">hand-written lines · picked by state</text>
  ${body}
</svg>
`;
}

// ─── pick the demo moments ────────────────────────────────────────────────
// The first time at or after T0 when `animal`'s line 4 reads `want` in state `ctx`, so each
// visual shows a line worth reading. Uses the same pickCanned() the render uses.
function findNow(animal, ctx, want) {
  const soul = parseSoul(fs.readFileSync(path.join(ROOT, "souls", `${animal}.md`), "utf8"));
  const vals = { dirty: ctx.dirty, ahead: ctx.ahead, behind: ctx.behind, branch: ctx.branch, ctx: Math.round(ctx.contextPct), limit: Math.round(ctx.limitPct) };
  const target = fillLine(want, vals);
  const base = Math.floor(T0 / 30_000);
  for (let slot = base; slot < base + 2880; slot++) {
    const now = slot * 30_000;
    if (pickCanned(soul, { ...ctx, hour: new Date(now).getHours() }, now) === target) return now;
  }
  throw new Error(`${animal} never says: ${want}`);
}

// Rate limits as payload() sets them: 58% of 5h used with 1h47m left → pace −6.
const LIMITS = { limitPct: 58, pace: -6 };
const HERO_CTX = { hasRepo: true, dirty: 3, ahead: 2, behind: 0, upstream: true, branch: "feat/souls", contextPct: 61, ...LIMITS };

function main() {
  const args = process.argv.slice(2);
  const heroSlotStart = findNow("fox", HERO_CTX, "{dirty:file} dirty and no commit. living dangerously.");
  fs.writeFileSync(path.join(OUT, "hero.svg"), hero(render({ now: heroSlotStart + 12_000 })));

  const main = { branch: "main", upstream: "origin/main" };
  const rows = [
    { animal: "squirrel", state: "✚ 3 uncommitted", pct: 22, git: { ...GIT, ...main, ahead: 0 },
      want: "{dirty:file} out in the open! bury it all in a commit!" },
    { animal: "fox", state: "⇣4 behind origin", pct: 30, git: { ...GIT, ahead: 0, dirty: 0, behind: 4 },
      want: "origin moved {behind:commit} ahead. pull before you pounce." },
    { animal: "turtle", state: "82% context", pct: 82, git: { ...GIT, ...main, ahead: 0, dirty: 0 },
      want: "{ctx}% of context. a full shell is a heavy shell." },
  ].map((r) => {
    const ctx = { hasRepo: true, dirty: r.git.dirty, ahead: r.git.ahead, behind: r.git.behind, upstream: true, branch: r.git.branch, contextPct: r.pct, ...LIMITS };
    const lines = render({ now: findNow(r.animal, ctx, r.want) + 5_000, animal: r.animal, git: r.git, ctxPct: r.pct });
    // Shown on its own, line 4 doesn't need the gutter that ties the four lines together.
    return { state: r.state, line: lines[lines.length - 1].replace(/^(\x1b\[[0-9;]*m)?▌(\x1b\[0m)? /, "") };
  });
  fs.writeFileSync(path.join(OUT, "companions.svg"), companions(rows));

  const fi = args.indexOf("--frames");
  if (fi >= 0) {
    const dir = args[fi + 1];
    fs.mkdirSync(dir, { recursive: true });
    const FPS = 15, SECONDS = 6;
    // Start 3s before the next slot: the fox's line changes once at 3s, and the loop
    // lands back on the first line. The shimmer's 3s cycle loops cleanly in 6s.
    const start = heroSlotStart + 30_000 - 3_000;
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    for (let f = 0; f < FPS * SECONDS; f++) {
      const t = f / FPS;
      // Context fills 18% → 61% over 0.2–1.4s, holds, and drains back over 5.2–6.0s.
      const up = ease((t - 0.2) / 1.2), down = ease((t - 5.2) / 0.8);
      const pct = Math.round(18 + (61 - 18) * (up - down));
      const svg = hero(render({ now: start + Math.round(t * 1000), ctxPct: pct }));
      fs.writeFileSync(path.join(dir, `frame-${String(f).padStart(3, "0")}.svg`), svg);
    }
    console.log(`${FPS * SECONDS} frames → ${dir}`);
  }
  console.log("hero.svg + companions.svg written");
}

main();
