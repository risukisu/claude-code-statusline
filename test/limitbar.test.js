// test/limitbar.test.js
// Line 2 draws each rate-limit window as a small bar: the fill is how much you've used,
// and a │ notch marks how much of the window's time has passed. Fill past the notch is
// overspend and gets the "bad" colour. This replaces the ⇡N / ⇣N pace arrows.
const { test } = require("node:test");
const assert = require("node:assert");
const { limitCells } = require("../statusline.js");
const { render, plain } = require("./helpers.js");

const kinds = (cells) => cells.join(" ");

test("under pace: fill stops before the notch", () => {
  // 30% used, 60% of the time gone, 10 cells: 3 filled, notch after cell 6
  assert.strictEqual(kinds(limitCells(30, 60, 10)),
    "fill fill fill empty empty empty notch empty empty empty empty");
});
test("over pace: the cells past the notch are overspend", () => {
  assert.strictEqual(kinds(limitCells(80, 50, 10)),
    "fill fill fill fill fill notch over over over empty empty");
});
test("notch at either end", () => {
  assert.strictEqual(kinds(limitCells(20, 0, 5)), "notch over empty empty empty empty");
  assert.strictEqual(kinds(limitCells(100, 100, 4)), "fill fill fill fill notch");
});
test("no reset time → no notch", () => {
  assert.strictEqual(kinds(limitCells(50, null, 4)), "fill fill empty empty");
});

const now = Math.floor(Date.now() / 1000);
const limits = {
  rate_limits: {
    five_hour: { used_percentage: 80, resets_at: now + 2.5 * 3600 + 30 },   // half the time gone (+30s slack)
    seven_day: { used_percentage: 20, resets_at: now + 3.5 * 86400 + 30 },
  },
};

test("only overspend is red: fill tops out at amber, so the part past the notch stands out", () => {
  const { THEMES } = require("../statusline.js");
  const { rgbCode } = require("./helpers.js");
  const line2 = render({ payload: limits })[1];
  const redCells = line2.split(`${rgbCode(THEMES.default.bad)}█`).length - 1;
  const amberCells = line2.split(`${rgbCode(THEMES.default.warn)}█`).length - 1;
  assert.strictEqual(redCells, 3, "80% used at 50% time: the 3 cells past the notch");
  assert.strictEqual(amberCells, 5, "the 5 cells within pace");
});
test("line 2 shows bars with a notch and no pace arrows", () => {
  const line2 = plain(render({ payload: limits })[1]);
  assert.match(line2, /^◷ 5h ▕█████│███░░▏ 80% · 2h30m left {2}│ {2}7d ▕██░░░│░░░░░▏ 20% · 3d12h left$/);
  assert.doesNotMatch(line2, /[⇡⇣]/);
});
