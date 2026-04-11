module.exports = function (api) {
  api.cache(true);
  const isTest = process.env.NODE_ENV === 'test';
  return {
    presets: [
      [
        'babel-preset-expo',
        { jsxImportSource: isTest ? 'react' : 'nativewind' },
      ],
      !isTest && 'nativewind/babel',
    ].filter(Boolean),
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
          },
        },
      ],
      '@babel/plugin-transform-runtime',
      'react-native-reanimated/plugin',
    ],
  };
};
