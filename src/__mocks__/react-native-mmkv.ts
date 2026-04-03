export const MMKV = jest.fn().mockImplementation(() => ({
  getString: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  clearAll: jest.fn(),
}));
