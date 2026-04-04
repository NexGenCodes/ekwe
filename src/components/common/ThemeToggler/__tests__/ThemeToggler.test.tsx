import { render, fireEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import React from 'react';

import { ThemeToggler } from '../ThemeToggler';

// Mock useTheme
const mockToggleTheme = jest.fn();
jest.mock('src/hooks/useTheme', () => ({
  useTheme: jest.fn(),
}));

describe('ThemeToggler', () => {
  const useThemeMock = require('src/hooks/useTheme').useTheme;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupTheme = (id: 'light' | 'dark'): void => {
    useThemeMock.mockReturnValue({
      id,
      toggleTheme: mockToggleTheme,
      tokens: {
        color: {
          background: {
            primary: '#FFFFFF',
            tertiary: '#F5F5F5',
          },
          border: {
            default: '#E0E0E0',
          },
          brand: {
            core: '#0000FF',
          },
          text: {
            primary: '#000000',
            tertiary: '#666666',
          },
        },
        font: {
          family: {
            bodyMed: 'Outfit-Medium',
          },
        },
      },
    });
  };

  it('renders switch to dark mode in light mode', () => {
    setupTheme('light');
    const { getByRole } = render(<ThemeToggler />);

    const switchRole = getByRole('switch');
    expect(switchRole.props.accessibilityLabel).toBe('Switch to dark mode');
    expect(switchRole.props.accessibilityState.checked).toBe(false);
  });

  it('renders switch to light mode in dark mode', () => {
    setupTheme('dark');
    const { getByRole } = render(<ThemeToggler />);

    const switchRole = getByRole('switch');
    expect(switchRole.props.accessibilityLabel).toBe('Switch to light mode');
    expect(switchRole.props.accessibilityState.checked).toBe(true);
  });

  it('calls toggleTheme and haptics on press', () => {
    setupTheme('light');
    const { getByRole } = render(<ThemeToggler />);

    fireEvent.press(getByRole('switch'));

    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('shows text labels when showLabels is true', () => {
    setupTheme('light');
    const { getByText, rerender } = render(<ThemeToggler showLabels />);

    expect(getByText('Light')).toBeTruthy();

    setupTheme('dark');
    rerender(<ThemeToggler showLabels />);

    expect(getByText('Dark')).toBeTruthy();
  });

  it('hides text labels when showLabels is false', () => {
    setupTheme('light');
    const { queryByText } = render(<ThemeToggler showLabels={false} />);

    expect(queryByText('Light')).toBeNull();
    expect(queryByText('Dark')).toBeNull();
  });
});
