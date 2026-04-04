import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';

import { TranscriptCard } from '../TranscriptCard';

// Mock useTheme
jest.mock('src/hooks/useTheme', () => ({
  useTheme: (): unknown => ({
    tokens: {
      color: {
        background: {
          primary: '#FFFFFF',
        },
        border: {
          default: '#E0E0E0',
        },
        brand: {
          core: '#0000FF',
        },
        status: {
          warning: '#FFA500',
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
        size: {
          body: 16,
          caption: 12,
        },
        lineHeight: {
          body: 24,
        },
        letterSpacing: {
          label: 0.5,
        },
      },
      radius: {
        lg: 12,
      },
      shadow: {
        card: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 2,
        },
      },
      space: {
        '3': 12,
        '4': 16,
      },
    },
  }),
}));

describe('TranscriptCard', () => {
  const mockOnCopy = jest.fn();
  const mockOnShare = jest.fn();
  const mockOnTranslate = jest.fn();
  const mockOnAcceptMismatch = jest.fn();

  const defaultProps = {
    transcript: 'Hello, this is a test transcript.',
    sourceLang: 'en',
    duration: 3, // 3 seconds
    onCopy: mockOnCopy,
    onShare: mockOnShare,
    onTranslate: mockOnTranslate,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders transcript text, header and duration correctly', () => {
    const { getByText } = render(<TranscriptCard {...defaultProps} />);

    expect(getByText('ENGLISH')).toBeTruthy();
    expect(getByText('Hello, this is a test transcript.')).toBeTruthy();
    expect(getByText('0:03')).toBeTruthy();
  });

  it('renders action buttons and triggers callbacks', () => {
    const { getByText } = render(<TranscriptCard {...defaultProps} />);

    const copyBtn = getByText('Copy');
    const shareBtn = getByText('Share');
    const translateBtn = getByText('Translate');

    fireEvent.press(copyBtn);
    expect(mockOnCopy).toHaveBeenCalledTimes(1);

    fireEvent.press(shareBtn);
    expect(mockOnShare).toHaveBeenCalledTimes(1);

    fireEvent.press(translateBtn);
    expect(mockOnTranslate).toHaveBeenCalledTimes(1);
  });

  it('renders mismatch warning when languageMismatch is true', () => {
    const { getByText } = render(
      <TranscriptCard
        {...defaultProps}
        languageMismatch={{ detected: 'fr', suggested: 'es' }}
        onAcceptMismatch={mockOnAcceptMismatch}
      />,
    );

    expect(
      getByText('Sounds like fr, not English. Translate from fr?'),
    ).toBeTruthy();

    fireEvent.press(
      getByText('Sounds like fr, not English. Translate from fr?'),
    );
    expect(mockOnAcceptMismatch).toHaveBeenCalledTimes(1);
  });

  it('does not render mismatch warning when languageMismatch is missing or false', () => {
    const { queryByText } = render(<TranscriptCard {...defaultProps} />);

    expect(queryByText('Translate from English')).toBeNull();
  });
});
