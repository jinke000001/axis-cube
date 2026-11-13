import{build}from'vite';import{cpSync,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,existsSync,rmSync}from'node:fs';import{resolve,dirname}from'node:path';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const argv = process.argv.slice(2);
const arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const version = arg('--version', 'axis-u8-r1');
if (!['axis-u8-r1', 'axis-u9-r1', 'axis-u10-r1'].includes(version)) throw Error('Unknown frozen release: ' + version);
const u8 = version === 'axis-u8-r1';
const u10 = version === 'axis-u10-r1';
const updateLock = argv.includes('--update-lock');
const slug = u8 ? 'u8-r1' : 'u9-r1';
const defaultOut = u8 ? 'output/axis-netlify-u8-release-r1' : u10 ? 'output/axis-netlify-u10-release-r1' : 'output/axis-netlify-u9-release-r1';
const out = resolve(arg('--out', defaultOut));
const buildDir = out + '/build', site = out + '/site', manifest = out + '/manifest.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (!out.startsWith(resolve('output') + '/')) throw Error('Explicit versioned output required');
const lockPath = 'release/' + version + '-sources.json';
if (u10 && updateLock && existsSync(out)) {
  rmSync(out, { recursive: true, force: true });
}
const sourceLock = existsSync(lockPath)
  ? JSON.parse(readFileSync(lockPath, 'utf8'))
  : JSON.parse(readFileSync('release/axis-u9-r1-sources.json', 'utf8'));
