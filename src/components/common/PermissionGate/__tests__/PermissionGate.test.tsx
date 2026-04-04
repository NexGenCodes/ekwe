import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';

import { PermissionGate } from '../PermissionGate';

// Mock useTheme — component-specific tokens
jest.mock('src/hooks/useTheme', () => ({
  useTheme: (): unknown => ({
    tokens: {
      color: {
        background: {
          primary: '#FFFFFF',
          secondary: '#F5F5F5',
          tertiary: '#F5F5F5',
        },
        text: {
          primary: '#000000',
          secondary: '#666666',
          inverse: '#FFFFFF',
        },
        brand: {
          core: '#0000FF',
        },
      },
      font: {
        family: {
          body: 'Outfit-Regular',
          bodyMed: 'Outfit-Medium',
          display: 'Outfit-Bold',
        },
        size: {
          heading: 24,
          body: 16,
          label: 14,
        },
        lineHeight: {
          heading: 32,
          body: 24,
        },
      },
      space: {
        '1': 4,
        '2': 8,
        '3': 12,
        '4': 16,
        '6': 24,
      },
    },
  }),
}));

describe('PermissionGate', () => {
  const mockOnPrimary = jest.fn();
  const mockOnSecondary = jest.fn();
  const defaultProps = {
    icon: <View testID="mock-icon" />,
    heading: 'Permission Required',
    body: 'We need your permission to proceed.',
    primaryLabel: 'Enable',
    onPrimary: mockOnPrimary,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders heading, body and icon correctly', () => {
    const { getByText, getByTestId } = render(
      <PermissionGate {...defaultProps} />,
    );

    expect(getByText('Permission Required')).toBeTruthy();
    expect(getByText('We need your permission to proceed.')).toBeTruthy();
    expect(getByTestId('mock-icon')).toBeTruthy();
  });

  it('calls onPrimary when primary button is pressed', () => {
    const { getByText } = render(<PermissionGate {...defaultProps} />);
    const primaryButton = getByText('Enable');

    fireEvent.press(primaryButton);
    expect(mockOnPrimary).toHaveBeenCalledTimes(1);
  });

  it('renders and calls onSecondary when secondary label and callback are provided', () => {
    const { getByText } = render(
      <PermissionGate
        {...defaultProps}
        secondaryLabel="Not Now"
        onSecondary={mockOnSecondary}
      />,
    );

    const secondaryButton = getByText('Not Now');
    expect(secondaryButton).toBeTruthy();

    fireEvent.press(secondaryButton);
    expect(mockOnSecondary).toHaveBeenCalledTimes(1);
  });

  it('does not render secondary button when secondaryLabel is missing', () => {
    const { queryByText } = render(<PermissionGate {...defaultProps} />);
    expect(queryByText('Not Now')).toBeNull();
  });
});
