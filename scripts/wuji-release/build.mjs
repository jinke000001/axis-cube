import{build}from'vite';import{readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const argv=process.argv.slice(2),arg=(k,d)=>argv.includes(k)?argv[argv.indexOf(k)+1]:d,version=arg('--version','axis-u8-r1'),out=resolve(arg('--out','output/axis-netlify-u8-release-r1')),buildDir=out+'/build',site=out+'/site',manifest=out+'/manifest.json',sha=b=>createHash('sha256').update(b).digest('hex');
if(!out.startsWith(resolve('output')+'/')||/[^a-zA-Z0-9._-]/.test(version))throw Error('Explicit versioned output required');
const sourceLock = JSON.parse(readFileSync('release/axis-u8-r1-sources.json', 'utf8'));
const expectedIdentity = version === sourceLock.version ? sourceLock.artifactIdentity : undefined;
if (existsSync(manifest)) {
  const existing = JSON.parse(readFileSync(manifest, 'utf8'));
  if (existing.version !== version || sha(JSON.stringify(existing.files)) !== existing.identity ||
      (expectedIdentity && existing.identity !== expectedIdentity)) {
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
const sources = sourceLock.sources;
for (const [path, expected] of Object.entries(sourceLock.files)) {
  if (sha(readFileSync(path)) !== expected) throw Error('Frozen release input changed: ' + path);
}
mkdirSync(out,{recursive:true});process.env.AXIS_RELEASE_BUILD_DIR=buildDir;await build({configFile:resolve('release-u8-r1.vite.config.ts')});execFileSync(process.execPath,['scripts/wuji-samples/package-u8.mjs',buildDir],{stdio:'inherit'});mkdirSync(site,{recursive:true});
const allowed=/^(?:index\.html|assets\/[\w.-]+\.(?:js|css)|models\/wuji-teaching\/(?:wuji-teaching-hands\.glb|manifest\.json|LICENSE\.txt)|vendor\/opencv\/opencv-4\.13\.0\.js|licenses\/[\w.-]+\.txt|licenses\/opencv-third-party\/[\w.-]+\.txt)$/;
function collect(dir){for(const name of readdirSync(dir).sort()){if(name.startsWith('._'))continue;const p=dir+'/'+name;if(statSync(p).isDirectory())collect(p);else{const relative=p.slice(buildDir.length+1);if(!allowed.test(relative))continue;const target=site+'/'+relative;mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(p));}}}collect(buildDir);
for(const name of['_headers','_redirects'])writeFileSync(site+'/'+name,readFileSync('release/netlify/'+name));writeFileSync(site+'/axis-mark.svg',readFileSync('public/axis-mark.svg'));
writeFileSync(site+'/404.html','<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面未找到 · AXIS</title><body><h1>没有找到这个页面</h1><p><a href="/">返回魔方指法展台</a></p></body></html>\n');
const files=()=>{const rows=[];function scan(p){for(const name of readdirSync(p).sort()){if(name.startsWith('._'))continue;const f=p+'/'+name;if(statSync(f).isDirectory())scan(f);else{const b=readFileSync(f);rows.push({path:f.slice(site.length+1),bytes:b.length,sha256:sha(b)});}}}scan(site);return rows;};
const core=files(),runtimeIdentity=sha(JSON.stringify(core));writeFileSync(site+'/release.json',JSON.stringify({version,cases:119,demonstrations:121,sources,runtimeIdentity})+'\n');const all=files(),identity=sha(JSON.stringify(all)),inventory=JSON.parse(readFileSync('src/wuji-exhibition-u8-r1/accepted-demonstrations.json'));
for(const required of['index.html','_headers','_redirects','axis-mark.svg','release.json','models/wuji-teaching/wuji-teaching-hands.glb','models/wuji-teaching/manifest.json','models/wuji-teaching/LICENSE.txt','vendor/opencv/opencv-4.13.0.js'])if(!all.some(f=>f.path===required))throw Error('Missing runtime '+required);
for(const prefix of['assets/solver.worker-','assets/vision.worker-'])if(!all.some(f=>f.path.startsWith(prefix)&&f.path.endsWith('.js')))throw Error('Missing worker '+prefix);
for(const f of all)if(/(?:^|\/)\._|\.map$|\.env|\.blend|(?:^|\/)(?:src|docs|tests|evidence|drafts|\.git|\.netlify)\//.test(f.path))throw Error('Private file in release '+f.path);
if (expectedIdentity && identity !== expectedIdentity) {
  throw Error('Build does not match the published ' + version + ' artifact: ' + identity);
}
writeFileSync(manifest,JSON.stringify({version,identity,runtimeIdentity,site,sources,cases:119,demonstrations:inventory.entries.map(e=>({id:e.id,formulaSHA256:e.formulaSHA256})),files:all,changes:['Release HTML title/favicon/description','Available label and formula count footer','Recovery copy removes local-candidate wording','Same-origin security/permissions/cache headers and routes; true404','Runtime and licenses allowlist only'],excluded:['source maps','evidence','photos','test inputs','drafts','source code','AppleDouble','old samples']},null,2)+'\n');
console.log(JSON.stringify({version,identity,files:all.length,bytes:all.reduce((n,f)=>n+f.bytes,0),directory:site}));
