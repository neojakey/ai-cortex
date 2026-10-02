import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        // AI_CORTEX_API_URL lets the browser checks (tests/browser) point at their own API.
        target: process.env.AI_CORTEX_API_URL || 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
});
