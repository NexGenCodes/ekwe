import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts'];

export default tseslint.config(
  {
    ignores: ['node_modules/', 'dist/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: TS_FILES,
  })),
  {
    files: TS_FILES,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      'no-console': 'error',
      'no-empty': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'no-console': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
);
