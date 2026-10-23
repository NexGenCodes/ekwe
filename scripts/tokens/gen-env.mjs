#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { generateEchoEnvironment } = require("./native-env.cjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");
const ENV_PATH = resolve(ROOT, "apps/mobile/.env");
const OUT_DIR = resolve(ROOT, "apps/mobile/targets/share");
const OUT_FILE = resolve(OUT_DIR, "EchoEnvironment.swift");
const PLANS_PATH = resolve(ROOT, "packages/shared/src/plans.ts");

/**
 * Loads plans.ts through the esbuild binary. The shared package is TypeScript
 * with extensionless relative imports, which Node's ESM loader cannot resolve,
 * so it is bundled to a temporary module first.
 */
const loadPlans = async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "ekwe-gen-env-"));
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


const REQUIRED = ["EXPO_PUBLIC_WORKER_URL"];

const parseEnv = (text) => {
  const out = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const eq = stripped.indexOf("=");
    if (eq < 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const main = async () => {
  let envText;
  try {
    envText = readFileSync(ENV_PATH, "utf8");
  } catch (e) {
    throw new Error(`Could not read ${ENV_PATH}: ${e.message}`);
  }
  const env = parseEnv(envText);

  for (const key of REQUIRED) {
    if (!env[key]) {
      throw new Error(
        `gen-env: ${key} is not set in apps/mobile/.env — the iOS share extension needs it at build time.`,
      );
    }
  }

  const {
    MAX_AUDIO_BYTES,
    MAX_AUDIO_INPUT_BYTES,
    PREMIUM_LIMITS,
    WITAI_SAFE_DURATION_MS,
  } = await loadPlans();

  const swift = generateEchoEnvironment(env, MAX_AUDIO_BYTES, {
    maxAudioDurationMs: PREMIUM_LIMITS.dictationDurationMs,
    maxAudioInputBytes: MAX_AUDIO_INPUT_BYTES,
    witVorbisMaxDurationMs: WITAI_SAFE_DURATION_MS,
  });
  await writeFile(OUT_FILE, swift, "utf8");

  const publicKeys = Object.keys(env).filter((k) => k.startsWith("EXPO_PUBLIC_"));
  console.log(`Wrote ${OUT_FILE} (${swift.length} bytes)`);
  console.log(`  keys: ${publicKeys.length} EXPO_PUBLIC_* (${REQUIRED.length} required)`);
  console.log(`  maxAudioBytes=${MAX_AUDIO_BYTES}`);
  console.log(`  maxAudioDurationMs=${PREMIUM_LIMITS.dictationDurationMs}`);
  console.log(`  maxAudioInputBytes=${MAX_AUDIO_INPUT_BYTES}`);
  console.log(`  witVorbisMaxDurationMs=${WITAI_SAFE_DURATION_MS}`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});