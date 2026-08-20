import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, watch } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "src");
const dist = join(__dirname, "dist");

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadEnvFile() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function readConfig() {
  const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8"));
  const fileEnv = loadEnvFile();
  const email = process.env.CONTACT_EMAIL || fileEnv.CONTACT_EMAIL || config.contact.email;
  if (email) config.contact.email = email;
  return config;
}

function renderTemplate(html, config) {
  const year = new Date().getFullYear();
  return html
    .replace(/\{\{APP_NAME\}\}/g, config.app.name)
    .replace(/\{\{APP_TAGLINE\}\}/g, config.app.tagline)
    .replace(/\{\{APP_DESCRIPTION\}\}/g, config.app.description)
    .replace(/\{\{APP_VERSION\}\}/g, config.app.version)
    .replace(/\{\{DOWNLOAD_URL\}\}/g, config.links.download)

    .replace(/\{\{CONTACT_EMAIL\}\}/g, config.contact.email)
    .replace(/\{\{COMPANY_NAME\}\}/g, config.legal.companyName)
    .replace(/\{\{LAST_UPDATED\}\}/g, config.legal.lastUpdated)
    .replace(/\{\{YEAR\}\}/g, year);
}

function build() {
  const config = readConfig();
  ensureDir(dist);
  ensureDir(join(dist, "css"));
  ensureDir(join(dist, "js"));
  ensureDir(join(dist, "pages"));

  // Copy static assets
  copyFileSync(join(__dirname, "src/css/style.css"), join(dist, "css/style.css"));
  copyFileSync(join(__dirname, "src/js/main.js"), join(dist, "js/main.js"));
  copyFileSync(join(__dirname, "src/favicon.svg"), join(dist, "favicon.svg"));
  copyFileSync(join(__dirname, "src/og-image.png"), join(dist, "og-image.png"));

  // Copy config.json for JS to read
  writeFileSync(join(dist, "config.json"), JSON.stringify(config, null, 2));

  // Render HTML pages
  const pages = readdirSync(src).filter((f) => f.endsWith(".html"));

  for (const page of pages) {
    const html = readFileSync(join(src, page), "utf-8");
    const rendered = renderTemplate(html, config);

    if (page === "index.html") {
      writeFileSync(join(dist, page), rendered);
    } else {
      writeFileSync(join(dist, "pages", page), rendered);
    }
  }

  console.log(`Built ${pages.length} pages → dist/`);
}

const isWatch = process.argv.includes("--watch");

if (isWatch) {
  build();
  console.log("Watching for changes...");
  watch(join(__dirname, "src"), { recursive: true }, () => {
    try {
      build();
    } catch (e) {
      console.error("Build error:", e.message);
    }
  });
} else {
  build();
}
