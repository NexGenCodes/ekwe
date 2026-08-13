#!/usr/bin/env node
/**
 * Manual native-env codegen for the iOS share Extension.
 *
 * Renders `apps/mobile/targets/share/EchoEnvironment.swift` from the PUBLIC
 * `EXPO_PUBLIC_*` keys in `apps/mobile/.env` plus the canonical
 * `MAX_AUDIO_BYTES` from `packages/shared/plans.ts`. Shared logic lives in
 * `scripts/tokens/native-env.cjs`.
 *
 * Prebuild note: `expo prebuild` regenerates this file itself via
 * app.plugin.js (withDangerousMod), so this manual script is only for local
 * dev/iteration and CI parity. Run with `pnpm gen:env`.
 */
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { generateEchoEnvironment } = require("./native-env.cjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");
const ENV_PATH = resolve(ROOT, "apps/mobile/.env");
const OUT_DIR = resolve(ROOT, "apps/mobile/targets/share");
const OUT_FILE = resolve(OUT_DIR, "EchoEnvironment.swift");
const PLANS_URL = pathToFileURL(resolve(ROOT, "packages/shared/plans.ts")).href;

/** Keys the share extension *requires* — the build fails without them. */
const REQUIRED = [
  "EXPO_PUBLIC_WORKER_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
];

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

  const { MAX_AUDIO_BYTES } = await import(PLANS_URL);

  const swift = generateEchoEnvironment(env, MAX_AUDIO_BYTES);
  await writeFile(OUT_FILE, swift, "utf8");

  const publicKeys = Object.keys(env).filter((k) => k.startsWith("EXPO_PUBLIC_"));
  console.log(`Wrote ${OUT_FILE} (${swift.length} bytes)`);
  console.log(`  keys: ${publicKeys.length} EXPO_PUBLIC_* (${REQUIRED.length} required)`);
  console.log(`  maxAudioBytes=${MAX_AUDIO_BYTES}`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});