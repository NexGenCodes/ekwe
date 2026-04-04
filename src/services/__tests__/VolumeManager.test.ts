import { VolumeManager } from 'src/services/VolumeManager';

describe('VolumeManager', () => {
  beforeEach(() => {
    VolumeManager._resetForTesting();
    jest.restoreAllMocks();
  });

  describe('raiseVolumeIfNeeded', () => {
    it('returns ok(true) if volume was below threshold', async () => {
      jest
        .spyOn(VolumeManager, 'getVolume')
        .mockResolvedValueOnce({ ok: true, value: 0.1 });
      const result = await VolumeManager.raiseVolumeIfNeeded();
      expect(result).toEqual({ ok: true, value: true });
      expect(VolumeManager.isVolumeRaised()).toBe(true);
    });

    it('returns ok(false) if volume is already high', async () => {
      const result = await VolumeManager.raiseVolumeIfNeeded(); // Default is 0.7
      expect(result).toEqual({ ok: true, value: false });
      expect(VolumeManager.isVolumeRaised()).toBe(false);
    });
  });

  describe('restoreVolume', () => {
    it('returns ok(undefined) successfully', async () => {
      jest
        .spyOn(VolumeManager, 'getVolume')
        .mockResolvedValueOnce({ ok: true, value: 0.1 });
      await VolumeManager.raiseVolumeIfNeeded();
      const result = await VolumeManager.restoreVolume();
      expect(result).toEqual({ ok: true, value: undefined });
      expect(VolumeManager.isVolumeRaised()).toBe(false);
    });
  });
});
