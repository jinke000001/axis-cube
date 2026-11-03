import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** Dev-only still/clip stage. Not a production entry and not copied to public/. */
export default defineConfig({
  root: fileURLToPath(new URL('./hand-capture', import.meta.url)),
  publicDir: join(repo, 'public'),
  plugins: [
    {
      name: 'capture-assets',
      configureServer(server) {
        server.middlewares.use('/capture-assets', (req, res, next) => {
          const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
          if (!name || name.includes('..') || name.includes('\\')) return next();
          const file = join(repo, 'artifacts', name);
          if (!existsSync(file)) return next();
          res.setHeader('Content-Type', name.endsWith('.glb') ? 'model/gltf-binary' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          createReadStream(file).pipe(res);
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 3422,
    strictPort: true,
    fs: { allow: [repo] },
  },
  optimizeDeps: { include: ['cubejs'] },
  build: { commonjsOptions: { include: [/vendor\/cubejs/, /node_modules/] } },
});
