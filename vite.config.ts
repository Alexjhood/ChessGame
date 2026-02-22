import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
} as const;

const isolationHeadersPlugin = {
  name: 'isolation-headers',
  configureServer(server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((_req, res, next) => {
      Object.entries(isolationHeaders).forEach(([k, v]) => res.setHeader(k, v));
      next();
    });
  },
  configurePreviewServer(server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((_req, res, next) => {
      Object.entries(isolationHeaders).forEach(([k, v]) => res.setHeader(k, v));
      next();
    });
  }
};

export default defineConfig({
  plugins: [react(), isolationHeadersPlugin],
  server: {
    headers: isolationHeaders
  },
  preview: {
    headers: isolationHeaders
  },
  test: {
    environment: 'jsdom'
  }
});
