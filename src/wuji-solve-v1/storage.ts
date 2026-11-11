import{readSession,type Session}from'../core/session';import{FACES}from'../core/cube';
import{CAPTURE_DRAFT_KEY,LEGACY_DRAFT_KEY,emptyCapture,readCaptureDraft,saveCaptureDraft,type CaptureState}from'../core/capture-state';
export const SOLVE_SESSION_KEY='axis.solve.session.v1',SOLVE_DRAFT_KEY='axis.solve.capture.v2';
export type LocalStoragePort=Pick<Storage,'getItem'|'setItem'>;
export type Stored<T>={value:T|null;origin:'own'|'legacy'|'backup'|'empty'|'protected'|'unavailable';warning:string};
const SESSION_KEY='axis.cube.session.v1';
const exact=(value:unknown,allowed:readonly string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
function session(value:unknown):Session{if(!exact(value,['version','facelets','palette','solution','name','createdAt','method','phases','competition']))throw Error('Unrecognized session fields');return readSession(value);}
function envelope(raw:string){const x=JSON.parse(raw);if(!exact(x,['version','session','previous'])||x.version!==1)throw Error('Unrecognized record');return{version:1 as const,session:session(x.session),previous:x.previous===null?null:session(x.previous)};}
function draft(raw:string):CaptureState{
 if(raw.length>100_000)throw Error('Oversized draft');const x=JSON.parse(raw);if(!exact(x,['version','colors','samples','evidence','locked','turns','fingerprints','uncertain','adjusted','rotations','status','message','previousLegacy'])||x.version!==2||typeof x.colors!=='string'||!(/^[URFDLB?]{54}$/).test(x.colors)||!['incomplete','review','ready'].includes(x.status)||typeof x.message!=='string'||!exact(x.rotations,FACES)||Object.values(x.rotations).some(v=>!Number.isInteger(v)||(v as number)<0||(v as number)>3))throw Error('Unrecognized draft');
 const value=readCaptureDraft({getItem:k=>k===CAPTURE_DRAFT_KEY?raw:k===LEGACY_DRAFT_KEY?x.colors:null,setItem(){throw Error('Read only');}});
 for(const k of['samples','evidence','locked','turns','fingerprints','uncertain','adjusted']as const)if(JSON.stringify(canonical(value[k]))!==JSON.stringify(canonical(x[k])))throw Error('Corrupt draft metadata');
 return value;
}
/** New business writes have their own atomic records. Legacy keys, previous,
 * preferences and learning data are never changed, including on reset. */
export class SolveStore{
 private expectedSession:string|null=null;private expectedDraft:string|null=null;private available=true;
 constructor(private readonly port?:LocalStoragePort){try{this.expectedSession=port?.getItem(SOLVE_SESSION_KEY)??null;this.expectedDraft=port?.getItem(SOLVE_DRAFT_KEY)??null;}catch{this.available=false;}}
 loadSession():Stored<Session>{
  if(!this.available||!this.port)return{value:null,origin:'unavailable',warning:'本机存储不可用，本次结果可下载保存。'};
  if(this.expectedSession!==null){try{return{value:envelope(this.expectedSession).session,origin:'own',warning:''};}catch{return{value:null,origin:'protected',warning:'新版存档损坏或格式较新，原值已保留；本次结果不会覆盖它。'};}}
  let unreadable=false;try{for(const[key,origin]of[[SESSION_KEY,'legacy'],[SESSION_KEY+'.previous','backup']]as const){const raw=this.port.getItem(key);if(raw)try{return{value:readSession(JSON.parse(raw)),origin,warning:origin==='backup'?'已只读恢复旧备份，原存档保留。':'已只读恢复旧局面，新版保存不会覆盖旧记录。'};}catch{unreadable=true;/* Preserve unreadable legacy value. */}}}catch{return{value:null,origin:'unavailable',warning:'本机存储暂时无法读取，原值保留。'};}
  return{value:null,origin:unreadable?'protected':'empty',warning:unreadable?'旧局面无法读取，原值已保留；可重新录入或导入有效文件。':''};
 }
 loadDraft():Stored<CaptureState>{
  if(!this.available||!this.port)return{value:emptyCapture(),origin:'unavailable',warning:'本机存储不可用，录入暂存于本次页面。'};
  if(this.expectedDraft!==null){try{return{value:draft(this.expectedDraft),origin:'own',warning:''};}catch{return{value:emptyCapture(),origin:'protected',warning:'新版草稿损坏或格式较新，原值已保留；本次修改不会覆盖它。'};}}
  try{const value=readCaptureDraft(this.port),legacy=this.port.getItem(CAPTURE_DRAFT_KEY)||this.port.getItem(LEGACY_DRAFT_KEY);return{value,origin:legacy?'legacy':'empty',warning:legacy?(value.colors!==emptyCapture().colors?'已只读恢复旧颜色；照片像素未保存，需重新导入才能调整照片外框。':'旧草稿为空或无法读取，原值已保留；可重新录入。'):''};}catch{return{value:emptyCapture(),origin:'unavailable',warning:'本机存储暂时无法读取，原值保留。'};}
 }
 private write(key:string,raw:string,expected:string|null):boolean{if(!this.available||!this.port)return false;try{if(this.port.getItem(key)!==expected)return false;this.port.setItem(key,raw);return this.port.getItem(key)===raw;}catch{return false;}}
 saveSession(next:Session):boolean{
  try{const value=session(next),old=this.expectedSession===null?null:envelope(this.expectedSession),raw=JSON.stringify({version:1,session:value,previous:old?.session??this.loadSession().value});if(!this.write(SOLVE_SESSION_KEY,raw,this.expectedSession))return false;this.expectedSession=raw;return true;}catch{return false;}
 }
 saveDraft(next:CaptureState):boolean{
  try{if(this.expectedDraft!==null)draft(this.expectedDraft);let raw='';const ok=saveCaptureDraft(next,{getItem:k=>k===LEGACY_DRAFT_KEY?next.colors:null,setItem:(k,v)=>{if(k===CAPTURE_DRAFT_KEY)raw=v;}});if(!ok||!raw)return false;draft(raw);if(!this.write(SOLVE_DRAFT_KEY,raw,this.expectedDraft))return false;this.expectedDraft=raw;return true;}catch{return false;}
 }
 resetDraft():boolean{return this.saveDraft(emptyCapture());}
}
export function localSolveStore(){let port:Storage|undefined;try{port=localStorage;}catch{/* Memory-only UI stays usable. */}return new SolveStore(port);}
