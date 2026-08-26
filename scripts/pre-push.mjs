#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], ...opts }).toString().trim();

// ── 1. Change Analysis ──────────────────────────────────────────────
console.log("\n🔍 Analyzing changes vs origin/master...\n");

try {
  run("git fetch origin master --depth=1", { stdio: "ignore" });
} catch {
  // Already fetched or no remote — continue
}

const diff = run("git diff --name-only origin/master...HEAD || git diff --name-only HEAD~1 HEAD || echo ''");

if (!diff) {
  console.log("No changes detected. Skipping checks.\n");
  process.exit(0);
}

const files = diff.split("\n");
const hasMobileSrc = files.some((f) => f.startsWith("apps/mobile/src/"));
const hasMobileNative = files.some(
  (f) =>
    f.startsWith("apps/mobile/app.json") ||
    f.startsWith("apps/mobile/app.config") ||
    f.startsWith("apps/mobile/package.json") ||
    f.startsWith("apps/mobile/android/") ||
    f.startsWith("apps/mobile/ios/") ||
    f.startsWith("apps/mobile/eas.json") ||
    f === "pnpm-lock.yaml" ||
    f === "package.json"
);
const hasWorker = files.some((f) => f.startsWith("apps/worker/"));
const hasSupabase = files.some((f) => f.startsWith("supabase/"));

console.log("Changed files:");
files.forEach((f) => console.log(`  ${f}`));
console.log();

if (hasMobileSrc && !hasMobileNative) {
  console.log("📱 Release type: OTA update only (JS bundle changes)\n");
} else if (hasMobileNative) {
  console.log("📦 Release type: APK release (native/config changes)\n");
} else if (hasWorker) {
  console.log("⚙️  Release type: Worker deploy\n");
}

if (hasSupabase) {
  console.log("🗄️  Supabase changes detected\n");
}

// ── 2. Supabase Migrations ──────────────────────────────────────────
if (existsSync("supabase/config.toml")) {
  console.log("🗄️  Running Supabase migrations...\n");
  try {
    run("cd supabase && supabase db push --linked", { stdio: "inherit" });
    console.log();
  } catch {
    console.warn("⚠️  Supabase migration failed. If not linked, run: pnpm db:link\n");
  }
} else {
  console.log("ℹ️  Supabase not linked locally. Run 'pnpm db:link' to set up.\n");
}

// ── 3. Supabase Migration Status ────────────────────────────────────
if (existsSync("supabase/config.toml")) {
  console.log("📋 Supabase migration status:\n");
  try {
    run("cd supabase && supabase migration list", { stdio: "inherit" });
    console.log();
  } catch {
    console.warn("⚠️  Could not check migration status.\n");
  }
}
