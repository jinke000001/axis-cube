import{DEMO_PREFERENCE_KEY as LEGACY_KEY,decodePreferences as decodeLegacy}from'../demonstrator/preferences';
export const DEMO_PREFERENCE_KEY='axis.cfop-demonstrator.web.v2';
export interface DemoPreferences { version:2; speed:number; ghostHands:boolean; }
export const DEFAULT_PREFERENCES:DemoPreferences={version:2,speed:1,ghostHands:false};
export function decodePreferences(raw:string|null):DemoPreferences|null {
 if(raw===null)return{...DEFAULT_PREFERENCES};
 try{
  const p=JSON.parse(raw);
  if(!p||typeof p!=='object'||Array.isArray(p)||p.version!==2||![.35,.6,1,2].includes(p.speed)||typeof p.ghostHands!=='boolean'||Object.keys(p).some(k=>!['version','speed','ghostHands'].includes(k)))return null;
  return{version:2,speed:p.speed,ghostHands:p.ghostHands};
 }catch{return null;}
}
/** Legacy storage is read-only. Merely entering or upgrading never writes. */
export async function readDemoPreferences():Promise<DemoPreferences|null>{
 const current=localStorage.getItem(DEMO_PREFERENCE_KEY);
 if(current!==null)return decodePreferences(current);
 const legacy=decodeLegacy(localStorage.getItem(LEGACY_KEY));
 return legacy?{...legacy,version:2}:{...DEFAULT_PREFERENCES};
}
let pendingWrite:Promise<void>=Promise.resolve();
export function saveDemoPreferences(preferences:DemoPreferences):Promise<void>{
 const raw=JSON.stringify(preferences);
 const write=pendingWrite.catch(()=>undefined).then(()=>{
  if(!decodePreferences(raw))throw new Error('未知的演示设置，保留已保存值。');
  if(!decodePreferences(localStorage.getItem(DEMO_PREFERENCE_KEY)))throw new Error('偏好已由其它版本更新，保留原值。');
  localStorage.setItem(DEMO_PREFERENCE_KEY,raw);
 });pendingWrite=write;return write;
}
