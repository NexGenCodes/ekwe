import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const TS_FILES = ['src/**/*.ts', 'tests/**/*.ts', 'vitest.config.mts'];

export default tseslint.config(
  {
    ignores: [
      'worker-configuration.d.ts',
      'dist/',
      'coverage/',
      '.wrangler/',
    ],
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
    files: ['tests/**/*.ts', 'src/__tests__/**/*.ts', 'vitest.config.mts'],
    rules: {
      'no-console': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  {
    files: ['tests/**/*.mjs', 'src/__tests__/**/*.mjs'],
    languageOptions: {
      globals: {
        fetch: 'readonly',
        AbortSignal: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },
);
