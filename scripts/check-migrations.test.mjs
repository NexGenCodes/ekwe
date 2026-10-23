import assert from "node:assert/strict";
import test from "node:test";
import { validateMigrationNames } from "./check-migrations.mjs";

test("accepts D1-convention filenames", () => {
  assert.deepEqual(
    validateMigrationNames([
      "0001_auth.sql",
      "0007_ai_budget.sql",
      "0010_add_history_index.sql",
    ]),
    [],
  );
});

test("rejects malformed filenames", () => {
  for (const name of [
    "auth.sql",
    "1_auth.sql",
    "0001-auth.sql",
    "0001_auth.SQL",
    "0001_Auth.sql",
    "0001_auth.sql.bak",
  ]) {
    const violations = validateMigrationNames([name]);
    assert.equal(violations.length, 1, `${name} should be rejected`);
    assert.match(violations[0], new RegExp(name.replace(/\./g, "\\.")));
  }
});

test("rejects duplicate numeric prefixes", () => {
  const violations = validateMigrationNames([
    "0001_auth.sql",
    "0001_duplicate.sql",
  ]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /0001_duplicate\.sql/);
  assert.match(violations[0], /0001_auth\.sql/);
});

test("reports every violation instead of stopping at the first", () => {
  const violations = validateMigrationNames([
    "bad.sql",
    "0001_auth.sql",
    "0001_duplicate.sql",
    "0002_ok.sql",
  ]);
  assert.equal(violations.length, 2);
});
