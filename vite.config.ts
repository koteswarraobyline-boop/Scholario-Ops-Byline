import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The API and the SPA are served by the same process (server/server.ts), so no proxy is needed:
// in development server/server.ts mounts Vite as middleware; in production it serves ./dist.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': __dirname,
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
    },
    // Pages load on demand (React.lazy): scan every source file at startup so all their
    // dependencies are pre-bundled once. Otherwise Vite discovers them when a page is first
    // opened, re-optimizes, and the open tab gets "504 Outdated Optimize Dep" (blank page).
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.tsx'],
    },
  };
});
