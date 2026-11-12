import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The API serves the built bundle under /dashboard, so every asset URL must carry that prefix.
export default defineConfig({
  base: '/dashboard/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    // Same-origin in dev too, so the browser never needs CORS.
    proxy: { '/v1': process.env['API_URL'] ?? 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
