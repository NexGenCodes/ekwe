#!/usr/bin/env node
import { execSync } from "node:child_process";

const run = (cmd, opts = {}) => {
  const result = execSync(cmd, {
    stdio: ["ignore", "pipe", "inherit"],
    ...opts,
  });
  return result ? result.toString().trim() : "";
};

// ── 1. Show what changed ──────────────────────────────────────────
console.log("\nChanges vs origin/master:\n");

try {
  run("git fetch origin master --depth=1", { stdio: "ignore" });
} catch {
  // Already fetched or no remote
}

const diff = run("git diff --name-only origin/master...HEAD || echo ''");
if (diff) {
  diff.split("\n").forEach((f) => console.log(`  ${f}`));
  console.log();
} else {
  console.log("  (no changes)\n");
}

// ── 2. Preview supabase migrations (never applies anything) ───────
// Migrations are applied automatically by the `migrate` job in deploy.yml
// when supabase/migrations/** changes, so this hook only shows you what CI
// will run. A pending migration here is fine — it ships with the push.
console.log(
  "Previewing Supabase migrations (dry-run, nothing is applied)...\n",
);
try {
  run("supabase db push --linked --dry-run --include-all", {
    env: {
      ...process.env,
      SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD ?? "",
    },
  });
  console.log(
    "\n✔ Migrations in sync (or nothing pending). They are applied in CI.\n",
  );
} catch {
  console.log(
    "\nℹ Pending migrations or link issue — CI's 'Apply DB migrations' job will handle them.\n",
  );
}
