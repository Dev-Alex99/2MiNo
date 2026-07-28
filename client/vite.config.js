import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // Sólo los tests del cliente: las suites del servidor son scripts de node
    // que se ejecutan aparte con `pnpm test` desde la raíz.
    include: ['src/**/*.test.{js,jsx}']
  }
})
