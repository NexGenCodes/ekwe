import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = "https://pub-dcd31dbfad344d278cc48d4601c658fc.r2.dev";

const version = process.argv[2];
const versionCode = Number(process.argv[3]);
const arm64Sha256 = process.argv[4];
const arm64Size = Number(process.argv[5]);
const armv7Sha256 = process.argv[6];
const armv7Size = Number(process.argv[7]);
const date = new Date().toISOString().split('T')[0];

const manifest = {
  latest_version: version,
  latest_version_code: versionCode,
  min_supported_version_code: 1,
  download_urls: {
    "arm64-v8a": `${BASE_URL}/app-arm64-v8a-release.apk`,
    "armeabi-v7a": `${BASE_URL}/app-armeabi-v7a-release.apk`,
  },
  checksums: {
    "arm64-v8a": arm64Sha256,
    "armeabi-v7a": armv7Sha256,
  },
  file_sizes: {
    "arm64-v8a": arm64Size,
    "armeabi-v7a": armv7Size,
  },
  // Backward compat: armv7 works on both archs
  download_url: `${BASE_URL}/app-armeabi-v7a-release.apk`,
  checksum_sha256: armv7Sha256,
  file_size: armv7Size,
  release_notes: "",
  release_date: date,
  force_update: false,
};

const outDir = path.resolve('dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');
