module.exports = {
  __esModule: true,
  default: {
    fetch: async () => ({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
      details: null,
    }),
    addEventListener: () => () => {},
  },
  refresh: () => {},
};