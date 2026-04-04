import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';

import { EkweButton } from '../EkweButton';

// Mock useTheme — component-specific tokens
describe('EkweButton', () => {
  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders label correctly', () => {
    const { getByText } = render(
      <EkweButton label="Test Button" onPress={mockOnPress} />,
    );
    expect(getByText('Test Button')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const { getByText } = render(
      <EkweButton label="Press Me" onPress={mockOnPress} />,
    );
    fireEvent.press(getByText('Press Me'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const { getByText } = render(
      <EkweButton label="Disabled" onPress={mockOnPress} disabled />,
    );
    fireEvent.press(getByText('Disabled'));
    expect(mockOnPress).not.toHaveBeenCalled();
  });

  it('does not call onPress when loading', () => {
    const { getByRole } = render(
      <EkweButton label="Loading" onPress={mockOnPress} loading />,
    );
    // Since label is not rendered during loading, we use getByRole
    fireEvent.press(getByRole('button'));
    expect(mockOnPress).not.toHaveBeenCalled();
  });

  it('renders left and right icons when provided', () => {
    const { getByTestId } = render(
      <EkweButton
        label="Icons"
        onPress={mockOnPress}
        leftIcon={<View testID="left-icon" />}
        rightIcon={<View testID="right-icon" />}
      />,
    );
    expect(getByTestId('left-icon')).toBeTruthy();
    expect(getByTestId('right-icon')).toBeTruthy();
  });

  it('sets accessibility labels and states correctly', () => {
    const { getByRole } = render(
      <EkweButton label="Accessible" onPress={mockOnPress} disabled loading />,
    );
    const button = getByRole('button');
    expect(button.props.accessibilityLabel).toBe('Accessible');
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(button.props.accessibilityState.busy).toBe(true);
  });
});
