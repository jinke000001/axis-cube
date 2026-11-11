import{mkdirSync,copyFileSync,readFileSync,writeFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const out=resolve(process.argv[2]??'exhibition-dist');copyFileSync(out+'/'+(process.argv[3]??'exhibition/index.html'),out+'/index.html');
mkdirSync(out+'/models/wuji-teaching',{recursive:true});const assets=[];
for(const name of ['wuji-teaching-hands.glb','manifest.json','LICENSE.txt']){const source='public/models/wuji-teaching/'+name;copyFileSync(source,out+'/models/wuji-teaching/'+name);assets.push({path:'models/wuji-teaching/'+name,sha256:createHash('sha256').update(readFileSync(source)).digest('hex')});}
writeFileSync(out+'/sample-assets.json',JSON.stringify({kind:'local-new-hand-exhibition',assets},null,2)+'\n');
console.log('Local exhibition root route and original white-hand assets copied.');
