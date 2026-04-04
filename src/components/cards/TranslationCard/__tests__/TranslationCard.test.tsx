import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';

import { TranslationCard } from '../TranslationCard';

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
        text: {
          primary: '#000000',
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
        full: 999,
      },
      space: {
        '4': 16,
      },
    },
  }),
}));

describe('TranslationCard', () => {
  const mockOnCopy = jest.fn();
  const mockOnShare = jest.fn();

  const defaultProps = {
    translation: 'Hola, esta es una traducción de prueba.',
    targetLang: 'es',
    onCopy: mockOnCopy,
    onShare: mockOnShare,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders translation text and target language header', () => {
    const { getByText } = render(<TranslationCard {...defaultProps} />);

    expect(getByText('SPANISH')).toBeTruthy();
    expect(getByText('Hola, esta es una traducción de prueba.')).toBeTruthy();
  });

  it('renders action buttons and triggers callbacks', () => {
    const { getByText } = render(<TranslationCard {...defaultProps} />);

    const copyBtn = getByText('Copy');
    const shareBtn = getByText('Share');

    fireEvent.press(copyBtn);
    expect(mockOnCopy).toHaveBeenCalledTimes(1);

    fireEvent.press(shareBtn);
    expect(mockOnShare).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner when isLoading is true and hides translation', () => {
    const { getByTestId, queryByText } = render(
      <TranslationCard {...defaultProps} isLoading />,
    );

    // Assuming the lucide-react-native mock gives us icon-Loader2
    expect(getByTestId('icon-Loader2')).toBeTruthy();
    expect(queryByText('Hola, esta es una traducción de prueba.')).toBeNull();
  });

  it('shows download progress when downloadProgress < 1', () => {
    const { getByText, queryByText } = render(
      <TranslationCard {...defaultProps} downloadProgress={0.45} />,
    );

    expect(getByText('Downloading language model… 45%')).toBeTruthy();
    expect(queryByText('Hola, esta es una traducción de prueba.')).toBeNull();
  });

  it('renders translation text when downloadProgress is 1', () => {
    const { getByText, queryByText } = render(
      <TranslationCard {...defaultProps} downloadProgress={1} />,
    );

    expect(queryByText('Downloading language model… 100%')).toBeNull();
    expect(getByText('Hola, esta es una traducción de prueba.')).toBeTruthy();
  });
});
