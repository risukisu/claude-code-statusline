// test/soul.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseSoul } = require("../statusline.js");

const md = fs.readFileSync(path.join(__dirname, "fixtures/sample-soul.md"), "utf8");

test("parses sections into arrays + react string", () => {
  const s = parseSoul(md);
  assert.strictEqual(s.work.length, 2);
  assert.strictEqual(s.ambient.length, 2);
  assert.match(s.react, /ONE short witty line/);
  assert.match(s.voice, /sly/);
});
test("missing sections become empty, never throws", () => {
  const s = parseSoul("# Bare\nvoice: x\n");
  assert.deepStrictEqual(s.work, []);
  assert.deepStrictEqual(s.ambient, []);
  assert.strictEqual(s.react, "");
});
test("shipped souls all parse with content", () => {
  for (const a of ["squirrel", "fox", "turtle"]) {
    const s = parseSoul(fs.readFileSync(path.join(__dirname, "..", "souls", `${a}.md`), "utf8"));
    assert.ok(s.work.length >= 2 && s.ambient.length >= 2 && s.react.length > 0, `${a} content`);
  }
});
