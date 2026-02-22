/*
 * File Purpose: Defines linting behavior for the TypeScript/React codebase.
 * Key Mechanics: Configures parser/plugins/rules so engine, sim, and UI code maintain consistent quality checks.
 */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.app.json'
  },
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  settings: {
    react: {
      version: 'detect'
    }
  },
  rules: {
    'react/react-in-jsx-scope': 'off'
  }
};
