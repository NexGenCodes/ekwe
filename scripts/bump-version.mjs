import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const currentVersion = process.argv[2];
const nextVersionOutFile = process.argv[3];
const bumpType = (process.argv[4] || 'patch').toLowerCase();

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Unknown bump type "' + bumpType + '" (expected patch, minor or major).');
  process.exit(1);
}

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
} else if (bumpType === 'major') {
  cur[0] += 1;
  cur[1] = 0;
  cur[2] = 0;
  NEXT = cur.join('.');
} else if (bumpType === 'minor') {
  cur[1] += 1;
  cur[2] = 0;
  NEXT = cur.join('.');
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

updateJson('./apps/mobile/package.json', k => { k.version = NEXT; });
updateJson('./package.json', rk => { rk.version = NEXT; });
updateJson('./apps/web/config.json', w => { if (w.app) w.app.version = NEXT; });
updateJson('./apps/web/package.json', w => { w.version = NEXT; });


const versionTsPath = path.resolve('./packages/shared/src/version.ts');
const versionTs = [
  '/** Single source of truth for the Ekwe app version. */',
  `export const APP_VERSION = "${NEXT}" as const;`,
  '',
  '/**',
  ' * Numeric version code derived from the semver string.',
  ' * Formula: MAJOR * 10000 + MINOR * 100 + PATCH',
  ' * Must stay < 1_000_000 (each segment < 100).',
  ' */',
  `export const APP_VERSION_CODE = ${VC} as const;`,
  '',
].join('\n');
fs.writeFileSync(versionTsPath, versionTs);

fs.writeFileSync(path.resolve(nextVersionOutFile), `NEXT=${NEXT}\nVC=${VC}\nTAG=v${NEXT}\n`);
