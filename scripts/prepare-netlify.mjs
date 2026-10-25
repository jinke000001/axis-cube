import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Publish only the built browser application. Do not copy extended attributes
// from the external drive, or include macOS AppleDouble metadata in the release.
const source = new URL('../dist/', import.meta.url);
const destination = await mkdtemp(join(tmpdir(), 'axis-netlify-'));
const files = [], excluded = [];
const allowed = /^(?:index\.html|_headers|assets\/[\w.-]+\.(?:js|css)|licenses\/[\w.-]+\.txt|models\/wuji\/(?:LICENSE|hand\/body\/urdf\/(?:left|right)\.urdf|hand\/body\/meshes\/(?:left|right)\/[\w.-]+\.STL))$/;

async function copy(relative = '') {
  for (const item of await readdir(new URL(relative, source), { withFileTypes: true })) {
    const path = relative + item.name;
    if (item.name.startsWith('._') || item.name === '.DS_Store') { excluded.push(path); continue; }
    if (item.isDirectory()) { await copy(path + '/'); continue; }
    if (!item.isFile() || !allowed.test(path)) throw new Error(`Unexpected public file: ${path}`);
    const bytes = await readFile(new URL(path, source));
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
await copy();
for (const required of ['index.html', '_headers', 'models/wuji/LICENSE']) {
  if (!files.some(file => file.path === required)) throw new Error(`Missing public file: ${required}`);
}
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = { createdAt: new Date().toISOString(), directory: destination, count: files.length,
  bytes: files.reduce((sum, file) => sum + file.bytes, 0), excluded, files };
await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../evidence/netlify-release-manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ directory: destination, count: manifest.count, bytes: manifest.bytes, excludedCount: excluded.length }));
