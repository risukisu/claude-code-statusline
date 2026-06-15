// test/config.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../statusline.js");

const tmp = (name) => path.join(os.tmpdir(), `soul-${process.pid}-${name}`);

test("missing file → off/squirrel", () => {
  assert.deepStrictEqual(loadConfig(tmp("nope.json")), { mode: "off", animal: "squirrel" });
});
test("reads mode and animal", () => {
  const p = tmp("ok.json");
  fs.writeFileSync(p, JSON.stringify({ mode: "react", animal: "fox" }));
  assert.deepStrictEqual(loadConfig(p), { mode: "react", animal: "fox" });
  fs.unlinkSync(p);
});
test("invalid values fall back", () => {
  const p = tmp("bad.json");
  fs.writeFileSync(p, JSON.stringify({ mode: "loud", animal: "dragon" }));
  assert.deepStrictEqual(loadConfig(p), { mode: "off", animal: "squirrel" });
  fs.unlinkSync(p);
});
test("malformed json → off/squirrel", () => {
  const p = tmp("junk.json");
  fs.writeFileSync(p, "{not json");
  assert.deepStrictEqual(loadConfig(p), { mode: "off", animal: "squirrel" });
  fs.unlinkSync(p);
});
