import { Env, TranscribeResult } from '../types';
import { isHallucination, fetchWithTimeout, rotateKeys, TIMEOUT_FAST, abortableDelay } from '../utils';

const GLADIA_UPLOAD = 'https://api.gladia.io/v2/upload';
const GLADIA_TRANSCRIPTION = 'https://api.gladia.io/v2/pre-recorded';
const POLL_INTERVAL = 2000;
const MAX_POLLS = 10; // 20s max wait

/**
 * Gladia pre-recorded transcription — async upload → poll pattern.
 * Slower than direct providers, use as a fallback.
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const res = await rotateKeys(
    env,
    'GLADIA_KEY_',
    (key) => attemptTranscription(blob, lang, key, signal),
    signal,
  );

  // rotateKeys expects Response, but Gladia is multi-step.
  // We use a workaround: return a synthetic Response from attemptTranscription.
  if (!res?.ok) return null;

  const data = await res.json() as { text?: string };
  if (data.text && !isHallucination(data.text)) {
    return { text: data.text, provider: 'gladia' };
  }

  return null;
}

async function attemptTranscription(
  blob: Blob,
  lang: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  // Step 1: Upload audio
  const uploadForm = new FormData();
  uploadForm.append('audio', blob, 'audio.wav');

  const uploadRes = await fetchWithTimeout(GLADIA_UPLOAD, {
    method: 'POST',
    headers: { 'x-gladia-key': apiKey },
    body: uploadForm,
  }, TIMEOUT_FAST, signal);

  if (!uploadRes.ok) {
    console.error('[gladia] Upload error:', await uploadRes.text().catch(() => ''));
    return uploadRes;
  }

  const { audio_url } = await uploadRes.json() as { audio_url: string };

  // Step 2: Submit transcription request
  const isAuto = !lang || lang === 'auto';
  const transcriptBody: Record<string, unknown> = {
    audio_url,
    language_behaviour: isAuto ? 'automatic single language' : 'manual',
  };
  if (!isAuto) transcriptBody.language = lang;

  const submitRes = await fetchWithTimeout(GLADIA_TRANSCRIPTION, {
    method: 'POST',
    headers: { 'x-gladia-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(transcriptBody),
  }, TIMEOUT_FAST, signal);

  if (!submitRes.ok) {
    console.error('[gladia] Submit error:', await submitRes.text().catch(() => ''));
    return submitRes;
  }

  const { result_url } = await submitRes.json() as { result_url: string };

  // Step 3: Poll for result
  for (let i = 0; i < MAX_POLLS; i++) {
    await abortableDelay(POLL_INTERVAL, signal);

    const poll = await fetch(result_url, {
      headers: { 'x-gladia-key': apiKey },
      signal,
    });

    const data = await poll.json() as GladiaResult;

    if (data.status === 'done') {
      const text = data.result?.transcription?.full_transcript || '';
      return Response.json({ text }, { status: 200 });
    }
    if (data.status === 'error') {
      return Response.json({ error: 'gladia_error' }, { status: 502 });
    }
  }

  // Timeout
  return Response.json({ error: 'gladia_timeout' }, { status: 504 });
}

interface GladiaResult {
  status?: string;
  result?: {
    transcription?: { full_transcript?: string };
  };
}

export const supportsAutoLang = true;
