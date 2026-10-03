import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Expose env vars to the browser with VITE_ prefix
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || 'http://localhost:4000'),
      'import.meta.env.VITE_WS_URL':  JSON.stringify(process.env.VITE_WS_URL  || 'ws://localhost:4000/ws'),
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Proxy API + WS to the backend (avoids CORS in dev)
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:4000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
