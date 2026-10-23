#!/usr/bin/env node

/**
 * Seeds the `app_config` row the worker reads for pricing and the payment
 * provider.
 *
 * `app_config` is created by migration 0003 with empty defaults, so a fresh
 * D1 database answers `/billing/checkout` with 503 (no local prices) and
 * reports the dead RevenueCat provider. This writes the shared price table
 * (the same values the client renders) plus the Flutterwave provider flags.
 *
 * Usage:
 *   node scripts/seed-app-config.mjs              # remote database
 *   node scripts/seed-app-config.mjs --local      # local .wrangler state
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PLANS_PATH = resolve(ROOT, "packages/shared/src/plans.ts");
const WORKER_DIR = resolve(ROOT, "apps/worker");
const DATABASE_NAME = "ekwe";

const local = process.argv.includes("--local");

/**
 * Loads plans.ts through the esbuild binary. The shared package is TypeScript
 * with extensionless relative imports, which Node's ESM loader cannot resolve,
 * so it is bundled to a temporary module first.
 */
const loadPlans = async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "ekwe-seed-"));
  const outfile = resolve(dir, "plans.mjs");
  try {
    execFileSync(
      resolve(ROOT, "apps/mobile/node_modules/.bin/esbuild"),
      [
        PLANS_PATH,
        "--bundle",
        "--format=esm",
        "--platform=node",
        `--outfile=${outfile}`,
      ],
      { stdio: "pipe" },
    );
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

const main = async () => {
  const { LOCAL_PRICES } = await loadPlans();
  const localPrices = JSON.stringify(LOCAL_PRICES);

  const sql = [
    `UPDATE app_config SET`,
    `  local_prices = ${sqlString(localPrices)},`,
    `  flutterwave_enabled = 1,`,
    `  default_provider = 'flutterwave',`,
    `  updated_at = ${Date.now()}`,
    `WHERE id = 1;`,
    "",
    `SELECT id, flutterwave_enabled, default_provider, base_price_usd,`,
    `       annual_discount_percent, local_prices, updated_at`,
    `  FROM app_config WHERE id = 1;`,
  ].join("\n");

  const dir = mkdtempSync(resolve(tmpdir(), "ekwe-seed-sql-"));
  const file = resolve(dir, "seed.sql");
  writeFileSync(file, sql, "utf8");

  try {
    execFileSync(
      resolve(WORKER_DIR, "node_modules/.bin/wrangler"),
      [
        "d1",
        "execute",
        DATABASE_NAME,
        ...(local ? ["--local"] : ["--remote"]),
        `--file=${file}`,
      ],
      { cwd: WORKER_DIR, stdio: "inherit" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    `Seeded app_config (${Object.keys(LOCAL_PRICES).length} currencies, flutterwave enabled).`,
  );
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
