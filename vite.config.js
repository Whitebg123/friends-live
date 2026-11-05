import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/health': 'http://127.0.0.1:3000', '/api': 'http://127.0.0.1:3000' } } });
