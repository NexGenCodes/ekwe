#!/usr/bin/env node
/**
 * Icon codegen: reads the single logo source (apps/mobile/assets/ekwe-logo.svg)
 * and the brand colors from packages/shared/token/colors.ts, then
 * renders every icon PNG variant used by app.json.
 *
 * Run with `pnpm gen:icons`.
 *
 * - Variants (paths match apps/mobile/app.json):
 *   icon.png                   legacy app icon (light bg, brand glyph)
 *   adaptive-icon.png          Android adaptive FOREGROUND (transparent, safe zone)
 *   monochrome.png             Android 13+ themed icon (transparent, on-color glyph)
 *   notification-icon.png      Android notification small icon (white glyph, transparent)
 *   splash-icon.png              splash (brand glyph; bg color from app.json)
 *
 * Splash icons are transparent glyphs — the splash background color always
 * comes from app.json (`expo-splash-screen.backgroundColor` / `dark.backgroundColor`),
 * and the glyph + `imageWidth` config control how it renders. A single splash
 * glyph is used for both light and dark themes (the background color swaps).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ASSETS = path.resolve(ROOT, "apps/mobile/assets");
const SVG_SRC = path.join(ASSETS, "ekwe-logo.svg");
const SIZE = 1024;

// -- Brand colors from the shared design tokens (single source of truth) ---
const { lightColors } = await import(
  pathToFileURL(path.resolve(ROOT, "packages/shared/token/colors.ts")).href
);
const BRAND = lightColors.brand;
const LIGHT_BG = lightColors.background;

// Logo glyph content is centered around (50, 50) in a 100x100 viewBox.
const GLYPH_CENTER = [50.5, 49.5];

// Launcher icons are single variants (no light/dark). The splash uses a single
// transparent glyph sized by the app.json `imageWidth`; the plugin composes it
// onto the theme background color.
const VARIANTS = [
  { file: "icon.png", background: LIGHT_BG, glyph: BRAND, scale: 9.7 },
  { file: "adaptive-icon.png", background: null, glyph: BRAND, scale: 6.7 },
  { file: "monochrome.png", background: null, glyph: "#FFFFFF", scale: 6.7 },
  { file: "notification-icon.png", background: null, glyph: "#FFFFFF", scale: 8.5 },
  { file: "splash-icon.png", background: null, glyph: BRAND, scale: 4.6 },
];

function confirmInstalled(bin) {
  try {
    execFileSync(`command -v ${bin}`, { shell: "/bin/sh", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pickRenderer() {
  if (confirmInstalled("inkscape")) return "inkscape";
  if (confirmInstalled("rsvg-convert")) return "rsvg";
  if (confirmInstalled("convert")) return "convert";
  return "sharp";
}

function render(renderer, svgPath, pngPath) {
  if (renderer === "inkscape") {
    execFileSync("inkscape", [svgPath, `--export-filename=${pngPath}`, "-w", String(SIZE), "-h", String(SIZE)], { stdio: "ignore" });
  } else if (renderer === "rsvg") {
    execFileSync("rsvg-convert", ["-w", String(SIZE), "-h", String(SIZE), svgPath, "-o", pngPath], { stdio: "ignore" });
  } else if (renderer === "convert") {
    execFileSync("convert", ["-background", "none", "-density", "400", svgPath, "-resize", `${SIZE}x${SIZE}`, pngPath], { stdio: "ignore" });
  } else {
    throw new Error("Add `sharp` to devDependencies to render icons locally.");
  }
}

function composeVariant({ background, glyph, scale }) {
  const source = readFileSync(SVG_SRC, "utf8");
  const glyphMarkup = (source.match(/<g id="glyph">([\s\S]*?)<\/g>/) ?? [])[1] ?? "";
  const dx = SIZE / 2 - GLYPH_CENTER[0] * scale;
  const dy = SIZE / 2 - GLYPH_CENTER[1] * scale;
  const backgroundRect = background
    ? `  <rect width="${SIZE}" height="${SIZE}" fill="${background}"/>\n`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
${backgroundRect}  <g color="${glyph}" transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${scale})" fill="none" stroke-linecap="round">${glyphMarkup}</g>
</svg>`;
}

function main() {
  if (!existsSync(SVG_SRC)) {
    console.error(`Logo source not found: ${SVG_SRC}`);
    process.exit(1);
  }
  if (process.env.CI) {
    console.log(
      "Skipping icon generation in CI (icon PNGs are committed; regenerate locally with `pnpm gen:icons` when the logo or brand colors change)."
    );
    process.exit(0);
  }
  const renderer = pickRenderer();
  const tmp = path.join(os.tmpdir(), `ekwe-icons-${process.pid}`);
  mkdirSync(tmp, { recursive: true });

  console.log(`Rendering ${VARIANTS.length} icon(s) from ekwe-logo.svg with "${renderer}"...`);
  for (const variant of VARIANTS) {
    const svgPath = path.join(tmp, variant.file.replace(/\.png$/, ".svg"));
    const pngPath = path.join(ASSETS, variant.file);
    writeFileSync(svgPath, composeVariant(variant));
    render(renderer, svgPath, pngPath);
    const kb = (readFileSync(pngPath).length / 1024).toFixed(1);
    console.log(`  ✓ ${variant.file} (${kb} KB)`);
  }
  console.log(`Done. PNGs refreshed in ${path.relative(ROOT, ASSETS)}/.`);
}

main();