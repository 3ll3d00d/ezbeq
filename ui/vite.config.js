import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import circleDependency from 'vite-plugin-circular-dependency'
import { compression } from 'vite-plugin-compression2';

// Catalogue is React.lazy()-loaded (it pulls in @mui/x-data-grid, the biggest chunk in the app) so its
// import() is only discovered once the main chunk has downloaded *and* executed - a fully serialized
// extra round trip on a slow link. Injecting a modulepreload hint lets the browser start fetching it
// in parallel with the main chunk instead, so it's usually already in the cache by the time React needs
// it, without giving up the benefit of not blocking initial parse/paint on its weight.
function preloadLazyChunk(chunkName) {
    let fileName;
    return {
        name: `preload-${chunkName.toLowerCase()}-chunk`,
        generateBundle(_, bundle) {
            for (const file of Object.values(bundle)) {
                if (file.type === 'chunk' && file.name === chunkName) {
                    fileName = file.fileName;
                }
            }
        },
        transformIndexHtml(html) {
            if (!fileName) return html;
            return html.replace(
                '</head>',
                `    <link rel="modulepreload" crossorigin href="/${fileName}">\n</head>`
            );
        }
    };
}

export default defineConfig(() => {
    return {
        build: {
            outDir: '../ezbeq/ui',
        },
        plugins: [
            react(),
            circleDependency({
                include: '**/*.js*'
            }),
            preloadLazyChunk('Catalogue'),
            compression({
                algorithms: ['gzip', 'brotliCompress'],
                exclude: [/\.(gz|br)$/, /\.woff2?$/],
                deleteOriginalAssets: false
            })
        ],
        server: {
            port: 5174,
            proxy: {
                '/api': 'http://127.0.0.1:8080',
                '/ws': {
                    target: 'ws://127.0.0.1:8080',
                    ws: true
                }
            }
        },
        test: {
            environment: 'jsdom',
            globals: true,
            setupFiles: ['./src/setupTests.js'],
        }
    };
});
