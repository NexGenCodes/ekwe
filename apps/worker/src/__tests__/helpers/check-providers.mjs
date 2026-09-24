import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';

const DEFAULT_DEV_VARS = resolve(__dirname, '../../../.dev.vars');

export function loadEnv(path = DEFAULT_DEV_VARS) {
  const envPath = path;
  if (!existsSync(envPath)) return {};
  const text = readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\w+)="?(.+?)"?$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return env;
}

export function getMultiKeys(env, prefix) {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const key = env[`${prefix}${i}`];
    if (key) keys.push(key);
  }
  return keys;
}

export async function checkKey(label, url, options) {
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkWithResult(label, url, options) {
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { label, ok: true };
    const body = await res.text().catch(() => '');
    return { label, ok: false, status: res.status, error: body.slice(0, 60).replace(/\n/g, ' ') };
  } catch (err) {
    return { label, ok: false, error: err.message };
  }
}

export async function testTranslateProviders(env, { groq = false } = {}) {
  const checks = [];

  if (groq) {
    for (const key of getMultiKeys(env, 'GROQ_KEY_')) {
      checks.push(checkWithResult(
        `Groq`, 'https://api.groq.com/openai/v1/models',
        { headers: { Authorization: `Bearer ${key}` } },
      ));
    }
  }
  for (const key of getMultiKeys(env, 'GEMINI_KEY_')) {
    checks.push(checkWithResult(
      `Gemini`,
      `https://generativelanguage.googleapis.com/v1beta/models`,
      { headers: { 'x-goog-api-key': key } },
    ));
  }
  for (const key of getMultiKeys(env, 'COHERE_KEY_')) {
    checks.push(checkWithResult(
      `Cohere`, 'https://api.cohere.ai/v1/models',
      { headers: { Authorization: `Bearer ${key}` } },
    ));
  }
  for (const key of getMultiKeys(env, 'MISTRAL_KEY_')) {
    checks.push(checkWithResult(
      `Mistral`, 'https://api.mistral.ai/v1/models',
      { headers: { Authorization: `Bearer ${key}` } },
    ));
  }
  for (const key of getMultiKeys(env, 'OPENROUTER_KEY_')) {
    checks.push(checkWithResult(
      'OpenRouter', 'https://openrouter.ai/api/v1/auth/key',
      { headers: { Authorization: `Bearer ${key}` } },
    ));
  }

  return Promise.all(checks);
}

export async function testTranscribeProviders(env) {
  const checks = [];

  for (const key of getMultiKeys(env, 'DEEPGRAM_KEY_')) {
    checks.push(checkWithResult(
      `Deepgram`, 'https://api.deepgram.com/v1/projects',
      { headers: { Authorization: `Token ${key}` } },
    ));
  }
  for (const key of getMultiKeys(env, 'ASSEMBLYAI_KEY_')) {
    checks.push(checkWithResult(
      `AssemblyAI`, 'https://api.assemblyai.com/v2/account',
      { headers: { Authorization: key } },
    ));
  }
  for (const key of getMultiKeys(env, 'GLADIA_KEY_')) {
    checks.push(checkWithResult(
      `Gladia`, 'https://api.gladia.io/v2/live',
      { headers: { 'x-gladia-key': key } },
    ));
  }

  const witLangs = ['EN', 'FR', 'ES', 'PT', 'DE', 'IT', 'ZH', 'IG', 'YO', 'HA',
    'AF', 'AK', 'SQ', 'AM', 'AR', 'HY', 'AS', 'AY', 'AZ', 'EU',
    'BE', 'BN', 'BS', 'BR', 'BG', 'MY', 'CA', 'CI', 'CK', 'NY', 'HR', 'CS',
    'DA', 'DV', 'NL', 'EO', 'ET', 'FO', 'FI', 'FF', 'GL', 'LG',
    'KA', 'EL', 'GN', 'GU', 'HT', 'HE', 'HI', 'HU', 'IS', 'ID',
    'IU', 'GA', 'JA', 'JV', 'KL', 'KN', 'KS', 'KK', 'KM', 'RW',
    'KY', 'KO', 'KU', 'LO', 'LA', 'LV', 'LI', 'LN', 'LT', 'MK',
    'MG', 'MS', 'ML', 'MT', 'MI', 'MR', 'MN', 'NE', 'SE', 'NO',
    'NB', 'OR', 'OM', 'PA', 'PS', 'FA', 'PL', 'QU', 'RM', 'RO',
    'RU', 'SA', 'SC', 'GD', 'SR', 'SN', 'SD', 'SI', 'SK', 'SL',
    'SO', 'ST', 'NR', 'SU', 'SW', 'SS', 'SV', 'TL', 'TG', 'TA',
    'TT', 'TE', 'TH', 'BO', 'TI', 'TS', 'TN', 'TR', 'UG', 'UK',
    'UR', 'UZ', 'VE', 'VI', 'CY', 'FY', 'WO', 'XH', 'YI', 'ZU',
  ];
  for (const lang of witLangs) {
    const key = env[`WIT_KEY_${lang}`];
    if (!key) {
      checks.push(Promise.resolve({ label: `Wit.ai ${lang}`, ok: false, error: 'no key configured' }));
      continue;
    }
    checks.push(checkWithResult(
      `Wit.ai ${lang}`,
      `https://api.wit.ai/message?v=20240304&q=hello`,
      { headers: { Authorization: `Bearer ${key}` } },
    ));
  }

  return Promise.all(checks);
}


async function main() {
  const env = loadEnv();
  const checkGroq = process.argv.includes('--groq');
  console.log(`Loaded ${Object.keys(env).length} vars from .dev.vars\n`);

  let allOk = true;

  const translateResults = await testTranslateProviders(env, { groq: checkGroq });
  if (translateResults.length > 0) {
    console.log('── Translate Providers ──────────────────────');
    for (const r of translateResults) {
      const icon = r.ok ? PASS : r.error === 'no key configured' ? SKIP : FAIL;
      const detail = r.ok ? '' : `  (${r.error}${r.status ? ` HTTP ${r.status}` : ''})`;
      console.log(`  ${r.label.padEnd(20)} ${icon}${detail}`);
      if (!r.ok && r.error !== 'no key configured') allOk = false;
    }
  }

  const transcribeResults = await testTranscribeProviders(env);
  if (transcribeResults.length > 0) {
    console.log('\n── Transcribe Providers ─────────────────────');
    for (const r of transcribeResults) {
      const icon = r.ok ? PASS : r.error === 'no key configured' ? SKIP : FAIL;
      const detail = r.error ? `  (${r.error}${r.status ? ` HTTP ${r.status}` : ''})` : '';
      console.log(`  ${r.label.padEnd(20)} ${icon}${detail}`);
      if (!r.ok && r.error !== 'no key configured') allOk = false;
    }
  }

  const summarize = (results, title) => {
    const pass = results.filter((r) => r.ok).length;
    const skip = results.filter((r) => r.error === 'no key configured').length;
    const fail = results.length - pass - skip;
    console.log(
      `  ${title}: ${pass} PASS · ${fail} FAIL · ${skip} missing-key (of ${results.length})`,
    );
  };
  summarize(translateResults, 'Translate');
  summarize(transcribeResults, 'Transcribe');

  console.log(`\n── Done ─────────────────────────────────────────`);
  process.exit(allOk ? 0 : 1);
}

if (process.argv[1]?.includes('check-providers')) {
  main();
}
