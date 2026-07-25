/* Config ESLint del cliente (formato eslintrc, compatible con ESLint 8.57).
   El script `lint` usa `--ext js,jsx`. */
module.exports = {
  root: true,
  env: { browser: true, es2021: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended'
  ],
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', 'node_modules', '*.config.js'],
  rules: {
    // El proyecto no usa PropTypes (valida en el servidor); evita ruido.
    'react/prop-types': 'off',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // Variables sin usar como aviso (no bloquea), ignorando mayúsculas/constantes.
    'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }]
  }
};
