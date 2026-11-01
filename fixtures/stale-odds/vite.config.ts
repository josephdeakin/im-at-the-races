import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      // ws:true carries the /api/odds socket to the API server in dev.
      '/api': { target: 'http://127.0.0.1:4301', ws: true },
    },
  },
});
