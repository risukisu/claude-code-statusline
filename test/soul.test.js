// test/soul.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseSoul, fillLine, SECTIONS } = require("../statusline.js");

const md = fs.readFileSync(path.join(__dirname, "fixtures/sample-soul.md"), "utf8");
const ANIMALS = ["squirrel", "fox", "turtle"];
const shipped = (a) => parseSoul(fs.readFileSync(path.join(__dirname, "..", "souls", `${a}.md`), "utf8"));

test("parses work/ambient sections into arrays + voice", () => {
  const s = parseSoul(md);
  assert.strictEqual(s.work.length, 2);
  assert.strictEqual(s.ambient.length, 2);
  assert.match(s.voice, /sly/);
});
test("parses the state sections", () => {
  const s = parseSoul("# X\n## dirty\n- d\n## ahead\n- a\n## behind\n- b\n## synced\n- s\n" +
    "## context\n- c\n## limits\n- l\n## branch\n- br\n## norepo\n- n\n## night\n- ni\n");
  assert.deepStrictEqual(
    [s.dirty, s.ahead, s.behind, s.synced, s.context, s.limits, s.branch, s.norepo, s.night],
    [["d"], ["a"], ["b"], ["s"], ["c"], ["l"], ["br"], ["n"], ["ni"]],
  );
});
test("unknown sections are ignored, not parsed as lines", () => {
  const s = parseSoul("# X\nvoice: v\n\n## notes\n- not a line\n\n## ambient\n- calm\n");
  assert.deepStrictEqual(s.ambient, ["calm"]);
  assert.deepStrictEqual(s.work, []);
  assert.strictEqual("notes" in s, false);
});
test("missing sections become empty, never throws", () => {
  const s = parseSoul("# Bare\nvoice: x\n");
  for (const name of SECTIONS) assert.deepStrictEqual(s[name], [], name);
});

// ─── the shipped souls ────────────────────────────────────────────────────
// Worst-case placeholder values: the longest a line can get before truncate() steps in.
const WORST = {
  dirty: 999, ahead: 99, behind: 99, ctx: 100, limit: 100, branch: "feature/x",
};

for (const a of ANIMALS) {
  test(`${a}: every section has lines, ambient has plenty`, () => {
    const s = shipped(a);
    assert.ok(s.voice && s.rules, "voice and rules headers");
    assert.ok(s.ambient.length >= 12, `ambient has ${s.ambient.length}`);
    for (const name of SECTIONS.filter((n) => n !== "ambient")) {
      assert.ok(s[name].length >= 4, `${name} has ${s[name].length}`);
    }
  });
  test(`${a}: lines fit 80 chars filled, no emoji, no duplicates, only known placeholders`, () => {
    const s = shipped(a);
    const all = SECTIONS.flatMap((n) => s[n]);
    assert.strictEqual(new Set(all).size, all.length, "duplicate line");
    for (const line of all) {
      const filled = fillLine(line, WORST);
      assert.ok(filled != null, `unknown or unfillable placeholder: ${line}`);
      assert.ok(filled.length <= 80, `${filled.length} chars: ${filled}`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(line), `emoji in: ${line}`);
    }
  });
}
