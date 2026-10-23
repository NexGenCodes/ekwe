#!/usr/bin/env node
import { execSync } from "node:child_process";

const run = (cmd, opts = {}) => {
  const result = execSync(cmd, {
    stdio: ["ignore", "pipe", "inherit"],
    ...opts,
  });
  return result ? result.toString().trim() : "";
};

try {
  run("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
    stdio: "ignore",
  });
  console.log("↓ Rebase: pulling latest remote changes...\n");
  run("git pull --rebase --autostash", { stdio: "inherit" });
  console.log("✔ Rebased local commits onto the latest remote state.\n");
} catch {
  console.log(
    "⚠ No upstream / rebase failed. If a conflict is in progress, resolve it\n" +
      "  (or `git rebase --abort`) and push again.\n",
  );
}

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

console.log("Checking D1 migration directory (naming + ordering)...\n");
try {
  run("node scripts/check-migrations.mjs", {});
  console.log();
} catch {
  // Do not warn-and-continue here. A duplicate numeric prefix or a malformed
  // filename makes Wrangler's apply order unpredictable. The fix is a new
  // forward migration with a unique prefix.
  process.exit(1);
}

console.log(
  "D1 migrations are applied by the deploy workflow before the Worker ships.\n",
);
