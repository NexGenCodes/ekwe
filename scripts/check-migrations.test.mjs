import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_LEGACY,
  findIntegrityFailures,
  findViolations,
} from "./check-migrations.mjs";

test("accepts Supabase-convention filenames", () => {
  assert.deepEqual(
    findViolations([
      "20260415000000_create_history.sql",
      "20260926130000_fix_history_source_app_default.sql",
    ]),
    [],
  );
});

test("accepts a convention filename with underscores and digits in the name", () => {
  assert.deepEqual(findViolations(["20260102030405_add_a_b_c2.sql"]), []);
});

test("rejects Drizzle's zero-padded naming", () => {
  assert.deepEqual(findViolations(["0002_history_origin.sql"]), [
    "0002_history_origin.sql",
  ]);
});

test("rejects a convention filename with the wrong digit count", () => {
  // 12 digits is not 14, and 15 is not either.
  assert.deepEqual(findViolations(["202604150000_create_x.sql"]), [
    "202604150000_create_x.sql",
  ]);
  assert.deepEqual(findViolations(["202604150000000_create_x.sql"]), [
    "202604150000000_create_x.sql",
  ]);
});

test("rejects a convention filename with a non-snake_case name", () => {
  assert.deepEqual(findViolations(["20260415000000_Create-History.sql"]), [
    "20260415000000_Create-History.sql",
  ]);
});

test("allows the two known pre-convention files by exact name", () => {
  for (const name of ALLOWED_LEGACY) {
    assert.deepEqual(findViolations([name]), [], `${name} should be allowed`);
  }
});

test("does not allow a lookalike of an allowlisted name", () => {
  // Allowing a prefix rather than an exact name would let anything through.
  assert.deepEqual(findViolations(["0000_baseline_v2.sql"]), [
    "0000_baseline_v2.sql",
  ]);
});

test("ignores non-sql files such as the meta directory", () => {
  assert.deepEqual(
    findViolations(["meta", "_journal.json", "0000_snapshot.json"]),
    [],
  );
});

test("reports every violation, sorted, so CI output is stable", () => {
  assert.deepEqual(
    findViolations([
      "20260415000000_ok.sql",
      "0009_zeta.sql",
      "0003_alpha.sql",
    ]),
    ["0003_alpha.sql", "0009_zeta.sql"],
  );
});

test("accepts applied migrations whose contents are unchanged", () => {
  const locked = {
    "20260415000000_create_history.sql": "aaa",
    "20260926130000_fix.sql": "bbb",
  };
  assert.deepEqual(
    findIntegrityFailures(locked, {
      ...locked,
      "20260927000000_newer.sql": "ccc",
    }),
    [],
  );
});

test("detects an applied migration edited after it was pushed", () => {
  // The real failure this exists to catch: 20260926010000 was edited after
  // being applied, so the database never got the change.
  assert.deepEqual(
    findIntegrityFailures(
      { "20260926010000_add_history_origin.sql": "aaa" },
      { "20260926010000_add_history_origin.sql": "different" },
    ),
    [{ name: "20260926010000_add_history_origin.sql", problem: "modified" }],
  );
});

test("detects a committed whitespace-only edit", () => {
  // A trailing newline changes the hash and is exactly the kind of invisible
  // edit that must not pass.
  assert.deepEqual(
    findIntegrityFailures(
      { "20260415000000_x.sql": "aaa" },
      { "20260415000000_x.sql": "bbb" },
    ),
    [{ name: "20260415000000_x.sql", problem: "modified" }],
  );
});

test("detects an applied migration deleted from the directory", () => {
  assert.deepEqual(
    findIntegrityFailures({ "20260415000000_x.sql": "aaa" }, {}),
    [{ name: "20260415000000_x.sql", problem: "deleted" }],
  );
});

test("reports integrity failures sorted, alongside each other", () => {
  assert.deepEqual(
    findIntegrityFailures(
      {
        "2026_0101000000_a.sql": "aaa",
        "2026_0102000000_b.sql": "aaa",
        "2026_0103000000_c.sql": "aaa",
      },
      {
        "2026_0101000000_a.sql": "changed",
        "2026_0102000000_b.sql": "aaa",
        "2026_0103000000_c.sql": "changed",
      },
    ),
    [
      { name: "2026_0101000000_a.sql", problem: "modified" },
      { name: "2026_0103000000_c.sql", problem: "modified" },
    ],
  );
});

test("does not flag a new migration that has not been applied yet", () => {
  // Adding a migration must not require touching the lockfile first, otherwise
  // the guard cannot be run before committing a new change.
  assert.deepEqual(
    findIntegrityFailures(
      { "20260415000000_a.sql": "aaa" },
      {
        "20260415000000_a.sql": "aaa",
        "20260928000000_brand_new.sql": "unlocked",
      },
    ),
    [],
  );
});

test("an empty lockfile reports nothing rather than everything", () => {
  assert.deepEqual(
    findIntegrityFailures({}, { "20260415000000_a.sql": "aaa" }),
    [],
  );
});
