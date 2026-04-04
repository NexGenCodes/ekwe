import { render, fireEvent, act } from '@testing-library/react-native';
import React from 'react';

import { EkweBanner, BannerPresets } from '../EkweBanner';

// Mock useTheme — component-specific tokens
jest.mock('src/hooks/useTheme', () => ({
  useTheme: (): unknown => ({
    tokens: {
      color: {
        status: {
          success: '#00FF00',
          warning: '#FFFF00',
          error: '#FF0000',
          info: '#0000FF',
        },
        text: {
          primary: '#000000',
          secondary: '#666666',
        },
      },
      font: {
        family: {
          body: 'Outfit-Regular',
          bodyMed: 'Outfit-Medium',
        },
      },
    },
    id: 'light',
  }),
}));

describe('EkweBanner', () => {
  const mockOnClose = jest.fn();
  const defaultProps = {
    title: 'Test Banner',
    message: 'This is a test message',
    visible: true,
    onClose: mockOnClose,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders title and message correctly when visible', () => {
    const { getByText } = render(<EkweBanner {...defaultProps} />);
    expect(getByText('Test Banner')).toBeTruthy();
    expect(getByText('This is a test message')).toBeTruthy();
  });

  it('renders nothing when not visible', () => {
    const { queryByText } = render(
      <EkweBanner {...defaultProps} visible={false} />,
    );
    expect(queryByText('Test Banner')).toBeNull();
  });

  it('calls onClose when close button is pressed', () => {
    const { getByLabelText } = render(<EkweBanner {...defaultProps} />);
    const closeButton = getByLabelText('Dismiss banner');
    fireEvent.press(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('automatically calls onClose after duration', () => {
    render(<EkweBanner {...defaultProps} duration={3000} />);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('renders correctly with BannerPresets.noInternet', () => {
    const { getByText } = render(
      <EkweBanner {...BannerPresets.noInternet} visible />,
    );
    expect(getByText('No connection')).toBeTruthy();
    expect(
      getByText('Translations will resume once you are back online.'),
    ).toBeTruthy();
  });

  it('sets accessibility role to alert', () => {
    const { getByLabelText } = render(<EkweBanner {...defaultProps} />);
    const banner = getByLabelText('info banner: Test Banner');
    expect(banner.props.accessibilityRole).toBe('alert');
  });
});
