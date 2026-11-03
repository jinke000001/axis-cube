import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultCandidatePath = 'evidence/beginner-site-2026-11-01/mobile/frozen-web-candidate.json';
const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
// With the installed first-party Capacitor plugins, cap sync creates exactly
// these two empty compatibility stubs. A nonempty Cordova stub needs review.
export const generatedNativeAssets = { 'cordova.js': emptySha256, 'cordova_plugins.js': emptySha256 };
export function validateCandidate(candidate) {
  if (candidate?.schema !== 1 || !candidate.files || typeof candidate.files !== 'object' || Array.isArray(candidate.files)) throw new Error('Invalid mobile candidate manifest.');
  for (const [path, hash] of Object.entries(candidate.files)) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(segment => segment === '..' || segment === '.' || !segment) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid candidate asset path or hash.');
  }
  const digest = createHash('sha256').update(JSON.stringify(candidate.files)).digest('hex');
  if (digest !== candidate.digest || !candidate.files['index.html']) throw new Error('The candidate file manifest does not match its digest.');
}
export async function hashWebAssets(directory) {
  const root = resolve(directory);
  const files = Object.create(null);
  async function walk(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Candidate assets must not include symlinks.');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await walk(root);
  if (!files['index.html']) throw new Error('Candidate has no index.html.');
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { digest, files };
}

export async function verifyFrozenCandidate(path = defaultCandidatePath, nativeDirectory) {
  const candidate = JSON.parse(await readFile(path, 'utf8'));
  validateCandidate(candidate);
  const current = await hashWebAssets('dist');
  if (candidate.schema !== 1 || current.digest !== candidate.digest) throw new Error('The website differs from the frozen mobile candidate. Freeze a new approved candidate before signing.');
  if (nativeDirectory) {
    const native = await hashWebAssets(nativeDirectory);
    for (const [path, hash] of Object.entries(current.files)) {
      if (native.files[path] !== hash) throw new Error(`Native web asset differs from the frozen candidate: ${path}`);
    }
    for (const [path, hash] of Object.entries(native.files)) {
      if (!Object.hasOwn(current.files, path) && generatedNativeAssets[path] !== hash) throw new Error(`Unexpected native web asset: ${path}`);
    }
  }
  return candidate;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const path = process.argv[3] || defaultCandidatePath;
  if (mode === 'freeze') {
    const candidate = { schema: 1, frozenAt: new Date().toISOString(), ...(await hashWebAssets('dist')) };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ candidate: resolve(path), digest: candidate.digest, fileCount: Object.keys(candidate.files).length }));
  } else if (mode === 'verify') {
    const candidate = await verifyFrozenCandidate(path);
    console.log(JSON.stringify({ verified: true, digest: candidate.digest }));
  } else throw new Error('Use mobile-candidate.mjs freeze|verify [candidate.json].');
}
