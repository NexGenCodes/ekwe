#!/usr/bin/env node
import { execSync } from "node:child_process";

const run = (cmd, opts = {}) => {
  const result = execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], ...opts });
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

// ── 2. Push supabase migrations (auto no-op if nothing new) ──────
console.log("Checking Supabase migrations...\n");
try {
  run("supabase db push --linked", { stdio: "inherit" });
} catch {
  console.warn("⚠  Supabase not linked or push failed. Run 'pnpm db:link' first.\n");
}

// ── 3. Lint ───────────────────────────────────────────────────────
console.log("\nRunning lint...\n");
try {
  run("pnpm lint", { stdio: "inherit" });
} catch {
  console.error("\n❌ Lint failed. Fix errors before pushing.\n");
  process.exit(1);
}

// ── 4. Typecheck ──────────────────────────────────────────────────
console.log("\nRunning typecheck...\n");
try {
  run("pnpm typecheck", { stdio: "inherit" });
} catch {
  console.error("\n❌ Typecheck failed. Fix errors before pushing.\n");
  process.exit(1);
}
