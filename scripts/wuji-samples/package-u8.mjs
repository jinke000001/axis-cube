import{cpSync,copyFileSync,mkdirSync,readdirSync,readFileSync,writeFileSync,statSync}from'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const out=process.argv[2]??'output/exhibition-u8-r1';execFileSync(process.execPath,['scripts/wuji-samples/package-exhibition.mjs',out,'exhibition-u8-r1/index.html'],{stdio:'inherit'});
// The unchanged photo detector imports its same-origin runtime dynamically.
// Vite copyPublicDir=false means this dependency must be copied explicitly.
mkdirSync(out+'/vendor',{recursive:true});cpSync('public/vendor/opencv',out+'/vendor/opencv',{recursive:true});
cpSync('public/licenses',out+'/licenses',{recursive:true});
const files={};function add(p){for(const name of readdirSync(p)){if(name.startsWith('._'))continue;const f=p+'/'+name;if(statSync(f).isDirectory())add(f);else files[f.slice(out.length+1)]=createHash('sha256').update(readFileSync(f)).digest('hex');}}add(out+'/vendor/opencv');writeFileSync(out+'/photo-runtime-assets.json',JSON.stringify({scope:'Unchanged local photo-recognition runtime and bundled license; no external runtime download.',files},null,2)+'\n');console.log(JSON.stringify({photoRuntimeFiles:Object.keys(files).length}));
