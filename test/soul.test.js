// test/soul.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseSoul } = require("../statusline.js");

const md = fs.readFileSync(path.join(__dirname, "fixtures/sample-soul.md"), "utf8");

test("parses work/ambient sections into arrays + voice", () => {
  const s = parseSoul(md);
  assert.strictEqual(s.work.length, 2);
  assert.strictEqual(s.ambient.length, 2);
  assert.match(s.voice, /sly/);
});
test("unknown sections (e.g. a leftover ## react) are ignored, not parsed as lines", () => {
  const s = parseSoul("# X\nvoice: v\n\n## react\nYou are X. Reply in one line.\n\n## ambient\n- calm\n");
  assert.deepStrictEqual(s.ambient, ["calm"]);
  assert.deepStrictEqual(s.work, []);
  assert.strictEqual("react" in s, false);
});
test("missing sections become empty, never throws", () => {
  const s = parseSoul("# Bare\nvoice: x\n");
  assert.deepStrictEqual(s.work, []);
  assert.deepStrictEqual(s.ambient, []);
});
test("shipped souls all parse with content", () => {
  for (const a of ["squirrel", "fox", "turtle"]) {
    const s = parseSoul(fs.readFileSync(path.join(__dirname, "..", "souls", `${a}.md`), "utf8"));
    assert.ok(s.work.length >= 2 && s.ambient.length >= 2, `${a} content`);
  }
});