const expectedIdentity = sourceLock.artifactIdentity;
if (!u10 && (sourceLock.version !== version || !/^[a-f0-9]{64}$/.test(expectedIdentity))) {
  throw Error('Versioned source lock requires a pinned artifact identity');
}
if (existsSync(manifest) && !(u10 && updateLock)) {
  const existing = JSON.parse(readFileSync(manifest, 'utf8'));
  if (existing.version !== version || sha(JSON.stringify(existing.files)) !== existing.identity ||
      (!u10 && existing.identity !== expectedIdentity)) {
    throw Error('Existing release manifest does not match the requested version');
  }
  for (const file of existing.files) {
    if (sha(readFileSync(resolve(site, file.path))) !== file.sha256) {
      throw Error('Existing release changed: ' + file.path);
    }
  }
  console.log(JSON.stringify({reused:true, identity:existing.identity, directory:site}));
  process.exit(0);
}
if(existsSync(out))throw Error('Output already exists without final manifest; use a new output directory');
if (u10 && updateLock) {
  const updatedFiles = {};
  for (const p of Object.keys(sourceLock.files)) {
    if (existsSync(p)) updatedFiles[p] = sha(readFileSync(p));
  }
  sourceLock.version = version;
  sourceLock.files = updatedFiles;
}
const sources = u8 ? sourceLock.sources : {
  ...sourceLock.sources,
  [u10 ? 'exhibition-u10-r1-inputs' : 'exhibition-u9-r1-inputs']: sha(JSON.stringify(sourceLock.files)),
};
for (const [path, expected] of Object.entries(sourceLock.files)) {
  if (sha(readFileSync(path)) !== expected) throw Error('Frozen release input changed: ' + path);
}
mkdirSync(out, { recursive: true });
process.env.AXIS_RELEASE_BUILD_DIR = buildDir;
await build({ configFile: resolve('release-' + slug + '.vite.config.ts') });
if (u8) {
  execFileSync(process.execPath, ['scripts/wuji-samples/package-u8.mjs', buildDir], { stdio: 'inherit' });
} else {
  execFileSync(process.execPath, ['scripts/wuji-samples/package-exhibition.mjs', buildDir, 'exhibition-u9-r1/index.html'], { stdio: 'inherit' });
  mkdirSync(buildDir + '/vendor', { recursive: true });
  cpSync('public/vendor/opencv', buildDir + '/vendor/opencv', { recursive: true });
  cpSync('public/licenses', buildDir + '/licenses', { recursive: true });
}
mkdirSync(site, { recursive: true });
const allowed=/^(?:index\.html|assets\/[\w.-]+\.(?:js|css)|models\/wuji-teaching\/(?:wuji-teaching-hands\.glb|manifest\.json|LICENSE\.txt)|vendor\/opencv\/opencv-4\.13\.0\.js|licenses\/[\w.-]+\.txt|licenses\/opencv-third-party\/[\w.-]+\.txt)$/;
function collect(dir){for(const name of readdirSync(dir).sort()){if(name.startsWith('._'))continue;const p=dir+'/'+name;if(statSync(p).isDirectory())collect(p);else{const relative=p.slice(buildDir.length+1);if(!allowed.test(relative))continue;const target=site+'/'+relative;mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(p));}}}collect(buildDir);
for(const name of['_headers','_redirects'])writeFileSync(site+'/'+name,readFileSync('release/netlify/'+name));writeFileSync(site+'/axis-mark.svg',readFileSync('public/axis-mark.svg'));
writeFileSync(site+'/404.html','<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面未找到 · AXIS</title><body><h1>没有找到这个页面</h1><p><a href="/">返回魔方指法展台</a></p></body></html>\n');
const files=()=>{const rows=[];function scan(p){for(const name of readdirSync(p).sort()){if(name.startsWith('._'))continue;const f=p+'/'+name;if(statSync(f).isDirectory())scan(f);else{const b=readFileSync(f);rows.push({path:f.slice(site.length+1),bytes:b.length,sha256:sha(b)});}}}scan(site);return rows;};
const core=files(),runtimeIdentity=sha(JSON.stringify(core));writeFileSync(site+'/release.json',JSON.stringify({version,cases:119,demonstrations:121,sources,runtimeIdentity})+'\n');const all=files(),identity=sha(JSON.stringify(all)),inventory=JSON.parse(readFileSync('src/wuji-exhibition-u8-r1/accepted-demonstrations.json'));
for(const required of['index.html','_headers','_redirects','axis-mark.svg','release.json','models/wuji-teaching/wuji-teaching-hands.glb','models/wuji-teaching/manifest.json','models/wuji-teaching/LICENSE.txt','vendor/opencv/opencv-4.13.0.js'])if(!all.some(f=>f.path===required))throw Error('Missing runtime '+required);
for(const prefix of['assets/solver.worker-','assets/vision.worker-'])if(!all.some(f=>f.path.startsWith(prefix)&&f.path.endsWith('.js')))throw Error('Missing worker '+prefix);
for(const f of all)if(/(?:^|\/)\._|\.map$|\.env|\.blend|(?:^|\/)(?:src|docs|tests|evidence|drafts|\.git|\.netlify)\//.test(f.path))throw Error('Private file in release '+f.path);
if (u10 && updateLock) {
  sourceLock.artifactIdentity = identity;
  writeFileSync(lockPath, JSON.stringify(sourceLock, null, 2) + '\n');
} else if (identity !== expectedIdentity) {
  throw Error('Build does not match the published ' + version + ' artifact: ' + identity);
}
const changes = u8
  ? ['Release HTML title/favicon/description','Available label and formula count footer','Recovery copy removes local-candidate wording','Same-origin security/permissions/cache headers and routes; true404','Runtime and licenses allowlist only']
  : ['Responsive camera, photo import and capture recovery controls','Export and retry from a valid session after motion preparation fails'];
writeFileSync(manifest,JSON.stringify({version,identity,runtimeIdentity,site,sources,cases:119,demonstrations:inventory.entries.map(e=>({id:e.id,formulaSHA256:e.formulaSHA256})),files:all,changes,excluded:['source maps','evidence','photos','test inputs','drafts','source code','AppleDouble','old samples']},null,2)+'\n');
console.log(JSON.stringify({version,identity,files:all.length,bytes:all.reduce((n,f)=>n+f.bytes,0),directory:site}));
