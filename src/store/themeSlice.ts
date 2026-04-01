import type { StateCreator } from 'zustand';

export enum ResolvedTheme {
  LIGHT = 'light',
  DARK = 'dark',
}

export interface ThemeState {
  resolved: ResolvedTheme;
}

export interface ThemeActions {
  setResolved: (theme: ResolvedTheme) => void;
}

export type ThemeSlice = ThemeState & ThemeActions;

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (
  set,
) => ({
  resolved: ResolvedTheme.LIGHT,
  setResolved: (theme: ResolvedTheme): void => {
    set({ resolved: theme });
  },
});
