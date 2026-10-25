import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(process.argv[2] || 'https://axis-cube-jinke.netlify.app');
if (origin.protocol !== 'https:') throw new Error('Verify the HTTPS production URL.');
const manifest = JSON.parse(await readFile(new URL('../evidence/netlify-release-manifest.json', import.meta.url), 'utf8'));
const htmlOnly = process.argv.includes('--html-only');
const queue = manifest.files.filter(file => htmlOnly ? file.path === 'index.html' : file.path !== '_headers');
// Netlify Edge adds this non-executable hosting comment to public HTML.
// Match only the observed comment for this site; unexpected scripts still fail.
const hostingComment = '\n<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=477c5703-161e-40e9-9635-e481531e432b\n     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->';
const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < queue.length) {
    const file = queue[cursor++];
    try {
      const response = await fetch(new URL(file.path, origin), { signal: AbortSignal.timeout(30000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const normalizedHash = file.path === 'index.html'
        ? createHash('sha256').update(bytes.toString('utf8').replace(hostingComment, '')).digest('hex') : sha256;
      results.push({ path: file.path, status: response.status, bytes: bytes.length,
        sha256, normalizedHash, hostingCommentRemoved: normalizedHash !== sha256,
        passed: response.status === 200 && normalizedHash === file.sha256 });
    } catch (error) { results.push({ path: file.path, passed: false, error: String(error) }); }
  }
}));
const home = await fetch(origin, { signal: AbortSignal.timeout(30000) });
const headers = Object.fromEntries(home.headers);
const requiredHeaders = {
  'content-security-policy': /worker-src 'self'.*frame-ancestors 'none'/,
  'permissions-policy': /camera=\(self\), microphone=\(\), geolocation=\(\)/,
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/,
  'strict-transport-security': /max-age=31536000/,
};
const headerChecks = Object.entries(requiredHeaders).map(([key, pattern]) => ({ key, passed: pattern.test(headers[key] || '') }));
const privatePaths = ['/.env', '/README.md', '/src/App.tsx', '/evidence/netlify-deploy.json', '/tests/fixtures/real-3x3/annotation.json', '/._index.html'];
const unavailable = await Promise.all(privatePaths.map(async path => {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000) });
  await response.body?.cancel();
  return { path, status: response.status, passed: response.status === 404 };
}));
const passed = results.every(item => item.passed) && headerChecks.every(item => item.passed) && unavailable.every(item => item.passed);
const report = { checkedAt: new Date().toISOString(), origin: origin.origin, passed,
  files: results.sort((a,b) => a.path.localeCompare(b.path)), headers, headerChecks, unavailable };
await writeFile(new URL(`../evidence/netlify-online-${htmlOnly ? 'html-' : ''}check.json`, import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ origin: origin.origin, passed, assets: results.filter(item => item.passed).length,
  totalAssets: results.length, headerChecks, unavailable, failures: results.filter(item => !item.passed) }, null, 2));
if (!passed) process.exitCode = 1;
