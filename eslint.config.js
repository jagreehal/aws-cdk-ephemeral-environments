const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsparser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
