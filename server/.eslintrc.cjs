/* Config ESLint del servidor (Node/CommonJS). */
module.exports = {
  root: true,
  env: { node: true, es2021: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
  extends: ['eslint:recommended'],
  ignorePatterns: ['node_modules'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-console': 'off'
  }
};
