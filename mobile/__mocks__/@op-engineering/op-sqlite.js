// __mocks__/@op-engineering/op-sqlite.js

export const open = jest.fn(() => ({
  execute: jest.fn(),
  executeBatch: jest.fn(),
  executeBatchAsync: jest.fn(),
  transaction: jest.fn(async (callback) => {
    // A mock transaction implementation that executes the callback 
    // and passes a mock tx object.
    const tx = {
      execute: jest.fn(),
    };
    await callback(tx);
  }),
  close: jest.fn(),
  attach: jest.fn(),
  detach: jest.fn(),
}));

export const type = 'sqlite';
