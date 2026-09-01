import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const apiPort = loadEnv(mode, process.cwd(), '').API_PORT || '8787';
  return {
    plugins: [react()],
    build: {
      // Mermaid's generated parser is a single ~650 KB lazy chunk. Keep it off
      // the critical path and warn only when a chunk exceeds that known boundary.
      chunkSizeWarningLimit: 700,
    },
    server: {
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true,
    },
  };
});
