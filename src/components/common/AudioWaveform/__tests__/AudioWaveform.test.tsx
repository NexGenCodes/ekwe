import { render } from '@testing-library/react-native';
import React from 'react';

import { AudioWaveform } from '../AudioWaveform';

// Mock useTheme — component-specific tokens
jest.mock('src/hooks/useTheme', () => ({
  useTheme: (): unknown => ({
    tokens: {
      color: {
        background: {
          tertiary: '#F5F5F5',
        },
        brand: {
          core: '#0000FF',
        },
      },
    },
  }),
}));

describe('AudioWaveform', () => {
  const defaultProps = {
    amplitudes: [0.1, 0.5, 0.8, 0.5, 0.1],
    progress: 0.5,
    onSeek: jest.fn(),
  };

  it('renders correctly with amplitudes', () => {
    const { getByLabelText } = render(<AudioWaveform {...defaultProps} />);
    const container = getByLabelText('Audio Waveform');
    expect(container).toBeTruthy();

    // Check accessibility value based on progress (0.5 -> 50)
    expect(container.props.accessibilityValue.now).toBe(50);
  });

  it('renders empty baseline when no amplitudes are provided', () => {
    const { getByLabelText } = render(
      <AudioWaveform {...defaultProps} amplitudes={[]} />,
    );
    const container = getByLabelText('Audio Waveform');
    expect(container).toBeTruthy();
  });

  it('sets correct accessibility role and value', () => {
    const { getByLabelText } = render(<AudioWaveform {...defaultProps} />);
    const container = getByLabelText('Audio Waveform');
    expect(container.props.accessibilityRole).toBe('adjustable');
    expect(container.props.accessibilityValue.min).toBe(0);
    expect(container.props.accessibilityValue.max).toBe(100);
    expect(container.props.accessibilityValue.now).toBe(50);
  });
});
