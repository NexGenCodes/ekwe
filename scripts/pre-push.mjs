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
