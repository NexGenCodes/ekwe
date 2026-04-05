import * as FileSystem from 'expo-file-system';
import { EkweError } from 'src/constants/errors';
import { Result, ok, err } from 'src/types/Result';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit for voice notes
export const VOICE_NOTE_EXTENSIONS = [
  '.opus',
  '.ogg',
  '.m4a',
  '.aac',
  '.amr',
  '.3gp',
];

/**
 * Validates if the given URI has a valid voice-note extension.
 */
export const validateVoiceNoteFormat = (uri: string): boolean => {
  const lowerUri = uri.toLowerCase();
  return VOICE_NOTE_EXTENSIONS.some((ext) => lowerUri.endsWith(ext));
};

/**
 * Checks if the file exists and is within the size limit.
 */
export const validateFileSize = async (
  uri: string,
  maxSize = MAX_FILE_SIZE,
): Promise<Result<boolean, EkweError>> => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return err(EkweError.SHARE_COPY_FAIL);
    }
    if (info.size && info.size > maxSize) {
      return err(EkweError.FILE_TOO_LARGE);
    }
    return ok(true);
  } catch {
    return err(EkweError.SHARE_COPY_FAIL);
  }
};

/**
 * Combined validation pipeline for shared audio files.
 */
export const validateSharedAudio = async (
  uri: string,
): Promise<Result<{ uri: string }, EkweError>> => {
  if (uri.length === 0) return err(EkweError.SHARE_COPY_FAIL);

  if (!validateVoiceNoteFormat(uri)) {
    return err(EkweError.BAD_FORMAT);
  }

  const sizeResult = await validateFileSize(uri);
  if (!sizeResult.ok) {
    return err(sizeResult.error);
  }

  return ok({ uri });
};
