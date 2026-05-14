import fs from 'fs';
import path from 'path';

// 1. Read .dev.vars
const varsPath = path.join(__dirname, '..', '.dev.vars');
const envFile = fs.readFileSync(varsPath, 'utf-8');

const ENV = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#\s=]+)="?(.*?)"?$/);
  if (match) ENV[match[1]] = match[2];
});

console.log('🧪 Testing translation models...\n');

const testText = 'Hello, how are you?';
const targetLang = 'es';

async function testProvider(name, fn) {
  process.stdout.write(`Testing ${name.padEnd(15)} `);
  try {
    const res = await fn();
    if (res.ok) {
      console.log('✅ Success');
    } else {
      const err = await res.text();
      console.log(`❌ Failed (${res.status}): ${err.substring(0, 100).replace(/\n/g, '')}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

async function run() {
  // ─── GEMINI ───
  await testProvider('Gemini', () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${ENV.GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Translate to ${targetLang}: ${testText}` }] }] })
  }));

  // ─── COHERE ───
  await testProvider('Cohere', () => fetch('https://api.cohere.ai/v2/chat', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ENV.COHERE_KEY_1}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }],
      temperature: 0.1
    })
  }));

  // ─── GROQ ───
  await testProvider('Groq', () => fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ENV.GROQ_KEY_1}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }]
    })
  }));

  // ─── MISTRAL ───
  await testProvider('Mistral', () => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ENV.MISTRAL_KEY_1}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }]
    })
  }));

  // ─── OPENROUTER ───
  await testProvider('OpenRouter', () => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ENV.OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/o1-mini',
      messages: [{ role: 'user', content: `Translate to ${targetLang}: ${testText}` }]
    })
  }));
}

run();
