const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const currentVersion = process.argv[2];
const nextVersionOutFile = process.argv[3];

let last = [0, 0, 0];
try {
  const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
  const v = tag.replace(/^v/, '');
  last = v.split('.').map(Number);
} catch (e) {
  // No tags yet
}

const cur = currentVersion.split('.').map(Number);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const c = cmp(cur, last);

let NEXT;
if (c > 0) {
  NEXT = cur.join('.');
} else if (c < 0) {
  console.error('app.json version (' + cur.join('.') + ') is lower than the last release (' + last.join('.') + '). Set it higher.');
  process.exit(1);
} else {
  cur[2] += 1;
  NEXT = cur.join('.');
}

const [M, m, p] = NEXT.split('.').map(Number);
if (M > 99 || m > 99 || p > 99) {
  console.error('::error::Version segments must be < 100 so versionCode stays unique (got ' + NEXT + ').');
  process.exit(1);
}

const VC = M * 10000 + m * 100 + p;

const updateJson = (filePath, updater) => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return;
  const content = fs.readFileSync(resolved, 'utf8');
  const json = JSON.parse(content);
  updater(json);
  fs.writeFileSync(resolved, JSON.stringify(json, null, 2) + '\n');
};

updateJson('./apps/mobile/app.json', j => { j.expo.version = NEXT; j.expo.android.versionCode = VC; });
updateJson('./apps/mobile/package.json', k => { k.version = NEXT; });
updateJson('./package.json', rk => { rk.version = NEXT; });
updateJson('./apps/web/config.json', w => { if (w.app) w.app.version = NEXT; });

fs.writeFileSync(path.resolve(nextVersionOutFile), `NEXT=${NEXT}\nVC=${VC}\nTAG=v${NEXT}\n`);
