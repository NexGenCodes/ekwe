import test from "node:test";
import assert from "node:assert/strict";
import { validateChangelog } from "./check-changelog.mjs";

test("passes when version has an entry", () => {
  assert.deepEqual(validateChangelog("1.3.2", "## [1.3.2] - 2026-11-05\n\n### Fixed\n- x\n"), []);
});

test("fails when version entry is missing", () => {
  const problems = validateChangelog("1.3.2", "## [1.3.0] - 2026-10-23\n");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /1\.3\.2/);
});

test("fails on unparseable version", () => {
  assert.ok(validateChangelog(null, "## [1.3.2]\n").length > 0);
});
