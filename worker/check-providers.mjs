import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Parse .dev.vars ────────────────────────────────────────────
function loadEnv(path) {
  const text = readFileSync(path, 'utf-8');
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\w+)=\"?(.+?)\"?$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return env;
}

// ─── Helpers ─────────────────────────────────────────────────────
const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';

async function check(label, url, options) {
  process.stdout.write(`  ${label.padEnd(20)} `);
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      console.log(PASS);
      return true;
    }
    const body = await res.text().catch(() => '');
    console.log(
      `${FAIL}  (HTTP ${res.status} ${body.slice(0, 60).replace(/\n/g, ' ')})`,
    );
    return false;
  } catch (err) {
    console.log(`${FAIL}  (${err.message})`);
    return false;
  }
}

function checkUUID(key) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    key.trim(),
  );
}

// ─── Group test runners ──────────────────────────────────────────

async function testTranslateProviders(env) {
  console.log('\n── Translate Providers ──────────────────────');

  // Groq (multi-key rotation)
  for (let i = 1; ; i++) {
    const key = env[`GROQ_KEY_${i}`];
    if (!key) break;
    await check(`Groq key ${i}`, 'https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
  }

  // Gemini (multi-key, query param auth)
  for (let i = 1; ; i++) {
    const key = env[`GEMINI_KEY_${i}`];
    if (!key) break;
    await check(
      `Gemini key ${i}`,
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    );
  }

  // Cohere (multi-key)
  for (let i = 1; ; i++) {
    const key = env[`COHERE_KEY_${i}`];
    if (!key) break;
    await check(`Cohere key ${i}`, 'https://api.cohere.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
  }

  // Mistral (multi-key)
  for (let i = 1; ; i++) {
    const key = env[`MISTRAL_KEY_${i}`];
    if (!key) break;
    await check(`Mistral key ${i}`, 'https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
  }

  // OpenRouter (single key)
  if (env.OPENROUTER_KEY) {
    await check('OpenRouter', 'https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${env.OPENROUTER_KEY}` },
    });
  }
}

async function testTranscribeProviders(env) {
  console.log('\n── Transcribe Providers ─────────────────────');

  // Deepgram (multi-key)
  for (let i = 1; ; i++) {
    const key = env[`DEEPGRAM_KEY_${i}`];
    if (!key) break;
    await check(`Deepgram key ${i}`, 'https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${key}` },
    });
  }

  // AssemblyAI (multi-key)
  for (let i = 1; ; i++) {
    const key = env[`ASSEMBLYAI_KEY_${i}`];
    if (!key) break;
    await check(
      `AssemblyAI key ${i}`,
      'https://api.assemblyai.com/v2/account',
      {
        headers: { Authorization: key },
      },
    );
  }

  // Gladia (multi-key, UUID format check only — no simple validation endpoint)
  for (let i = 1; ; i++) {
    const key = env[`GLADIA_KEY_${i}`];
    if (!key) break;
    const valid = checkUUID(key);
    console.log(
      `  Gladia key ${i}${' '.repeat(10)}${valid ? PASS : FAIL}  ${valid ? '(UUID format OK)' : '(invalid UUID)'}`,
    );
  }

  // Wit.ai (per-language keys)
  const witLangs = ['EN', 'FR', 'ES', 'PT', 'DE', 'IT', 'ZH', 'IG', 'YO', 'HA'];
  for (const lang of witLangs) {
    const key = env[`WIT_KEY_${lang}`];
    if (!key) {
      console.log(`  Wit.ai ${lang.padEnd(16)} ${SKIP}  (no key configured)`);
      continue;
    }
    await check(
      `Wit.ai ${lang}`,
      `https://api.wit.ai/message?v=20240304&q=hello`,
      {
        headers: { Authorization: `Bearer ${key}` },
      },
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────
const env = loadEnv(resolve(__dirname, '.dev.vars'));
console.log(`Loaded ${Object.keys(env).length} vars from .dev.vars\n`);

await testTranslateProviders(env);
await testTranscribeProviders(env);

console.log('\n── Done ─────────────────────────────────────────');
