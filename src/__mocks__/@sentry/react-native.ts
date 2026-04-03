export const init = jest.fn();
export const captureException = jest.fn();
export const captureMessage = jest.fn();
export const setUser = jest.fn();
export const setTag = jest.fn();
export const setExtra = jest.fn();
export const addBreadcrumb = jest.fn();

export const Native = {
  init: jest.fn(),
};

export default {
  init,
  captureException,
  captureMessage,
  setUser,
  setTag,
  setExtra,
  addBreadcrumb,
  Native,
};
