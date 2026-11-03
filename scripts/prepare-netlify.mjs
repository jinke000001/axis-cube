import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The original full-library gate required all 121 trajectories. This explicitly
// authorized phased release preserves all 119 cases / 121 formula records in
// the application bundle while publishing only the 54 accepted trajectories.
// Never repair, author, substitute, or discard a trajectory during packaging.
export const allDemonstrationIds = [
  ...[['f2l', 41], ['oll', 57], ['pll', 21]].flatMap(([stage, count]) =>
    Array.from({ length: count }, (_, index) => `gan-${stage}-${String(index + 1).padStart(2, '0')}`)),
  'gan-pll-01-alt-1', 'gan-pll-02-alt-1',
];
const catalogIds = new Set(allDemonstrationIds);
const allowed = /^(?:index\.html|axis-mark\.svg|_redirects|_headers|assets\/[\w.-]+\.(?:js|css)|motions\/cfop\/gan-(?:f2l|oll|pll)-\d{2}(?:-alt-1)?\.json|licenses\/[\w.-]+\.txt|licenses\/opencv-third-party\/(?:emscripten|flann|flatbuffers|protobuf|zlib)\.txt|vendor\/opencv\/opencv-4\.13\.0\.js|models\/(?:museum|teaching-hand)\/[a-z-]+\.glb|models\/wuji\/(?:LICENSE|hand\/body\/urdf\/(?:left|right)\.urdf|hand\/body\/meshes\/(?:left|right)\/[\w.-]+\.STL))$/;
const requiredPublicFiles = ['index.html', '_headers', '_redirects', 'models/teaching-hand/axis-teaching-hand.glb',
  'models/wuji/LICENSE', 'vendor/opencv/opencv-4.13.0.js', 'licenses/opencv.txt',
  ...['emscripten', 'flann', 'flatbuffers', 'protobuf', 'zlib'].map(name => `licenses/opencv-third-party/${name}.txt`)];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const motionPath = id => `motions/cfop/${id}.json`;

export function validateReleaseManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.mode !== 'phased' || manifest.trajectoryRevision !== 95
    || manifest.totalCases !== 119 || manifest.totalDemonstrations !== 121
    || !Array.isArray(manifest.demonstrations) || manifest.demonstrations.length !== 54)
    throw new Error('Invalid phased CFOP release manifest; expected schema 1, revision 95, and 54 of 121 demonstrations / 119 cases.');
  const ids = new Set();
  for (const record of manifest.demonstrations) {
    if (!record || !catalogIds.has(record.id) || ids.has(record.id)
      || !/^[a-f0-9]{64}$/.test(record.sha256) || !/^[a-f0-9]{1,8}$/.test(record.signature))
      throw new Error(`Invalid or duplicate phased CFOP manifest record: ${record?.id}`);
    ids.add(record.id);
  }
  return manifest;
}

export async function readReleaseManifest(path = new URL('../src/demonstrator/release-manifest.json', import.meta.url)) {
  const bytes = await readFile(path);
  return { manifest: validateReleaseManifest(JSON.parse(bytes.toString('utf8'))), sha256: sha256(bytes) };
}

export function assertMotionIdentity(path, bytes, manifest) {
  const record = manifest.demonstrations.find(item => motionPath(item.id) === path);
  if (!record) throw new Error(`Unexpected CFOP motion record in the release: ${path}`);
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.version !== manifest.trajectoryRevision)
    throw new Error(`CFOP motion revision mismatch: ${path}; expected ${manifest.trajectoryRevision}, received ${data.version}`);
  if (data.signature !== record.signature)
    throw new Error(`CFOP motion signature mismatch: ${path}`);
  if (sha256(bytes) !== record.sha256)
    throw new Error(`CFOP motion SHA256 mismatch: ${path}`);
}

export function assertReleaseFiles(files, manifest) {
  validateReleaseManifest(manifest);
  const paths = new Set();
  const expected = new Map(manifest.demonstrations.map(item => [motionPath(item.id), item]));
  for (const file of files) {
    if (!allowed.test(file.path) || paths.has(file.path)) throw new Error(`Unexpected or duplicate public file: ${file.path}`);
    paths.add(file.path);
    if (file.path.startsWith('motions/')) {
      const record = expected.get(file.path);
      if (!record) throw new Error(`Unexpected CFOP motion record in the release: ${file.path}`);
      if (file.sha256 !== record.sha256) throw new Error(`CFOP motion SHA256 mismatch: ${file.path}`);
    }
  }
  for (const required of [...requiredPublicFiles, ...expected.keys()])
    if (!paths.has(required)) throw new Error(`Missing public file: ${required}`);
  if (!files.some(file => /^assets\/[\w.-]+\.js$/.test(file.path))) throw new Error('Missing built browser application bundle.');
}

export async function prepareNetlify({
  source = new URL('../dist/', import.meta.url),
  releaseManifestPath,
  manifestOutput = new URL('../evidence/netlify-release-manifest.json', import.meta.url),
} = {}) {
  const release = await readReleaseManifest(releaseManifestPath);
  const sourceUrl = source instanceof URL ? source : pathToFileURL(source.endsWith('/') ? source : source + '/');
  const files = [], excluded = [];
  async function collect(relative = '') {
    for (const item of await readdir(new URL(relative, sourceUrl), { withFileTypes: true })) {
      const path = relative + item.name;
      // Exclude AppleDouble metadata without changing the original files.
      if (item.name.startsWith('._') || item.name === '.DS_Store') { excluded.push(path); continue; }
      if (item.isDirectory()) { await collect(path + '/'); continue; }
      if (!item.isFile() || !allowed.test(path)) throw new Error(`Unexpected public file: ${path}`);
      const bytes = await readFile(new URL(path, sourceUrl));
      if (path.startsWith('motions/')) assertMotionIdentity(path, bytes, release.manifest);
      files.push({ path, bytes: bytes.length, sha256: sha256(bytes), content: bytes });
    }
  }
  await collect();
  assertReleaseFiles(files, release.manifest);
  // All checks finish before creating an artifact or replacing prior evidence.
  // A failed export cannot leave a partially validated publish directory.
  const destination = await mkdtemp(join(tmpdir(), 'axis-netlify-'));
  files.sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const target = join(destination, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const manifest = { createdAt: new Date().toISOString(), directory: destination, count: files.length,
    mode: release.manifest.mode, motionRevision: release.manifest.trajectoryRevision,
    totalCases: release.manifest.totalCases, totalDemonstrations: release.manifest.totalDemonstrations,
    readyDemonstrations: release.manifest.demonstrations.length, releaseManifestSha256: release.sha256,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0), excluded: excluded.sort(),
    files: files.map(({ content, ...file }) => file) };
  const outputUrl = manifestOutput instanceof URL ? manifestOutput : pathToFileURL(manifestOutput);
  await mkdir(new URL('.', outputUrl), { recursive: true });
  await writeFile(outputUrl, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await prepareNetlify();
  console.log(JSON.stringify({ directory: manifest.directory, count: manifest.count, bytes: manifest.bytes,
    readyDemonstrations: manifest.readyDemonstrations, motionRevision: manifest.motionRevision,
    excludedCount: manifest.excluded.length }));
}
