#!/usr/bin/env node
// The project tile: the status line acting out its four lines one beat at a time.
//
//   node assets/readme/source/tile.js                → assets/readme/tile.svg + tile-static.svg
//   node assets/readme/source/tile.js --art <file>   → also the narrow "art" strip (beat tabs +
//                                                       terminal) for a site tile, e.g. abialas.pl
//   python assets/readme/source/rasterize.py png assets/readme/tile-static.svg assets/readme/tile.png
//
// Two layouts share one timeline. `card` is the full README card in the abialas.pl tile style
// (flat plate, 2px ink border, hard offset shadow, title with ↗, pitch line, mono link).
// `art` is only the beat tabs and the terminal, rendered at 72 columns so the lines fit a
// half-width tile, for a host page that draws its own frame and title.
//
// The lines are a REAL render (build.js → statusline.js in a throwaway config dir), laid out
// on a terminal grid. Every piece has a dim resting look that is always on screen and a
// bright active look that only its own beat turns on. Pure CSS animation, no script, system
// fonts: it plays inside an <img>. Reduced motion (and tile-static.svg) shows every result.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { render, payload, findNow, HERO_CTX, esc, MONO, SANS, VERSION } = require("./build.js");
const { THEMES } = require("../../../statusline.js");

const OUT = path.join(__dirname, "..");
const T = THEMES.default;
const hex = (c) => `rgb(${c.join(",")})`;
const DIM = "#39424e"; // resting ink for data that isn't on stage
const REPO = "D:\\AI_WORKSPACE_Personal\\projects\\my-app";

const LAYOUTS = {
  card: { W: 1200, H: 452, TX: 58, CW: 9.6, SIZE: 16, LY: [218, 252, 286, 320], LH: 34, cols: 140 },
  // 72 columns: the fitting drops the token count; the demo hides the sync age and launches
  // from the repo itself (no ▸), with a settings-file palette so "my-app" still shimmers.
  art: {
    H: 152, TX: 22, CW: 7.2, SIZE: 12, LY: [58, 81, 104, 127], LH: 23, cols: 72,
    dash: { hide: ["sync"], palettes: [{ match: "my-app", from: "#06b6d4", to: "#4ade80" }] },
    workspace: { project_dir: REPO, current_dir: REPO },
  },
};

// ─── the demo moment: busy branch, context past the danger line, 5h overspent ──
// 80% of the 5h window at its halfway mark: the limits state holds too (pace +30).
const TILE_CTX = { ...HERO_CTX, limitPct: 80, pace: 30 };
const NOW = findNow("fox", TILE_CTX, "{dirty:file} dirty and no commit. living dangerously.") + 12_000;

function linesFor(L) {
  const data = payload(NOW, 61);
  const s = Math.floor(NOW / 1000);
  data.rate_limits = {
    five_hour: { used_percentage: 80, resets_at: s + 2.5 * 3600 + 30 },
    seven_day: { used_percentage: 41, resets_at: s + 3 * 86400 + 30 },
  };
  if (L.workspace) data.workspace = L.workspace;
  return render({ now: NOW, data, cols: L.cols, dash: L.dash });
}

// ─── ANSI → terminal cells (emoji take two) ───────────────────────────────
const WIDE = /\p{Extended_Pictographic}/u;
function cellsOf(line) {
  const out = [];
  let fg = "#d7dce2", bold = false, italic = false;
  for (const part of line.replace(/\x1b\]8;;[^\x07]*\x07/g, "").split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      const c = m[1].split(";").map(Number);
      if (c[0] === 0) { fg = "#d7dce2"; bold = italic = false; }
      else if (c[0] === 1) bold = true;
      else if (c[0] === 3) italic = true;
      else if (c[0] === 38) fg = `rgb(${c[2]},${c[3]},${c[4]})`;
      continue;
    }
    for (const ch of [...part.replace(/\uFE0F/g, "")]) {
      out.push({ ch, fg, bold, italic });
      if (WIDE.test(ch)) out.push(null);
    }
  }
  return out;
}

