const fs = require('fs');
const path = require('path');

// 1. Read .dev.vars
const varsPath = path.join(__dirname, '..', '.dev.vars');
const envFile = fs.readFileSync(varsPath, 'utf-8');

const ENV = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#\s=]+)="?(.*?)"?$/);
  if (match) ENV[match[1]] = match[2];
});

console.log('🧪 Testing translation models and all rotation keys...\n');

const testText = 'Hello, how are you?';
const targetLang = 'es';

async function testProvider(name, keyName, fn) {
  process.stdout.write(`Testing ${name.padEnd(15)} [${keyName.padEnd(15)}] `);
  try {
    const res = await fn();
    if (res.ok) {
      console.log('✅ Success');
    } else {
      const err = await res.text();
      console.log(`❌ Failed (${res.status}): ${err.substring(0, 200).replace(/\n/g, '')}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

// Find all keys matching a prefix
function getKeys(prefix) {
  return Object.keys(ENV).filter(k => k.startsWith(prefix) && ENV[k].trim() !== '');
}

async function run() {
  // ─── GEMINI ───
  for (const key of getKeys('GEMINI_KEY_')) {
    await testProvider('Gemini', key, () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${ENV[key]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `Translate to ${targetLang}: ${testText}` }] }] })
    }));
  }

  // ─── COHERE ───
  for (const key of getKeys('COHERE_KEY_')) {
    await testProvider('Cohere', key, () => fetch('https://api.cohere.ai/v2/chat', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ENV[key]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'command-r7b-12-2024',
        messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }],
        temperature: 0.1
      })
    }));
  }

  // ─── GROQ ───
  for (const key of getKeys('GROQ_KEY_')) {
    await testProvider('Groq', key, () => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ENV[key]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }]
      })
    }));
  }

  // ─── MISTRAL ───
  for (const key of getKeys('MISTRAL_KEY_')) {
    await testProvider('Mistral', key, () => fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ENV[key]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }]
      })
    }));
  }

  // ─── OPENROUTER ───
  if (ENV.OPENROUTER_KEY) {
    await testProvider('OpenRouter', 'OPENROUTER_KEY', () => fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ENV.OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }]
      })
    }));
  }
}

run();
