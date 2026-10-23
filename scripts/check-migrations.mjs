#!/usr/bin/env node
/**
 * Guard the Cloudflare D1 migration directory.
 *
 * Wrangler orders D1 migrations by the numeric prefix in the filename and
 * records the applied filename in `d1_migrations`. Two files with the same
 * prefix are applied in an undefined order, and a malformed name can be
 * silently skipped or sorted unpredictably. This check fails before push.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = join(HERE, "..");
export const MIGRATIONS_DIR = join(ROOT_DIR, "apps", "worker", "migrations");

/** Wrangler's convention: 4-digit numeric prefix, underscore, snake_case. */
export const MIGRATION_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Validate a list of filenames (not full paths).
 *
 * Exported so the test suite can exercise the convention without touching the
 * real migration directory.
 */
export function validateMigrationNames(names) {
  const violations = [];
  const prefixes = new Map();

  for (const name of names) {
    if (!name.endsWith(".sql")) {
      violations.push(`${name}: expected a .sql file`);
      continue;
    }

    const match = MIGRATION_PATTERN.exec(name);
    if (!match) {
      violations.push(
        `${name}: expected a 4-digit numeric prefix, an underscore, and a snake_case name (for example 0008_add_index.sql)`,
      );
      continue;
    }

    const prefix = match[1];
    const previous = prefixes.get(prefix);
    if (previous) {
      violations.push(
        `${name}: numeric prefix ${prefix} is already used by ${previous}`,
      );
    } else {
      prefixes.set(prefix, name);
    }
  }

  return violations;
}

export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function main() {
  const names = listMigrations();
  const violations = validateMigrationNames(names);

  if (violations.length > 0) {
    console.error("D1 migration directory has ordering problems:\n");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    console.error(
      "\nFix the filenames before pushing. Wrangler applies D1 migrations in numeric-prefix order.",
    );
    process.exit(1);
  }

  console.log(
    `D1 migration directory OK — ${names.length} files, all with unique 4-digit prefixes.`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
