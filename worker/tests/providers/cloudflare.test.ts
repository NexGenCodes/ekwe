import { describe, test, expect } from 'vitest';
import * as cloudflare from '../../src/providers/cloudflare';
import { mockEnv, makeAudioBlob, mockSignal } from '../setup';

describe('Cloudflare provider', () => {
  describe('transcribe', () => {
    test('returns result on success', async () => {
      const env = mockEnv();
      const result = await cloudflare.transcribe(
        makeAudioBlob(),
        'en',
        env,
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.text).toBe('mock whisper transcription');
      expect(result!.provider).toBe('cloudflare');
    });

    test('returns null when AI returns empty text', async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({ text: '' })) as unknown as typeof env.AI.run;
      const result = await cloudflare.transcribe(
        makeAudioBlob(),
        'en',
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test('returns null on hallucination', async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({ text: 'Thanks for watching' })) as unknown as typeof env.AI.run;
      const result = await cloudflare.transcribe(
        makeAudioBlob(),
        'en',
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test('returns null on AI error', async () => {
      const env = mockEnv();
      env.AI.run = async () => {
        throw new Error('AI model error');
      };
      const result = await cloudflare.transcribe(
        makeAudioBlob(),
        'en',
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });

  describe('translate', () => {
    test('returns translation on success', async () => {
      const env = mockEnv();
      const result = await cloudflare.translate(
        'Hello world',
        'Spanish',
        'English',
        env,
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.translation).toBe('translated text');
      expect(result!.provider).toBe('cloudflare');
    });

    test('returns null on empty response', async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({})) as unknown as typeof env.AI.run;
      const result = await cloudflare.translate(
        'Hello',
        'Spanish',
        'English',
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test('returns null on error', async () => {
      const env = mockEnv();
      env.AI.run = async () => {
        throw new Error('model error');
      };
      const result = await cloudflare.translate(
        'Hello',
        'Spanish',
        'English',
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });
});
