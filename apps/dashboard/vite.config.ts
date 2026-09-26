import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const apiTarget = process.env.WORKFLOWOS_API ?? 'http://127.0.0.1:4310';

/**
 * The dashboard is a client of the HTTP API and nothing more.
 *
 * Everything it needs is proxied, including the event stream, so the browser
 * only ever talks to one origin and the same bundle works unchanged when this
 * app is wrapped in a desktop shell later.
 */
export default defineConfig({
  root: here('.'),
  plugins: [react()],
  server: {
    // Bound explicitly: on Windows `localhost` resolves to ::1 first, and a
    // dashboard that only answers on IPv6 loopback is a confusing thing to
    // debug at the point where someone is already stuck.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        // Server-sent events must not be buffered by the dev proxy.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
  build: { outDir: here('dist'), emptyOutDir: true },
});
