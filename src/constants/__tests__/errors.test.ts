import { EkweError, ErrorMessages } from '../errors';

describe('Ekwe Errors', () => {
  it('should define EkweError enum values', () => {
    expect(EkweError.NO_SPEECH).toBe('EKWE_NO_SPEECH');
    expect(EkweError.AUDIO_EMPTY).toBe('EKWE_AUDIO_EMPTY');
  });

  it('should verify ErrorMessages mapping', () => {
    expect(ErrorMessages[EkweError.NO_SPEECH]).toContain('No speech found');
    expect(ErrorMessages[EkweError.AUDIO_EMPTY]).toContain(
      'No audio was captured',
    );
  });

  it('should have a message for every error code', () => {
    const errorCodes = Object.values(EkweError);
    errorCodes.forEach((code) => {
      expect(ErrorMessages[code]).toBeDefined();
      expect(typeof ErrorMessages[code]).toBe('string');
    });
  });
});
