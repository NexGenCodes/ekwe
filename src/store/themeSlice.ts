export enum ResolvedTheme {
  Light = 'light',
  Dark = 'dark',
}

export interface ThemeState {
  resolved: ResolvedTheme;
}

export interface ThemeActions {
  setResolved: (theme: ResolvedTheme) => void;
}

export const createThemeSlice = (
  set: (fn: (state: ThemeState) => Partial<ThemeState>) => void,
): ThemeState & ThemeActions => ({
  resolved: ResolvedTheme.Light,
  setResolved: (resolved): void => set(() => ({ resolved })),
});
