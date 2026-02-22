import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
var isolationHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
};
var isolationHeadersPlugin = {
    name: 'isolation-headers',
    configureServer: function (server) {
        server.middlewares.use(function (_req, res, next) {
            Object.entries(isolationHeaders).forEach(function (_a) {
                var k = _a[0], v = _a[1];
                return res.setHeader(k, v);
            });
            next();
        });
    },
    configurePreviewServer: function (server) {
        server.middlewares.use(function (_req, res, next) {
            Object.entries(isolationHeaders).forEach(function (_a) {
                var k = _a[0], v = _a[1];
                return res.setHeader(k, v);
            });
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
