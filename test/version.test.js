// test/version.test.js
// One version, stated in two places: the VERSION constant users see via --version, and the
// newest CHANGELOG entry the GitHub release is cut from. They must never drift apart.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { VERSION } = require("../statusline.js");

test("VERSION is semver", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("VERSION matches the newest released CHANGELOG entry", () => {
  const log = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
  const m = log.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(m, "CHANGELOG.md needs a '## [x.y.z] — YYYY-MM-DD' entry");
  assert.strictEqual(m[1], VERSION);
});
