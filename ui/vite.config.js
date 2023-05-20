import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import circleDependency from 'vite-plugin-circular-dependency'

export default defineConfig(() => {
    return {
        build: {
            outDir: '../ezbeq/ui',
        },
        plugins: [
            react(),
            circleDependency({
                include: '**/*.js*'
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
