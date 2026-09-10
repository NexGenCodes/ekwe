import fs from 'node:fs';
import path from 'node:path';

// Single source of truth for the downloadable APK: apps/web/config.json.
// The download link there is the full URL to app-release.apk; the bucket base
// is derived from it so the manifest can never drift from the landing page.
const webConfig = JSON.parse(fs.readFileSync(path.resolve('apps/web/config.json'), 'utf8'));
const downloadLink = webConfig.links?.download;
if (typeof downloadLink !== 'string' || !downloadLink.startsWith('https://')) {
  throw new Error('generate-update-manifest: invalid apps/web/config.json links.download');
}
const BASE_URL = downloadLink.slice(0, downloadLink.lastIndexOf('/'));

const version = process.argv[2];
const versionCode = Number(process.argv[3]);
const sha256 = process.argv[4];
const size = Number(process.argv[5]);
const date = new Date().toISOString().split('T')[0];

const manifest = {
  latest_version: version,
  latest_version_code: versionCode,
  min_supported_version_code: 1,
  download_url: `${BASE_URL}/app-release.apk`,
  checksum_sha256: sha256,
  file_size: size,
  release_notes: "",
  release_date: date,
  force_update: false,
};

const outDir = path.resolve('dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');