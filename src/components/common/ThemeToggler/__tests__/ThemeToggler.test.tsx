import { render, fireEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import React from 'react';

import { ThemeToggler } from '../ThemeToggler';

// Mock useColorScheme from nativewind
const mockToggleColorScheme = jest.fn();
jest.mock('nativewind', () => ({
  useColorScheme: jest.fn(),
}));

describe('ThemeToggler', () => {
  const useColorSchemeMock = require('nativewind').useColorScheme;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupTheme = (colorScheme: 'light' | 'dark'): void => {
    useColorSchemeMock.mockReturnValue({
      colorScheme,
      toggleColorScheme: mockToggleColorScheme,
    });
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

  it('calls toggleTheme and haptics on press', () => {
    setupTheme('light');
    const { getByRole } = render(<ThemeToggler />);

    fireEvent.press(getByRole('button'));

    expect(mockToggleColorScheme).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});
