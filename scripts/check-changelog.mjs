#!/usr/bin/env node
/**
 * Guard: APP_VERSION must have a matching ## [x.y.z] entry in CHANGELOG.md.
 * Without this, auto-bump releases ship a site whose "Latest" != current version.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(HERE, "..");

export function getAppVersion(root = ROOT_DIR) {
  const src = readFileSync(join(root, "packages/shared/src/version.ts"), "utf8");
  return src.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

export function validateChangelog(version, markdown) {
  if (!version) return ["could not parse APP_VERSION from version.ts"];
  if (!markdown) return ["CHANGELOG.md is empty or missing"];
  const heading = new RegExp("^## \\[" + version.replaceAll(".", "\\.") + "\\]", "m");
  if (!heading.test(markdown)) {
    return [`APP_VERSION v${version} has no ## [${version}] entry in CHANGELOG.md`];
  }
  return [];
}

export function runCheck(root = ROOT_DIR) {
  const version = getAppVersion(root);
  const md = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  return validateChangelog(version, md);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = runCheck();
  if (problems.length) {
    console.error("[check-changelog] " + problems.join("\n[check-changelog] "));
    process.exit(1);
  }
  console.log("[check-changelog] APP_VERSION matches CHANGELOG.md");
}
