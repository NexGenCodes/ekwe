import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';

import { LanguagePickerInline } from '../LanguagePickerInline';

// Mock useTheme — component-specific tokens
describe('LanguagePickerInline', () => {
  const mockOnSelectionChange = jest.fn();
  const defaultProps = {
    selectedLanguages: ['en'],
    pinnedLanguages: ['en'],
    onSelectionChange: mockOnSelectionChange,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders language rows', () => {
    const { getAllByText } = render(<LanguagePickerInline {...defaultProps} />);
    // "English" appears as both englishName and nativeName, so use getAllByText
    expect(getAllByText('English').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Spanish').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by english name', () => {
    const { getByPlaceholderText, queryByText, getByText } = render(
      <LanguagePickerInline {...defaultProps} />,
    );
    const input = getByPlaceholderText('Search languages');

    fireEvent.changeText(input, 'Spanish');

    expect(getByText('Spanish')).toBeTruthy();
    expect(queryByText('English')).toBeNull();
  });

  it('filters by native name', () => {
    const { getByPlaceholderText, queryByText, getByText } = render(
      <LanguagePickerInline {...defaultProps} />,
    );
    const input = getByPlaceholderText('Search languages');

    fireEvent.changeText(input, 'Español');

    expect(getByText('Spanish')).toBeTruthy();
    expect(queryByText('English')).toBeNull();
  });

  it('calls onSelectionChange when a row is tapped', () => {
    const { getByTestId } = render(<LanguagePickerInline {...defaultProps} />);
    const spanishRow = getByTestId('lang-row-es');

    fireEvent.press(spanishRow);

    expect(mockOnSelectionChange).toHaveBeenCalledWith(['en', 'es'], ['en']);
  });

  it('toggles selection when an already selected row is tapped', () => {
    const { getByTestId } = render(<LanguagePickerInline {...defaultProps} />);
    const englishRow = getByTestId('lang-row-en');

    fireEvent.press(englishRow);

    expect(mockOnSelectionChange).toHaveBeenCalledWith([], ['en']);
  });
});
