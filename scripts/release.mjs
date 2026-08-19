#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const level = process.argv[2] || "patch";
if (!["patch", "minor", "major"].includes(level)) {
  console.error("Usage: pnpm release [patch|minor|major]");
  process.exit(1);
}

const run = (cmd) =>
  execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

const mobileDir = "apps/mobile";

// The version currently in app.json is the source of truth (no tags involved).
const base = JSON.parse(readFileSync(`${mobileDir}/app.json`, "utf8")).expo.version;
const [maj, min, pat] = base.split(".").map(Number);
const next =
  level === "major"
    ? `${maj + 1}.0.0`
    : level === "minor"
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;

const [M, m, p] = next.split(".").map(Number);
const versionCode = M * 10000 + m * 100 + p;

const appJsonPath = `${mobileDir}/app.json`;
const pkgJsonPath = `${mobileDir}/package.json`;

const app = JSON.parse(readFileSync(appJsonPath, "utf8"));
app.expo.version = next;
app.expo.android.versionCode = versionCode;
writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + "\n");

const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
pkg.version = next;
writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");

run(`git add ${appJsonPath} ${pkgJsonPath}`);
run(`git commit -m "chore: release v${next}"`);
run("git push");

console.log(`\nReleased v${next} (versionCode ${versionCode}).`);
console.log("Pushed to master — CI will detect the app.json change, build the APK,");
console.log("create the GitHub Release, and notify all registered devices automatically.");