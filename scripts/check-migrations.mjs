#!/usr/bin/env node

/**
 * Guard the Supabase migration directory against foreign writers.
 *
 * `supabase/migrations/` is owned by the Supabase CLI. The CLI reads a file's
 * name as its version — the `YYYYMMDDHHMMSS_` prefix — and applies files in
 * version order. Anything it cannot parse, or any file it does not know about,
 * is either silently ignored or applied at the wrong point in the sequence.
 *
 * Drizzle used to write here too. `packages/db/drizzle.config.ts` pointed its
 * `out` at this directory, which put Drizzle's `0002_foo.sql` naming next to the
 * CLI's `20260926130000_foo.sql`. That was not caught for weeks, because the
 * only migration gate in CI was `drizzle-kit check`, which validates Drizzle's
 * journal against Drizzle's snapshots and ignores every file it does not
 * declare. It reported "Everything's fine" over 56 files, 54 of which it had
 * never read.
 *
 * Drizzle's Postgres migration commands are now removed. The local SQLite
 * layer still generates its own migrations into `apps/mobile/drizzle/` via
 * `drizzle.local.config.ts`, which is a different directory and is not checked
 * here. This guard exists so the collision cannot come back unnoticed.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = join(ROOT_DIR, "supabase", "migrations");

/** The Supabase CLI's convention: a 14-digit version, then a snake_case name. */
export const CONVENTION = /^\d{14}_[a-z0-9_]+\.sql$/;

/**
 * Migrations that have been applied, with a checksum of each file's contents.
 * Written by `scripts/lock-migrations.mjs`, which `pnpm db:migrate` chains.
 */
export const CHECKSUMS_FILE = join(MIGRATIONS_DIR, "checksums.json");

/**
 * Files that predate the convention and are already recorded in the remote
 * migration history. Deleting them would make the CLI see local versions
 * missing from a remote that has them, which fails the next `db push`. They are
 * listed by name so that removing one is a deliberate, reviewable edit rather
 * than something that happens by accident.
 */
export const ALLOWED_LEGACY = new Set([
  // Drizzle's no-op baseline. The DDL that actually created these tables lives
  // in the timestamped Supabase migrations.
  "0000_baseline.sql",
  // Re-creates three history RLS policies that the timestamped migrations
  // already create. Present in the remote history via `supabase db push
  // --include-all` in the deploy workflow, which inserts history rows for
  // versions that predate the remote journal without executing them.
  "0001_bent_carmella_unuscione.sql",
]);

/**
 * @param {string[]} filenames
 * @returns {string[]} filenames that violate the convention and are not allowed
 */
export function findViolations(filenames) {
  return filenames
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !CONVENTION.test(name))
    .filter((name) => !ALLOWED_LEGACY.has(name))
    .sort();
}

/**
 * Compare the applied-migration lockfile against the files on disk.
 *
 * The Supabase CLI records the *version* of each applied migration and no
 * checksum of its contents, so editing an applied migration changes nothing it
 * can see: the file still applies under the same version it always had, the
 * remote stays at that version, and the edit silently never runs. That is how
 * `20260926010000_add_history_origin.sql` ended up disagreeing with the live
 * `history` table. This check is the missing enforcement.
 *
 * @param {Record<string, string>} locked checksum recorded at push time
 * @param {Record<string, string>} current checksum of the file on disk
 * @returns {{ name: string, problem: "deleted" | "modified" }[]}
 */
export function findIntegrityFailures(locked, current) {
  const failures = [];
  for (const name of Object.keys(locked).sort()) {
    if (!(name in current)) failures.push({ name, problem: "deleted" });
    else if (current[name] !== locked[name])
      failures.push({ name, problem: "modified" });
  }
  return failures;
}

function hashMigrations(filenames) {
  const current = {};
  for (const name of filenames) {
    if (!name.endsWith(".sql")) continue;
    const bytes = readFileSync(join(MIGRATIONS_DIR, name));
    current[name] = createHash("sha256").update(bytes).digest("hex");
  }
  return current;
}

function readLockfile() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CHECKSUMS_FILE, "utf8"));
  } catch (err) {
    console.error(
      `Could not read ${CHECKSUMS_FILE}: ${err.message}\n\n` +
        "The checksum lockfile records what has been applied, so that editing an\n" +
        "applied migration can be caught. Without it this check cannot run.\n" +
        "Restore the file, or regenerate it with `pnpm db:migrations:lock`.",
    );
    process.exit(2);
  }
  if (typeof parsed?.files !== "object" || parsed.files === null) {
    console.error(
      `${CHECKSUMS_FILE} does not contain a \`files\` object. ` +
        "Regenerate it with `pnpm db:migrations:lock`.",
    );
    process.exit(2);
  }
  return parsed.files;
}

function main() {
  let filenames;
  try {
    filenames = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    console.error(
      `Could not read ${MIGRATIONS_DIR}: ${err.message}\n` +
        "Is this script being run from a checkout of the repository?",
    );
    process.exit(2);
  }

  const violations = findViolations(filenames);
  if (violations.length > 0) {
    reportNamingViolations(filenames, violations);
    return;
  }

  const locked = readLockfile();
  const failures = findIntegrityFailures(locked, hashMigrations(filenames));
  if (failures.length === 0) {
    console.log(
      `Migration directory OK — ${filenames.filter((n) => n.endsWith(".sql")).length} files, all Supabase-convention named, ` +
        `${Object.keys(locked).length} applied migration(s) match their recorded checksums.`,
    );
    return;
  }

  console.error(
    `Migration integrity check failed for ${failures.length} applied migration(s):\n`,
  );
  for (const { name, problem } of failures) {
    console.error(`  - ${name} was ${problem} after being applied`);
  }
  console.error(
    "\nThe Supabase CLI identifies a migration by the version in its filename and\n" +
      "stores no checksum of its contents. An applied migration that is edited here\n" +
      "will never run against the database, while still appearing to be up to date.\n" +
      "That is how history.source_app drifted from the schema.\n\n" +
      "To change a database that is already migrated, add a NEW forward migration\n" +
      "named YYYYMMDDHHMMSS_snake_case_name.sql. Do not edit the applied file, and do\n" +
      "not run `pnpm db:migrations:lock` to make this pass — that discards the only\n" +
      "record that the change happened.",
  );
  process.exit(1);
}

function reportNamingViolations(filenames, violations) {
  const numbered = filenames.filter((n) => n.endsWith(".sql")).length;
  console.error(
    `Migration directory has ${violations.length} file(s) the Supabase CLI cannot order:\n`,
  );
  for (const name of violations) console.error(`  - ${name}`);
  console.error(
    `\nOf ${numbered} SQL files, only those named YYYYMMDDHHMMSS_name.sql are\n` +
      "applied by the Supabase CLI. A file that breaks the convention is either\n" +
      "skipped or applied out of order, and nothing else will tell you.\n\n" +
      "If this file came from Drizzle, the local SQLite generator was pointed at\n" +
      "the wrong directory. It must write to apps/mobile/drizzle/ via\n" +
      "drizzle.local.config.ts — run `pnpm db:generate:local` for that.\n\n" +
      "If it is genuinely a Supabase migration, rename it to\n" +
      "YYYYMMDDHHMMSS_snake_case_name.sql. If it is one of the two known\n" +
      "pre-convention files, add its exact name to ALLOWED_LEGACY in\n" +
      "scripts/check-migrations.mjs.",
  );
  process.exit(1);
}

// Only run when invoked directly, so the test can import the helpers.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
