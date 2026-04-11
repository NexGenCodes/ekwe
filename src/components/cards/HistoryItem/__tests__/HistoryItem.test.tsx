import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';

import { HistoryItem } from '../HistoryItem';

// Mock getRelativeTime
jest.mock('src/utils/relativeTime', () => ({
  getRelativeTime: jest.fn().mockReturnValue('2 mins ago'),
}));

describe('HistoryItem', () => {
  const mockOnPress = jest.fn();
  const mockOnDelete = jest.fn();
  const mockEntry = {
    id: '1',
    transcript: 'Hello world',
    translation: 'Hola mundo',
    sourceLang: 'en',
    targetLang: 'es',
    timestamp: Date.now(),
    duration: 5,
    audioPath: 'test.wav',
    sourceApp: 'test-app',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders entry details correctly', () => {
    const { getByText } = render(
      <HistoryItem
        entry={mockEntry}
        onPress={mockOnPress}
        onDelete={mockOnDelete}
      />,
    );

    expect(getByText('ENGLISH → SPANISH')).toBeTruthy();
    expect(getByText('Hello world')).toBeTruthy();
    expect(getByText('2 mins ago')).toBeTruthy();
  });

  it('calls onPress when the item is tapped', () => {
    const { getByText } = render(
      <HistoryItem
        entry={mockEntry}
        onPress={mockOnPress}
        onDelete={mockOnDelete}
      />,
    );

    fireEvent.press(getByText('Hello world'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete when delete button in right actions is pressed', () => {
    const { getByTestId } = render(
      <HistoryItem
        entry={mockEntry}
        onPress={mockOnPress}
        onDelete={mockOnDelete}
      />,
    );

    const deleteButton = getByTestId('delete-button');
    fireEvent.press(deleteButton);

    expect(mockOnDelete).toHaveBeenCalledTimes(1);
  });
});
