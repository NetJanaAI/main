import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'client/**',
      'coverage/**',
      'data/**',
      '*.js',
      '*.mjs',
      '*.cjs',
      'scripts/**'
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'no-useless-assignment': 'off',
      'prefer-rest-params': 'off',
      'no-empty': 'off',
      'no-console': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'prefer-const': 'off',
      'no-useless-catch': 'off',
      'preserve-caught-error': 'off'
    },
  }
);
