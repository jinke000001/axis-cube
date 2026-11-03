import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../../../evidence/beginner-site-2026-11-01/mobile/probe-dist', import.meta.url)),
    emptyOutDir: true,
  },
});
