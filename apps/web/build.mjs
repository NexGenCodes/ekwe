import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync, watch } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog, escapeHtml } from "../../scripts/changelog-lib.mjs";

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

function readSharedVersion() {
  const versionTsPath = join(__dirname, "../../packages/shared/version.ts");
  if (!existsSync(versionTsPath)) return null;
  const content = readFileSync(versionTsPath, "utf-8");
  const match = content.match(/APP_VERSION\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function readConfig() {
  const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8"));
  const fileEnv = loadEnvFile();
  const email = process.env.CONTACT_EMAIL || fileEnv.CONTACT_EMAIL || config.contact.email;
  if (email) config.contact.email = email;
  const sharedVersion = readSharedVersion();
  if (sharedVersion) config.app.version = sharedVersion;
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

// Renders the landing-site changelog page from CHANGELOG.md, which is the
// single source of truth. Entries are drawn newest-first; [Unreleased] is
// dropped; the newest release is tagged "Latest" and versions below 2.x get
// the "Legacy" tag.
function renderChangelogList(changelogPath) {
  const markdown = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  const released = parseChangelog(markdown).filter((e) => !/^unreleased$/i.test(e.version));

  if (released.length === 0) return "";

  return released
    .map((entry, index) => {
      const isLatest = index === 0;
      const legacy = /^1\.[01]/.test(entry.version);
      const tags = [];
      if (isLatest) tags.push(`<span class="tag">Latest</span>`);
      if (legacy) tags.push(`<span class="tag legacy">Legacy</span>`);

      const sections = entry.sections
        .map((section) => {
          const items = section.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
          return `<h3>${escapeHtml(section.name)}</h3>\n<ul>\n${items}\n</ul>`;
        })
        .join("\n");

      return [
        `<div class="changelog-entry">`,
        `  <div class="changelog-version">`,
        `    <h2>v${escapeHtml(entry.version)}</h2>`,
        tags.map((t) => `    ${t}`).join("\n"),
        `  </div>`,
        `  <p class="changelog-date">${escapeHtml(entry.date)}</p>`,
        sections,
        `</div>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
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
  copyFileSync(join(__dirname, "src/logo.png"), join(dist, "logo.png"));

  // Copy config.json for JS to read
  writeFileSync(join(dist, "config.json"), JSON.stringify(config, null, 2));

  // Render HTML pages
  const pages = readdirSync(src).filter((f) => f.endsWith(".html"));

for (const page of pages) {
    let html = readFileSync(join(src, page), "utf8");
    let rendered = renderTemplate(html, config);

    if (page === "changelog.html") {
      const list = renderChangelogList(join(__dirname, "../../CHANGELOG.md"));
      if (list) {
        rendered = rendered.replace('<div class="changelog-list" data-changelog></div>', `<div class="changelog-list">\n${list}\n        </div>`);
      }
    }

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
