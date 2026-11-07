import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "../../../scripts/changelog-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const siteUrl = "https://ekwe.pages.dev";

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// 1. changelog.ts (build-time from CHANGELOG.md, single source of truth)
const mdPath = join(root, "../../CHANGELOG.md");
const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
const released = parseChangelog(md).filter((e) => !/^unreleased$/i.test(e.version));

// Hard gate: the site must never deploy with Latest != current app version.
const versionTsPath = join(root, "../../packages/shared/src/version.ts");
const versionSrc = readFileSync(versionTsPath, "utf8");
const appVersion = versionSrc.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!appVersion) {
  console.error("[generate] could not parse APP_VERSION from version.ts");
  process.exit(1);
}
if (released.length === 0) {
  console.error("[generate] no released changelog entries found");
  process.exit(1);
}
if (released[0].version !== appVersion) {
  console.error(
    `[generate] Changelog Latest v${released[0].version} != APP_VERSION v${appVersion}. ` +
      `Add a ## [${appVersion}] entry to CHANGELOG.md before building.`,
  );
  process.exit(1);
}

const outTs = `// AUTO-GENERATED from CHANGELOG.md — do not edit. Run: pnpm build
export interface ChangelogSection { name: string; items: string[] }
export interface ChangelogEntry { version: string; date: string; sections: ChangelogSection[] }
export const changelog: ChangelogEntry[] = ${JSON.stringify(released, null, 2)};

export function entryTags(index: number, version: string): string[] {
  const tags: string[] = [];
  if (index === 0) tags.push("Latest");
  if (/^1\\.[01]/.test(version)) tags.push("Legacy");
  return tags;
}
`;

ensureDir(join(root, "src/data"));
writeFileSync(join(root, "src/data/changelog.ts"), outTs);
console.log(`changelog: ${released.length} entries → src/data/changelog.ts`);

// 2. public/robots.txt + sitemap.xml
ensureDir(join(root, "public"));
const today = new Date().toISOString().slice(0, 10);
const sitemapPages = [
  { loc: "/", priority: "1.0", changefreq: "weekly" },
  { loc: "/changelog", priority: "0.4", changefreq: "monthly" },
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPages
  .map((p) => `  <url>\n    <loc>${siteUrl}${p.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`)
  .join("\n")}\n</urlset>\n`;
writeFileSync(join(root, "public/sitemap.xml"), sitemap);

const robots = `User-agent: *\nAllow: /\nDisallow: /privacy\nDisallow: /terms\nDisallow: /admin\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
writeFileSync(join(root, "public/robots.txt"), robots);
console.log("robots.txt + sitemap.xml → public/");

// 3. public/_headers + _redirects (Pages SPA fallback for BrowserRouter)
const headers = `/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), geolocation=(), microphone=()
  Cross-Origin-Referrer-Policy: same-origin

/admin/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'

/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
`;
writeFileSync(join(root, "public/_headers"), headers);
writeFileSync(
  join(root, "public/_redirects"),
  "/pages/privacy.html /privacy 301\n/pages/terms.html /terms 301\n/pages/changelog.html /changelog 301\n/* /index.html 200\n",
);
console.log("_headers + _redirects → public/");

// 4. public/_routes.json — keep the site fully static except the admin API
// Function, so Pages only bills/invokes a Function for /admin/api/*.
writeFileSync(
  join(root, "public/_routes.json"),
  `${JSON.stringify({ version: 1, include: ["/admin/api/*"], exclude: [] }, null, 2)}\n`,
);
console.log("_routes.json → public/");
