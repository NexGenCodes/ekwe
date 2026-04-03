interface Env {
  GROQ_KEY_1: string;
  GROQ_KEY_2: string;
  ASSEMBLYAI_KEY: string;
  DEEPSEEK_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/transcribe') {
      return handleTranscribe(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/translate') {
      return handleTranslate(request, env);
    }
    return new Response('Not found', { status: 404 });
  },
};

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  const body = await request.arrayBuffer();
  const attempt1 = await tryGroq(body, env.GROQ_KEY_1);
  if (attempt1.status !== 429) return attempt1;
  const attempt2 = await tryGroq(body, env.GROQ_KEY_2);
  if (attempt2.status !== 429) return attempt2;
  return Response.json({ error: 'ALL_PROVIDERS_FAIL' }, { status: 503 });
}

async function tryGroq(body: ArrayBuffer, apiKey: string): Promise<Response> {
  return fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
}

async function handleTranslate(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as {
    text: string;
    targetLang: string;
  };
  const groqResult = await tryGroqTranslate(
    payload.text,
    payload.targetLang,
    env.GROQ_KEY_1,
  );
  if (groqResult.ok) return groqResult;
  const deepseekResult = await tryDeepSeek(
    payload.text,
    payload.targetLang,
    env.DEEPSEEK_KEY,
  );
  if (deepseekResult.ok) return deepseekResult;
  return Response.json({ error: 'ALL_PROVIDERS_FAIL' }, { status: 503 });
}

async function tryGroqTranslate(
  text: string,
  targetLang: string,
  apiKey: string,
): Promise<Response> {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Translate to ${targetLang}. Return only the translation.`,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 1000,
    }),
  });
}

async function tryDeepSeek(
  text: string,
  targetLang: string,
  apiKey: string,
): Promise<Response> {
  return fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `Translate to ${targetLang}. Return only the translation.`,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 1000,
    }),
  });
}
