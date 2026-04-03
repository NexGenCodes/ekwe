import {
  createSettingsSlice,
  ThemePreference,
  SettingsState,
  SettingsActions,
} from '../settingsSlice';

describe('Settings Slice', () => {
  let slice: SettingsState & SettingsActions;
  const set = jest.fn((fn) => {
    const newState = fn(slice);
    slice = { ...slice, ...newState };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    slice = createSettingsSlice(set);
  });

  it('should initialize with correct default values', () => {
    expect(slice.bubbleEnabled).toBe(false);
    expect(slice.themePreference).toBe(ThemePreference.System);
    expect(slice.retentionDays).toBe(7);
  });

  it('should update bubble enabled state', () => {
    slice.setBubbleEnabled(true);
    expect(slice.bubbleEnabled).toBe(true);
  });

  it('should update theme preference', () => {
    slice.setThemePreference(ThemePreference.Dark);
    expect(slice.themePreference).toBe(ThemePreference.Dark);
  });

  it('should update retention days', () => {
    slice.setRetentionDays(30);
    expect(slice.retentionDays).toBe(30);
  });

  it('should update selected languages', () => {
    const languages = ['en', 'fr'];
    slice.setSelectedLanguages(languages);
    expect(slice.selectedLanguages).toEqual(languages);
  });

  it('should update pinned languages', () => {
    const pinned = ['it'];
    slice.setPinnedLanguages(pinned);
    expect(slice.pinnedLanguages).toEqual(pinned);
  });

  it('should update autoRaiseVolume, forceSpeakerMode, and banners', () => {
    slice.setAutoRaiseVolume(false);
    slice.setForceSpeakerMode(false);
    slice.setShowVolumeRaiseBanner(false);
    slice.setShowSpeakerRerouteBanner(false);
    expect(slice.autoRaiseVolume).toBe(false);
    expect(slice.forceSpeakerMode).toBe(false);
    expect(slice.showVolumeRaiseBanner).toBe(false);
    expect(slice.showSpeakerRerouteBanner).toBe(false);
  });
});
