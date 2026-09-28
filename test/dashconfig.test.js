// test/dashconfig.test.js
// ~/.claude/statusline.json holds the dashboard settings, so customising no longer means
// editing statusline.js (which every upgrade overwrites). Everything is optional and every
// bad value falls back to its default.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadDashConfig, DEFAULT_DASH } = require("../statusline.js");

const tmp = (name, obj) => {
  const f = path.join(os.tmpdir(), `dash-${process.pid}-${name}.json`);
  fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj));
  return f;
};

test("missing file → defaults", () => {
  const c = loadDashConfig(path.join(os.tmpdir(), "no-such-statusline.json"));
  assert.deepStrictEqual(c, DEFAULT_DASH);
  assert.strictEqual(c.theme, "default");
  assert.strictEqual(c.links, true);
  assert.strictEqual(c.quiet, true);
  assert.deepStrictEqual(c.context, { warn: 40, danger: 50 });
  assert.strictEqual(c.palettes, null); // null = the built-in workspace palettes
});
test("malformed json → defaults", () => {
  assert.deepStrictEqual(loadDashConfig(tmp("junk", "{nope")), DEFAULT_DASH);
});
test("reads theme, links, quiet, context thresholds, hide list, bar width", () => {
  const c = loadDashConfig(tmp("ok", {
    theme: "colorblind", links: false, quiet: false, context: { warn: 30, danger: 45 },
    hide: ["effort", "remote"], barWidth: 16,
  }));
  assert.strictEqual(c.theme, "colorblind");
  assert.strictEqual(c.links, false);
  assert.strictEqual(c.quiet, false);
  assert.deepStrictEqual(c.context, { warn: 30, danger: 45 });
  assert.deepStrictEqual(c.hide, ["effort", "remote"]);
  assert.strictEqual(c.barWidth, 16);
});
test("bad values fall back one by one", () => {
  const c = loadDashConfig(tmp("bad", {
    theme: "neon", links: "yes", context: { warn: 60, danger: 50 }, hide: ["effort", "nonsense"], barWidth: 500,
  }));
  assert.strictEqual(c.theme, "default");
  assert.strictEqual(c.links, true);
  assert.deepStrictEqual(c.context, { warn: 40, danger: 50 }, "warn must sit below danger");
  assert.deepStrictEqual(c.hide, ["effort"], "unknown segment names are dropped");
  assert.strictEqual(c.barWidth, DEFAULT_DASH.barWidth);
});
test("palettes: path fragment + two hex colours; broken entries are skipped", () => {
  const c = loadDashConfig(tmp("pal", { palettes: [
    { match: "Work_Stuff", from: "#f59e0b", to: "#FDE68A" },
    { match: "", from: "#000000", to: "#ffffff" },
    { match: "x", from: "orange", to: "#ffffff" },
  ] }));
  assert.strictEqual(c.palettes.length, 1);
  const p = c.palettes[0];
  assert.deepStrictEqual([p.c1, p.c2], [[245, 158, 11], [253, 230, 138]]);
  assert.strictEqual(p.test("C:\\Users\\me\\work_stuff\\repo"), true, "case-insensitive, either slash");
  assert.strictEqual(p.test("C:/Users/me/personal"), false);
});
test("an empty palettes list turns the built-in shimmer off", () => {
  assert.deepStrictEqual(loadDashConfig(tmp("nopal", { palettes: [] })).palettes, []);
});
