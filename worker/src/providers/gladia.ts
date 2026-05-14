import { Env, TranscribeResult } from '../types';
import { isHallucination, fetchWithTimeout, rotateKeys, TIMEOUT_FAST, abortableDelay } from '../utils';
import { logger } from '../logger';

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

  const data = await res.json() as { text?: string; language?: string };
  if (data.text && !isHallucination(data.text)) {
    return { text: data.text, provider: 'gladia', language: data.language };
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
    const err = await uploadRes.text().catch(() => 'No body');
    logger.error('[gladia] Upload error', { status: uploadRes.status, body: err });
    return uploadRes;
  }

  const { audio_url } = await uploadRes.json() as { audio_url: string };

  // Step 2: Submit transcription request
  const isAuto = !lang || lang === 'auto';
  const transcriptBody: Record<string, unknown> = {
    audio_url,
  };
  if (!isAuto) {
    transcriptBody.language_config = { languages: [lang] };
  }

  const submitRes = await fetchWithTimeout(GLADIA_TRANSCRIPTION, {
    method: 'POST',
    headers: { 'x-gladia-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(transcriptBody),
  }, TIMEOUT_FAST, signal);

  if (!submitRes.ok) {
    const err = await submitRes.text().catch(() => 'No body');
    logger.error('[gladia] Submit error', { status: submitRes.status, body: err });
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
      const language = data.result?.transcription?.languages?.[0]?.language;
      logger.info('[gladia] Transcription completed', { language });
      return Response.json({ text, language }, { status: 200 });
    }
    if (data.status === 'error') {
      logger.error('[gladia] Transcription job failed', { data });
      return Response.json({ error: 'gladia_error' }, { status: 502 });
    }

    logger.info('[gladia] Polling for results...', { attempt: i + 1, status: data.status });
  }

  // Timeout
  return Response.json({ error: 'gladia_timeout' }, { status: 504 });
}

interface GladiaResult {
  status?: string;
  result?: {
    transcription?: {
      full_transcript?: string;
      languages?: Array<{ language?: string }>;
    };
  };
}

export const supportsAutoLang = true;