const BEATS = [
  { name: "context", accent: "#ff8c42", blurb: "how full the chat is" },
  { name: "limits", accent: hex(T.warn), blurb: "spend vs. the clock" },
  { name: "git", accent: hex(T.good), blurb: "commit · push · pull" },
  { name: "companion", accent: "#06b6d4", blurb: "a fox with opinions" },
];
const HOLD = 3, LOOP = BEATS.length * HOLD, FADE_IN = 0.12, FADE_OUT = 0.14;

function build(L) {
  const { TX, CW, SIZE, LY, LH } = L;
  const k = SIZE / 16; // everything below was drawn at 16px
  const r = (n) => Math.round(n * k * 10) / 10;
  const rows = linesFor(L).map(cellsOf);
  // one code unit per cell, so string indices are columns (📁 and 🦊 are two code units)
  const text = rows.map((row) => row.map((c) => (!c ? "\0" : c.ch.length > 1 ? "\uFFFC" : c.ch)).join(""));
  const at = (li, needle, from = 0) => text[li].indexOf(needle, from);
  const find = (li, needle, from = 0) => {
    const i = at(li, needle, from);
    if (i < 0) throw new Error(`line ${li + 1} has no "${needle}": ${text[li]}`);
    return i;
  };
  const colX = (c) => TX + c * CW;

  // Draw columns [from, to) of a row: text runs as one <text> with an x per glyph, block
  // glyphs as rects. `dim` swaps every colour for the resting ink.
  function draw(li, from, to, { dim = false, color = null } = {}) {
    const row = rows[li], y = LY[li];
    let out = "", run = null;
    const flush = () => {
      if (!run) return;
      const xs = run.cells.map((c) => colX(c.col).toFixed(1)).join(" ");
      const t = run.cells.map((c) => esc(c.ch)).join("");
      out += `<text x="${xs}" y="${y}" fill="${run.fg}"${run.bold ? ' font-weight="700"' : ""}${run.italic ? ' font-style="italic"' : ""}>${t}</text>`;
      run = null;
    };
    for (let col = from; col < to; col++) {
      const c = row[col];
      if (!c || c.ch === " ") { flush(); continue; }
      const fg = dim ? DIM : color || c.fg;
      if ("█░▕▏".includes(c.ch)) {
        flush();
        const x = colX(col), top = y - r(15);
        if (c.ch === "█") out += `<rect x="${x.toFixed(1)}" y="${top}" width="${(CW - 1).toFixed(1)}" height="${r(19)}" fill="${dim ? "#1c222b" : fg}"/>`;
        else if (c.ch === "░") out += `<rect x="${x.toFixed(1)}" y="${top}" width="${(CW - 1).toFixed(1)}" height="${r(19)}" fill="#1c222b"/>`;
        else out += `<rect x="${(x + (c.ch === "▕" ? CW - 2 : 0)).toFixed(1)}" y="${top - r(2)}" width="1.5" height="${r(23)}" fill="${dim ? DIM : "#46505c"}"/>`;
        continue;
      }
      const style = { fg, bold: c.bold, italic: c.italic };
      if (run && run.fg === style.fg && run.bold === style.bold && run.italic === style.italic) run.cells.push({ ...c, col });
      else { flush(); run = { ...style, cells: [{ ...c, col }] }; }
    }
    flush();
    return out;
  }
  // A mask under an active piece, so the resting ink beneath never shows through.
  const mask = (li, from, to) => `<rect x="${(colX(from) - 1).toFixed(1)}" y="${LY[li] - r(17)}" width="${((to - from) * CW + 2).toFixed(1)}" height="${r(23)}" fill="#10141b"/>`;

  const pieces = []; // { svg, beat, t0, t1?, final, grow?, type? }
  const on = (beat, t0, svg, opts = {}) => pieces.push({ beat, t0, svg, final: true, ...opts });

  // Beat 1 — context: the bar fills cell by cell, the % climbs through its colours,
  // and /compact lands when the fill crosses the danger line.
  {
    const bar = find(0, "▕") + 1;
    for (let i = 0; rows[0][bar + i] && rows[0][bar + i].ch !== "▏"; i++) {
      if (rows[0][bar + i].ch === "█") on(0, 0.25 + i * (1.1 / (at(0, "▏") - bar)), draw(0, bar + i, bar + i + 1));
    }
    const pct = find(0, "61%");
    const steps = [["18%", DIM, 0.25], ["35%", hex(T.dim), 0.5], ["45%", hex(T.warn), 0.72], ["61%", null, 0.95]];
    steps.forEach(([label, color, t0], i) => {
      const t1 = i < steps.length - 1 ? steps[i + 1][2] + 0.05 : null;
      const svg = mask(0, pct, pct + 3) + (color
        ? `<text x="${[0, 1, 2].map((j) => colX(pct + j).toFixed(1)).join(" ")}" y="${LY[0]}" fill="${color}">${label}</text>`
        : draw(0, pct, pct + 3));
      pieces.push({ beat: 0, t0, t1, svg, final: !color });
    });
    const tok = at(0, "610k");
    if (tok >= 0) on(0, 0.3, draw(0, tok - 2, tok + 7));
    const cmp = find(0, "⚠") - 2;
    on(0, 1.12, mask(0, cmp, cmp + 13) + draw(0, cmp, cmp + 13));
    const diff = at(0, "+156");
    if (diff >= 0) on(0, 1.4, draw(0, diff - 3, text[0].length));
  }

  // Beat 2 — limits: the clock notch appears, the fill spends up to it in amber, the
  // overspend past it lands in red, then the 7-day window, comfortably under pace.
  {
    const b5 = find(1, "▕") + 1;
    const end5 = find(1, "▏", b5);
    let t = 0.45, over = 0.95;
    for (let col = b5; col < end5; col++) {
      const c = rows[1][col];
      if (c.ch === "│") on(1, 0.25, mask(1, col, col + 1) + draw(1, col, col + 1));
      else if (c.ch === "█" && c.fg === hex(T.bad)) { on(1, over, draw(1, col, col + 1)); over += 0.15; }
      else if (c.ch === "█") { on(1, t, draw(1, col, col + 1)); t += 0.08; }
    }
    const p5 = find(1, "80%");
    on(1, 1.45, mask(1, p5, p5 + 3) + draw(1, p5, p5 + 3));
    const left5 = at(1, "2h30m");
    if (left5 >= 0) on(1, 1.55, draw(1, left5 - 2, left5 + 11));
    const b7 = find(1, "▕", end5) + 1;
    const end7 = find(1, "▏", b7);
    for (let col = b7; col < end7; col++) {
      const c = rows[1][col];
      if (c.ch === "│") on(1, 1.8, mask(1, col, col + 1) + draw(1, col, col + 1));
      else if (c.ch === "█") on(1, 1.85 + (col - b7) * 0.05, draw(1, col, col + 1));
    }
    const p7 = find(1, "41%");
    on(1, 2.1, mask(1, p7, text[1].length) + draw(1, p7, text[1].length));
  }

  // Beat 3 — git: uncommitted files tick up, the unpushed commits and sync age light,
  // the remote gets "clicked" (an underline draws, a pointer arrives), the PR lights.
  {
    const d = find(2, "✚");
    const digit = find(2, "3", d);
    [["1", 0.25], ["2", 0.45], ["3", 0.65]].forEach(([n, t0], i, all) => {
      const t1 = i < all.length - 1 ? all[i + 1][1] + 0.05 : null;
      const cell = rows[2][digit], was = cell.ch;
      cell.ch = n;
      const svg = mask(2, d, digit + 1) + draw(2, d, digit + 1);
      cell.ch = was;
      pieces.push({ beat: 2, t0, t1, svg, final: n === "3" });
    });
    const up = find(2, "⇡");
    on(2, 0.95, mask(2, up, up + 2) + draw(2, up, up + 2));
    const sync = at(2, "↻");
    if (sync >= 0) on(2, 1.15, draw(2, sync, sync + 8));
    const gh = at(2, "gh:");
    if (gh >= 0) {
      const ghEnd = gh + "gh:you/my-app".length;
      on(2, 1.4, mask(2, gh, ghEnd) + draw(2, gh, ghEnd, { color: "#9fb4c8" }));
      const ux = colX(gh), uw = (ghEnd - gh) * CW;
      pieces.push({
        beat: 2, t0: 1.45, final: true, grow: 0.35,
        svg: `<rect x="${ux.toFixed(1)}" y="${LY[2] + r(5)}" width="${uw.toFixed(1)}" height="1.6" fill="#9fb4c8"/>`,
      });
      const px = ux + uw * 0.55, py = LY[2] + r(3);
      on(2, 1.8, `<path d="M${px.toFixed(1)} ${py} l0 ${r(15)} l${r(4)} ${-r(4)} l${r(3)} ${r(6)} l${r(2.4)} ${-r(1.2)} l${-r(3)} ${-r(6)} l${r(5.5)} 0 z" fill="#eef2f6" stroke="#10141b" stroke-width="1"/>`);
    }
    const pr = find(2, "PR #12");
    on(2, 2.05, mask(2, pr, text[2].length) + draw(2, pr, text[2].length));
  }

  // Beat 4 — companion: the connector lights and the fox types its line.
  {
    const con = find(3, "╰");
    on(3, 0.2, mask(3, con, con + 2) + draw(3, con, con + 2, { color: "#06b6d4" }));
    const say = rows[3].findIndex((c) => c && c.ch === "🦊") + 3; // two cells for the emoji, then a space
    const n = text[3].length - say;
    const w = (n * CW).toFixed(1);
    pieces.push({
      beat: 3, t0: 0.45, final: true, type: { steps: n, dur: 1.5 },
      svg: `<clipPath id="typing"><rect class="typer" x="${colX(say).toFixed(1)}" y="${LY[3] - r(18)}" width="${w}" height="${r(26)}"/></clipPath>` +
        `<g clip-path="url(#typing)">${mask(3, say, text[3].length)}${draw(3, say, text[3].length)}</g>`,
    });
  }

  // ─── css ────────────────────────────────────────────────────────────────
  const pc = (t) => `${((t / LOOP) * 100).toFixed(3)}%`;
  const keyframes = new Map();
  function windowAnim(t0, t1) {
    const name = `w${Math.round(t0 * 100)}_${Math.round(t1 * 100)}`;
    if (!keyframes.has(name)) {
      keyframes.set(name, `@keyframes ${name}{0%,${pc(t0)}{opacity:0}${pc(t0 + FADE_IN)},${pc(t1 - FADE_OUT)}{opacity:1}${pc(t1)},100%{opacity:0}}`);
    }
    return name;
  }
  function growAnim(t0, dur, steps) {
    const name = `g${Math.round(t0 * 100)}_${Math.round(dur * 100)}${steps ? `s${steps}` : ""}`;
    if (!keyframes.has(name)) {
      const tf = steps ? `animation-timing-function:steps(${steps},end)` : "animation-timing-function:ease-out";
      keyframes.set(name, `@keyframes ${name}{0%,${pc(t0)}{transform:scaleX(0);${tf}}${pc(t0 + dur)},100%{transform:scaleX(1)}}`);
    }
    return name;
  }

  let css = "", body = "";
  pieces.forEach((p, i) => {
    const start = p.beat * HOLD;
    const t0 = start + p.t0;
    const t1 = p.t1 != null ? start + p.t1 : start + HOLD - 0.02;
    css += `.p${i}{animation:${windowAnim(t0, t1)} ${LOOP}s linear infinite}`;
    if (p.grow) css += `.p${i} rect{transform-box:fill-box;transform-origin:left;animation:${growAnim(t0, p.grow)} ${LOOP}s linear infinite}`;
    if (p.type) css += `.p${i} .typer{transform-box:fill-box;transform-origin:left;animation:${growAnim(t0, p.type.dur, p.type.steps)} ${LOOP}s linear infinite}`;
    body += `<g class="a p${i}${p.final ? " final" : ""}">${p.svg}</g>`;
  });

  // Beat tabs: the readout that names the beat on stage.
  function tabs(x0, y, { blurbs, fontSize, charW, gap }) {
    let out = "", tx = x0;
    BEATS.forEach((b, i) => {
      const label = `0${i + 1} ${b.name}`;
      const wLabel = label.length * charW;
      const fs = fontSize === 16 ? "" : ` font-size="${fontSize}"`;
      out += `<text x="${tx}" y="${y}"${fs} fill="#46505c">${label}</text>`;
      out += `<g class="a tab" style="animation:${windowAnim(i * HOLD, (i + 1) * HOLD - 0.02)} ${LOOP}s linear infinite">` +
        `<text x="${tx}" y="${y}"${fs} fill="${b.accent}">${label}</text>` +
        `<rect x="${tx}" y="${y + 8}" width="${wLabel.toFixed(0)}" height="2" fill="${b.accent}"/>` +
        (blurbs ? `<text x="${tx}" y="${y + 28}" font-size="13" fill="#7d8590">${esc(b.blurb)}</text>` : "") + `</g>`;
      tx += (blurbs ? Math.max(wLabel, b.blurb.length * 7.3) : wLabel) + gap;
    });
    return out;
  }

  // Resting layer: the structure in full colour, everything a beat will light in resting ink.
  const rest = [];
  const cut = [find(0, "▕") - 1, find(1, "5h") + 3, find(2, " :") + 3 + "feat/souls".length, find(3, "╰")];
  rows.forEach((row, li) => {
    rest.push(draw(li, 2, cut[li]));
    rest.push(draw(li, cut[li], row.length, { dim: true }));
  });
  rest.push(draw(1, find(1, "7d"), find(1, "7d") + 2)); // the 7d label is structure too
  const gx = TX - Math.round(SIZE * 1.25), gw = Math.round(SIZE * 0.44), gy = (li) => LY[li] - Math.round(LH * 0.7);
  const gutter = rows.map((row, li) => `<rect x="${gx}" y="${gy(li)}" width="${gw}" height="${LH}" fill="${row[0].fg}"/>`).join("");
  const glowH = Math.round(LH * 1.18);
  const terminal = `<g id="terminal">${gutter}<g clip-path="url(#gut)"><rect class="glow" x="${gx}" y="${gy(0)}" width="${gw}" height="${glowH}" fill="url(#gl)"/></g>${rest.join("")}${body}</g>`;

  // Built before svg(): tabs() registers keyframes the stylesheet must include.
  const isArt = L === LAYOUTS.art;
  const tabsSvg = isArt
    ? tabs(2, 14, { blurbs: false, fontSize: 11, charW: 6.6, gap: 22 })
    : tabs(36, 146, { blurbs: true, fontSize: 16, charW: 8.4, gap: 46 });
  // The art strip is as wide as its longest line (the card has a fixed plate).
  const W = isArt ? Math.ceil(TX + Math.max(...rows.map((row) => row.length)) * CW + 12) : L.W;

  function svg({ animated }) {
    const { H } = L;
    const style = animated
      ? `${[...keyframes.values()].join("")}${css}` +
        `.glow{animation:glow ${HOLD}s ease-in-out infinite}@keyframes glow{0%{transform:translateY(-${glowH}px);opacity:0}30%{opacity:.55}100%{transform:translateY(${4 * LH}px);opacity:0}}` +
        `@media (prefers-reduced-motion:reduce){.a,.a *,.glow{animation:none!important}.a{opacity:0}.a.final{opacity:1}.tab{opacity:0}.glow{opacity:0}}`
      : `.a{opacity:0}.a.final{opacity:1}.tab{opacity:0}.glow{opacity:0}`;
    const defs = `<defs><linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<clipPath id="gut"><rect x="${gx}" y="${gy(0)}" width="${gw}" height="${4 * LH}"/></clipPath></defs>`;
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="tt td">
<title id="tt">claude-code-statusline</title>
<desc id="td">The status line acting out its four lines in turn: the context bar fills and turns red with a /compact hint, a rate-limit bar shows overspend past the clock notch, git counts tick up and the repo link is clicked, and a fox companion types its line.</desc>
<style>text{font-family:${MONO};white-space:pre}.sans{font-family:${SANS}}${style}</style>
${defs}`;
    if (isArt) {
      return `${head}
<rect width="${W}" height="${H}" fill="#0b0e14"/>
<g id="tabs">${tabsSvg}</g>
<rect x="0.5" y="28.5" width="${W - 1}" height="${H - 29}" fill="#10141b" stroke="#222a35"/>
${terminal}
</svg>
`;
    }
    const PX = 36, PY = 34;
    return `${head}
<rect x="12" y="12" width="${W - 14}" height="${H - 14}" fill="#06b6d4"/>
<rect x="1" y="1" width="${W - 14}" height="${H - 14}" fill="#0b0e14" stroke="#15324E" stroke-width="2"/>
<g id="head">
  <rect x="${PX}" y="${PY + 2}" width="6" height="7" fill="#06b6d4"/><rect x="${PX}" y="${PY + 11}" width="6" height="7" fill="#1ec5b0"/><rect x="${PX}" y="${PY + 20}" width="6" height="7" fill="#36d398"/><rect x="${PX}" y="${PY + 29}" width="6" height="7" fill="#4ade80"/>
  <text class="sans" x="${PX + 20}" y="${PY + 30}" font-size="31" font-weight="700" fill="#eef2f6">claude-code-statusline</text>
  <text class="sans" x="${W - 58}" y="${PY + 28}" font-size="24" fill="#7d8590">↗</text>
  <text class="sans" x="${PX}" y="${PY + 72}" font-size="19" fill="#aab4bf">Four lines under the Claude Code prompt: context, limits, git, and a companion.</text>
</g>
<g id="tabs">${tabsSvg}</g>
<rect x="${PX - 12}" y="186" width="${W - 2 * PX}" height="160" fill="#10141b" stroke="#222a35"/>
${terminal}
<text x="${PX}" y="${H - 44}" font-size="15" fill="#06b6d4">github.com/risukisu/claude-code-statusline</text>
<text x="${W - 58}" y="${H - 44}" text-anchor="end" font-size="15" fill="#7d8590">v${VERSION} · MIT · zero dependencies · no model calls</text>
</svg>
`;
  }
  return { animated: svg({ animated: true }), still: svg({ animated: false }), pieces: pieces.length };
}

const card = build(LAYOUTS.card);
fs.writeFileSync(path.join(OUT, "tile.svg"), card.animated);
fs.writeFileSync(path.join(OUT, "tile-static.svg"), card.still);
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1);
console.log(`tile.svg ${kb(path.join(OUT, "tile.svg"))} KB, ${card.pieces} pieces, ${LOOP}s loop`);

const ai = process.argv.indexOf("--art");
if (ai >= 0) {
  const file = path.resolve(process.argv[ai + 1]);
  const art = build(LAYOUTS.art);
  fs.writeFileSync(file, art.animated);
  console.log(`art ${file} ${kb(file)} KB, ${art.pieces} pieces`);
}
