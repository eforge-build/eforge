import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    files: ['packages/**/*.ts'],
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      'sonarjs/cognitive-complexity': ['warn', 30],
    },
  },
];
