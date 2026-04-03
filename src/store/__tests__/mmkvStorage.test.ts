import { mmkvStorage } from '../mmkvStorage';

// Mock react-native-mmkv
jest.mock('react-native-mmkv', () => {
  const mockGetString = jest.fn();
  const mockSet = jest.fn();
  const mockRemove = jest.fn();

  return {
    createMMKV: jest.fn(() => ({
      getString: mockGetString,
      set: mockSet,
      remove: mockRemove,
    })),
    // Export mocks for testing assertions
    __mockGetString: mockGetString,
    __mockSet: mockSet,
    __mockRemove: mockRemove,
  };
});

describe('mmkvStorage', () => {
  let mockGetString: jest.Mock;
  let mockSet: jest.Mock;
  let mockRemove: jest.Mock;

  beforeEach(() => {
    const mmkvMock = require('react-native-mmkv');
    mockGetString = mmkvMock.__mockGetString;
    mockSet = mmkvMock.__mockSet;
    mockRemove = mmkvMock.__mockRemove;
    jest.clearAllMocks();
  });

  it('gets an item', () => {
    mockGetString.mockReturnValue('value');
    expect(mmkvStorage.getItem('key')).toBe('value');
    expect(mockGetString).toHaveBeenCalledWith('key');
  });

  it('returns null if item not found', () => {
    mockGetString.mockReturnValue(undefined);
    expect(mmkvStorage.getItem('key')).toBeNull();
    expect(mockGetString).toHaveBeenCalledWith('key');
  });

  it('sets an item', () => {
    mmkvStorage.setItem('key', 'value');
    expect(mockSet).toHaveBeenCalledWith('key', 'value');
  });

  it('removes an item', () => {
    mmkvStorage.removeItem('key');
    expect(mockRemove).toHaveBeenCalledWith('key');
  });
});
