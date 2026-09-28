// test/heat.test.js
// Context quality drops well before the window is full, so the heat scale front-loads the
// red: amber from 30%, orange at the warn line (40%), red from the danger line (50%) on.
// At danger the percentage turns red and a /compact hint appears.
const { test } = require("node:test");
const assert = require("node:assert");
const { heatRGB } = require("../statusline.js");
const { render, plain } = require("./helpers.js");

test("heat scale anchors: blue → amber → orange at warn → red at danger → deep red", () => {
  assert.deepStrictEqual(heatRGB(0, 40, 50), [91, 158, 245]);
  assert.deepStrictEqual(heatRGB(0.3, 40, 50), [245, 200, 91]);
  assert.deepStrictEqual(heatRGB(0.4, 40, 50), [255, 140, 66]);
  assert.deepStrictEqual(heatRGB(0.5, 40, 50), [245, 91, 91]);
  assert.deepStrictEqual(heatRGB(1, 40, 50), [190, 40, 60]);
});
test("everything past the danger line is red", () => {
  for (const pos of [0.55, 0.7, 0.9]) {
    const [r, g, b] = heatRGB(pos, 40, 50);
    assert.ok(r >= 190 && g <= 91 && b <= 91, `${pos} → ${[r, g, b]}`);
  }
});
test("the scale follows custom thresholds", () => {
  assert.deepStrictEqual(heatRGB(0.6, 60, 80), [255, 140, 66]);
  assert.deepStrictEqual(heatRGB(0.8, 60, 80), [245, 91, 91]);
});

const ctx = (pct) => ({ context_window: { used_percentage: pct, total_input_tokens: pct * 10_000, total_output_tokens: 0, context_window_size: 1_000_000 } });

test("below warn: no hint", () => {
  assert.doesNotMatch(plain(render({ payload: ctx(35) })[0]), /compact/);
});
test("at danger: the line says to compact", () => {
  assert.match(plain(render({ payload: ctx(50) })[0]), /50% · 500k\/1M · ⚠ \/compact/);
  assert.match(plain(render({ payload: ctx(73) })[0]), /73% · 730k\/1M · ⚠ \/compact/);
});
test("thresholds come from the config", () => {
  assert.doesNotMatch(plain(render({ payload: ctx(55), config: { context: { warn: 60, danger: 80 } } })[0]), /compact/);
});
