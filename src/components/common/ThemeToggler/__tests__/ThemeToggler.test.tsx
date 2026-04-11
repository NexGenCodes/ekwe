import { render, fireEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import React from 'react';

import { ThemeToggler } from '../ThemeToggler';

// Mock useColorScheme from nativewind (read-only, no toggleColorScheme)
jest.mock('nativewind', () => ({
  useColorScheme: jest.fn(),
}));

// Mock useSettingsStore from the zustand store
const mockSetThemePreference = jest.fn();
jest.mock('src/store', () => ({
  useSettingsStore: jest.fn(() => ({
    setThemePreference: mockSetThemePreference,
  })),
}));

describe('ThemeToggler', () => {
  const useColorSchemeMock = require('nativewind').useColorScheme;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupTheme = (colorScheme: 'light' | 'dark'): void => {
    useColorSchemeMock.mockReturnValue({ colorScheme });
  };

  it('renders button to dark mode in light mode', () => {
    setupTheme('light');
    const { getByRole } = render(<ThemeToggler />);

    const buttonRole = getByRole('button');
    expect(buttonRole.props.accessibilityLabel).toBe('Switch to dark mode');
  });

  it('renders button to light mode in dark mode', () => {
    setupTheme('dark');
    const { getByRole } = render(<ThemeToggler />);

    const buttonRole = getByRole('button');
    expect(buttonRole.props.accessibilityLabel).toBe('Switch to light mode');
  });

  it('calls setThemePreference and haptics on press', () => {
    setupTheme('light');
    const { getByRole } = render(<ThemeToggler />);

    fireEvent.press(getByRole('button'));

    expect(mockSetThemePreference).toHaveBeenCalledTimes(1);
    expect(mockSetThemePreference).toHaveBeenCalledWith('dark');
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('toggles to light when currently dark', () => {
    setupTheme('dark');
    const { getByRole } = render(<ThemeToggler />);

    fireEvent.press(getByRole('button'));

    expect(mockSetThemePreference).toHaveBeenCalledWith('light');
  });
});
