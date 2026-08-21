const fs = require('fs');
const path = require('path');

const version = process.argv[2];
const versionCode = Number(process.argv[3]);
const sha256 = process.argv[4];
const size = Number(process.argv[5]);
const date = new Date().toISOString().split('T')[0];
const downloadUrl = "https://pub-dcd31dbfad344d278cc48d4601c658fc.r2.dev/app-release.apk";

const manifest = {
  latest_version: version,
  latest_version_code: versionCode,
  min_supported_version_code: 1,
  download_url: downloadUrl,
  checksum_sha256: sha256,
  file_size: size,
  release_notes: "",
  release_date: date,
  force_update: false
};

fs.writeFileSync(path.resolve('version.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.resolve('dist/version.json'), JSON.stringify(manifest, null, 2) + '\n');
