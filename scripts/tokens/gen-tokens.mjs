#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { renderDesignTokensSwift, renderEchoDesignTokensKotlin } =
  require("./native-tokens.cjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = resolve(__dirname, "../../packages/shared/src/token");
const OUT_DIR = resolve(__dirname, "../../apps/mobile/targets/share");
const OUT_FILE = resolve(OUT_DIR, "DesignTokens.swift");
const SNAPSHOT_FILE = resolve(
  __dirname,
  "../../apps/mobile/modules/ekwe-native/native-tokens.json",
);
const KOTLIN_PACKAGE_DIR =
  "apps/mobile/modules/ekwe-native/android/src/main/java/expo/modules/ekwenative";
const KOTLIN_OUT_FILE = resolve(__dirname, `../../${KOTLIN_PACKAGE_DIR}/EchoDesignTokens.kt`);

const importTs = async (file) => {
  const url = pathToFileURL(resolve(TOKENS_DIR, `${file}.ts`)).href;
  return import(url);
};

const { lightColors, darkColors } = await importTs("colors");
const { spacing } = await importTs("spacing");
const { borderRadius, iconSize, touchTarget, opacity, zIndex } =
  await importTs("sizes");
const { typography } = await importTs("typography");
const { duration } = await importTs("motion");

const snapshot = {
  colors: { lightColors, darkColors },
  spacing,
  borderRadius,
  iconSize,
  touchTarget,
  opacity,
  zIndex,
  typography,
  duration,
};

const swift = renderDesignTokensSwift(snapshot);
const kotlin = renderEchoDesignTokensKotlin(snapshot);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, swift, "utf8");
console.log(`Wrote ${OUT_FILE} (${swift.length} bytes)`);

await writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
console.log(`Wrote ${SNAPSHOT_FILE} (design tokens snapshot)`);

await mkdir(resolve(__dirname, `../../${KOTLIN_PACKAGE_DIR}`), { recursive: true });
await writeFile(KOTLIN_OUT_FILE, kotlin, "utf8");
console.log(`Wrote ${KOTLIN_OUT_FILE} (${kotlin.length} bytes)`);