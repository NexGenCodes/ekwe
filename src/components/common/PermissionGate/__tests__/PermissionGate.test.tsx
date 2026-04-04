import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';

import { PermissionGate } from '../PermissionGate';

// Mock useTheme — component-specific tokens
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
