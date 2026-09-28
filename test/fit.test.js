// test/fit.test.js
// Narrow terminals: Claude Code passes the real width in COLUMNS. Instead of letting a long
// line wrap and break the layout, each line sheds its least useful parts first.
// Also the gutter: a ▌ in the workspace colours at the start of every line.
const { test } = require("node:test");
const assert = require("node:assert");
const { visibleWidth, fitSegments, THEMES } = require("../statusline.js");
const { render, plain, gitState, L3, rgbCode } = require("./helpers.js");

test("visibleWidth ignores colour and link codes and counts emoji as two cells", () => {
  assert.strictEqual(visibleWidth("abc"), 3);
  assert.strictEqual(visibleWidth("\x1b[38;2;1;2;3mab\x1b[0m"), 2);
  assert.strictEqual(visibleWidth("\x1b]8;;https://x.y\x07gh:a/b\x1b]8;;\x07"), 6);
  assert.strictEqual(visibleWidth("📁  x"), 5);
  assert.strictEqual(visibleWidth("🐿️"), 2);
});

test("fitSegments applies cuts in rank order until the line fits", () => {
  const segs = [
    { text: "AAAA" },
    { text: "-bb", cuts: [{ rank: 2, text: "" }] },
    { text: "-cccc", cuts: [{ rank: 1, text: "-c" }, { rank: 3, text: "" }] },
  ];
  assert.strictEqual(fitSegments(segs, 20), "AAAA-bb-cccc");
  assert.strictEqual(fitSegments(segs, 10), "AAAA-bb-c");
  assert.strictEqual(fitSegments(segs, 7), "AAAA-c");
  assert.strictEqual(fitSegments(segs, 4), "AAAA");
  assert.strictEqual(fitSegments(segs, 2), "AAAA", "segments without cuts always stay");
});

const busy = {
  git: gitState({ branch: "feat/souls", upstream: "origin/feat/souls", ahead: 2, dirty: 3 }),
  payload: {
    model: { display_name: "Opus 5.5" }, effort: { level: "high" },
    context_window: { used_percentage: 61, total_input_tokens: 610_000, total_output_tokens: 0, context_window_size: 1_000_000 },
    cost: { total_lines_added: 156, total_lines_removed: 23 },
    pr: { number: 12, url: "https://github.com/you/my-app/pull/12", review_state: "approved" },
    rate_limits: {
      five_hour: { used_percentage: 58, resets_at: Math.floor(Date.now() / 1000) + 6450 },
      seven_day: { used_percentage: 41, resets_at: Math.floor(Date.now() / 1000) + 183600 },
    },
  },
};
const widths = (lines) => lines.map((l) => visibleWidth(l));

test("wide terminal: nothing is cut", () => {
  const lines = render({ ...busy, env: { COLUMNS: "160" } });
  const l3 = plain(L3(lines));
  for (const part of ["my-app", "↻ 3h ago", "gh:you/my-app", "PR #12 approved"]) assert.ok(l3.includes(part), part);
  assert.match(plain(lines[0]), /610k\/1M/);
});
test("narrow terminal: every line fits, the essentials stay", () => {
  for (const cols of [100, 80, 64]) {
    const lines = render({ ...busy, env: { COLUMNS: String(cols) } });
    for (const w of widths(lines)) assert.ok(w <= cols - 2, `${cols} cols: a line is ${w} wide`);
    const l3 = plain(L3(lines));
    for (const part of ["feat/souls", "✚ 3", "⇡2"]) assert.ok(l3.includes(part), `${cols}: kept ${part}`);
    assert.match(plain(lines[0]), /61%/, `${cols}: context % stays`);
    assert.match(plain(lines[0]), /\/compact/, `${cols}: the compact hint stays`);
  }
});
test("line 3 sheds the remote first, then the sync age", () => {
  const l3at = (cols) => plain(L3(render({ ...busy, env: { COLUMNS: String(cols) } })));
  assert.ok(l3at(160).includes("gh:you/my-app"), "wide: remote shown");
  const mid = l3at(84);
  assert.ok(!mid.includes("gh:you/my-app") && mid.includes("↻ 3h ago"), "84 cols: remote gone, sync age kept");
  const tight = l3at(66);
  assert.ok(!tight.includes("↻") && tight.includes("PR #12"), "66 cols: sync age gone too, PR kept");
});

test("gutter (default): every line starts with ▌ in the workspace colours, top to bottom", () => {
  const lines = render({ ...busy, soul: "fox", payload: { ...busy.payload, workspace: { project_dir: "D:/AI_WORKSPACE_Personal", current_dir: "D:/demo/my-app" } } });
  assert.strictEqual(lines.length, 4);
  for (const l of lines) assert.ok(l.startsWith("\x1b[38;2;") && l.includes("▌"), JSON.stringify(l.slice(0, 30)));
  assert.ok(lines[0].startsWith(rgbCode([6, 182, 212]) + "▌"), "first line: the palette's first colour");
  assert.ok(lines[3].startsWith(rgbCode([74, 222, 128]) + "▌"), "last line: the palette's second colour");
});
test("gutter without a workspace palette uses the theme blue", () => {
  const lines = render(busy);
  assert.ok(lines[0].startsWith(rgbCode(THEMES.default.blue) + "▌"));
});
test("gutter: false leaves it out", () => {
  const lines = render({ ...busy, config: { gutter: false } });
  assert.ok(!lines.some((l) => l.includes("▌")));
});
