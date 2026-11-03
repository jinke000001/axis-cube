import { readdir, unlink, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// exFAT can expose AppleDouble files copied from public assets. Capacitor's
// recursive copy may race with macOS creating their counterparts. Only strip
// generated output metadata; original models and photos remain untouched.
const root = resolve(process.env.AXIS_MOBILE_PROBE === '1'
  ? 'evidence/beginner-site-2026-11-01/mobile/probe-dist'
  : 'dist');
await access(join(root, 'index.html'));
let removed = 0;
async function clean(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await clean(path);
    else if (entry.name.startsWith('._') || entry.name === '.DS_Store') {
      await unlink(path);
      removed++;
    }
  }
}
await clean(root);
console.log(`Prepared local web assets (${removed} generated metadata files removed).`);
