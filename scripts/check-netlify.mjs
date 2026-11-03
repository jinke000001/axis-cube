import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { allDemonstrationIds, assertMotionIdentity, assertReleaseFiles, motionPath, readReleaseManifest, sha256 } from './prepare-netlify.mjs';

// Netlify Edge adds this non-executable hosting comment to public HTML.
// Match only the observed comment for this site; unexpected scripts still fail.
const hostingComment = '\n<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=477c5703-161e-40e9-9635-e481531e432b\n     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->';
const normalizeHtml = body => body.replace(hostingComment, '');
const requiredHeaders = {
  'content-security-policy': /worker-src 'self'.*frame-ancestors 'none'/,
  'permissions-policy': /camera=\(self\), microphone=\(\), geolocation=\(\)/,
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/,
  'strict-transport-security': /max-age=31536000/,
};
const privatePaths = ['/.env', '/.git/config', '/README.md', '/src/App.tsx', '/evidence/netlify-deploy.json', '/tests/fixtures/real-3x3/annotation.json', '/._index.html', '/docs/beginner-site-progress.md', '/android/app/build.gradle', '/ios/App/App/Info.plist', '/assets/not-found.js'];
const appRoutes = ['/learn', '/learn/white-daisy', '/learn/not-a-lesson', '/library', '/library/cfop/gan-f2l-01', '/library/cfop/gan-oll-01', '/library/cfop/gan-pll-01', '/library/formulas/white-daisy/daisy-bottom', '/library/fingers/u', '/solve', '/studio', '/help'];

export async function checkNetlify({
  origin = new URL('https://axis-cube-jinke.netlify.app'),
  manifestPath = new URL('../evidence/netlify-release-manifest.json', import.meta.url),
  releaseManifestPath,
  htmlOnly = false,
  fetchImpl = fetch,
  reportPath = new URL(`../evidence/netlify-online-${htmlOnly ? 'html-' : ''}check.json`, import.meta.url),
} = {}) {
  origin = new URL(origin);
  if (origin.protocol !== 'https:') throw new Error('Verify the HTTPS production URL.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const release = await readReleaseManifest(releaseManifestPath);
  assertReleaseFiles(manifest.files, release.manifest);
  if (manifest.mode !== 'phased' || manifest.motionRevision !== release.manifest.trajectoryRevision
    || manifest.totalCases !== 119 || manifest.totalDemonstrations !== 121 || manifest.readyDemonstrations !== 54
    || manifest.releaseManifestSha256 !== release.sha256)
    throw new Error('Prepared artifact does not match the current phased release manifest.');
  const request = path => fetchImpl(new URL(path, origin), { signal: AbortSignal.timeout(30000) });
  const queue = manifest.files.filter(file => htmlOnly ? file.path === 'index.html' : !['_headers', '_redirects'].includes(file.path));
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < queue.length) {
      const file = queue[cursor++];
      try {
        const response = await request(file.path);
        const bytes = Buffer.from(await response.arrayBuffer());
        const hash = sha256(bytes);
        const normalizedHash = file.path.endsWith('.html') ? sha256(normalizeHtml(bytes.toString('utf8'))) : hash;
        let identityError;
        if (file.path.startsWith('motions/')) {
          try { assertMotionIdentity(file.path, bytes, release.manifest); }
          catch (error) { identityError = String(error); }
        }
        results.push({ path: file.path, status: response.status, bytes: bytes.length,
          sha256: hash, normalizedHash, hostingCommentRemoved: normalizedHash !== hash,
          ...(identityError ? { identityError } : {}),
          passed: response.status === 200 && normalizedHash === file.sha256 && !identityError });
      } catch (error) { results.push({ path: file.path, passed: false, error: String(error) }); }
    }
  }));
  const home = await request('/');
  const headers = Object.fromEntries(home.headers);
  await home.body?.cancel();
  const headerChecks = Object.entries(requiredHeaders).map(([key, pattern]) => ({ key, passed: pattern.test(headers[key] || '') }));
  const unavailable = await Promise.all(privatePaths.map(async path => {
    try {
      const response = await request(path);
      await response.body?.cancel();
      return { path, status: response.status, passed: response.status === 404 };
    } catch (error) { return { path, passed: false, error: String(error) }; }
  }));
  const homeFile = manifest.files.find(file => file.path === 'index.html');
  // HTTP can verify delivery of the current app shell. Rendering the selector
  // for retired /learn links is also covered by the browser acceptance flow.
  const routeChecks = await Promise.all(appRoutes.map(async path => {
    try {
      const response = await request(path);
      const body = normalizeHtml(await response.text());
      return { path, status: response.status, appShell: sha256(body) === homeFile.sha256,
        passed: response.status === 200 && sha256(body) === homeFile.sha256 };
    } catch (error) { return { path, passed: false, error: String(error) }; }
  }));
  const readyIds = new Set(release.manifest.demonstrations.map(item => item.id));
  const withheldPath = '/' + motionPath(allDemonstrationIds.find(id => !readyIds.has(id)));
  let unavailableMotion;
  try {
    const response = await request(withheldPath);
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { /* A missing path may serve the SPA HTML. */ }
    const isTrajectory = data && typeof data === 'object'
      && ['version', 'signature', 'times', 'directions', 'arms'].some(key => key in data);
    const htmlFallback = sha256(normalizeHtml(body)) === homeFile.sha256;
    const semanticUnavailable = !isTrajectory && (response.status === 404 || htmlFallback);
    unavailableMotion = { path: withheldPath, status: response.status,
      contentType: response.headers.get('content-type'), htmlFallback, semanticUnavailable,
      // A 200 HTML rewrite is semantically absent but still fails the required
      // real HTTP 404 contract. A leaked JSON trajectory fails even under 404.
      passed: response.status === 404 && semanticUnavailable };
  } catch (error) { unavailableMotion = { path: withheldPath, passed: false, error: String(error) }; }
  const passed = results.every(item => item.passed) && headerChecks.every(item => item.passed)
    && unavailable.every(item => item.passed) && routeChecks.every(item => item.passed) && unavailableMotion.passed;
  const report = { checkedAt: new Date().toISOString(), origin: origin.origin,
    scope: htmlOnly ? 'html-only' : 'complete-phased-release', passed,
    motionRevision: release.manifest.trajectoryRevision, readyDemonstrations: release.manifest.demonstrations.length,
    files: results.sort((a, b) => a.path.localeCompare(b.path)), headers, headerChecks, unavailable, routeChecks, unavailableMotion };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const htmlOnly = process.argv.includes('--html-only');
  const report = await checkNetlify({ origin: process.argv.slice(2).find(value => !value.startsWith('--')), htmlOnly });
  console.log(JSON.stringify({ origin: report.origin, scope: report.scope, passed: report.passed,
    assets: report.files.filter(item => item.passed).length, totalAssets: report.files.length,
    headerChecks: report.headerChecks, unavailable: report.unavailable, routeChecks: report.routeChecks,
    unavailableMotion: report.unavailableMotion, failures: report.files.filter(item => !item.passed) }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
