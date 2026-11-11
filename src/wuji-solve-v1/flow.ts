import{validateFacelets,type Palette}from'../core/cube';import{newSession,readSession,type Session}from'../core/session';import type{SolveResult}from'../core/solver';import{prepareRestore,type RestoreSource}from'./input';import type{SolveStore}from'./storage';
export interface SolveRunner{solve(state:string,onPhase?:(phase:string)=>void):Promise<SolveResult>;cancel():void;}
export interface RestoreFlowState{source:RestoreSource|null;recovery:Session|null;capturing:boolean;busy:boolean;phase:string;error:string;notice:string;}
/** Owns asynchronous submit/cancel and the single permitted session write.
 * Input mutations invalidate both queued worker responses and imports. */
export class RestoreFlow{
 private revision=0;private listeners=new Set<()=>void>();private current:RestoreFlowState;
 constructor(private readonly store:SolveStore,private readonly runner:SolveRunner){const saved=store.loadSession();let source:RestoreSource|null=null,notice=saved.warning;try{if(saved.value)source=prepareRestore(saved.value);}catch{notice='已保留旧局面；原解序不能直接演示，请重新计算。';}this.current={source,recovery:saved.value,capturing:false,busy:false,phase:'idle',error:'',notice};}
 snapshot=()=>this.current;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private patch(patch:Partial<RestoreFlowState>){this.current={...this.current,...patch};this.listeners.forEach(fn=>fn());}
 private invalidate(){this.revision++;this.runner.cancel();}
 openCapture=()=>{this.invalidate();this.patch({capturing:true,busy:false,error:'',phase:'idle'});};
 closeCapture=()=>{this.invalidate();this.patch({capturing:false,busy:false,error:'',phase:'idle'});};
 cancel=()=>{this.invalidate();this.patch({busy:false,phase:'idle',error:'',notice:'已取消计算，录入资料仍保留。'});};
 inputChanged=()=>{const pending=this.current.busy;this.invalidate();this.patch({busy:false,phase:'idle',error:'',...(pending?{notice:'录入已改变，上一轮计算已取消。'}:{})});};
 async submit(facelets:string,palette:Palette,name='我的魔方'){
  this.invalidate();const token=this.revision,valid=validateFacelets(facelets,palette);if(!valid.valid){this.patch({busy:false,error:valid.message});return;}
  this.patch({busy:true,error:'',notice:'',phase:'planning'});
  try{const result=await this.runner.solve(facelets,phase=>{if(token===this.revision)this.patch({phase});});if(token!==this.revision)return;this.patch({phase:'choreographing'});
   if(result.method!=='cfop'&&result.method!=='short')throw Error('求解结果格式不匹配，请重试。');
   this.accept(newSession(facelets,result.solution,palette,name,{method:result.method,phases:result.phases}),token);
  }catch(e){if(token===this.revision)this.patch({busy:false,phase:'idle',error:e instanceof Error?e.message:'求解失败，录入资料已保留。'});}
 }
 private accept(raw:Session,token:number){const session=readSession(raw),source=prepareRestore(session);if(token!==this.revision)return;const saved=this.store.saveSession(session);this.patch({source,recovery:session,busy:false,capturing:false,phase:'ready',error:'',notice:saved?'已保存在本机，可开始复原。':'演示已生成，但未能写入存档；原资料保留，可下载局面文件。'});}
 async importSession(file:File):Promise<string|void>{this.invalidate();const token=this.revision;try{if(file.size>1_000_000)throw Error('局面文件过大，请选择AXIS导出的局面文件。');const raw=JSON.parse(await file.text());if(token!==this.revision)return'导入已取消，原资料保留。';this.accept(readSession(raw),token);}catch(e){const message=e instanceof Error?e.message:'局面文件无法读取。';if(token===this.revision)this.patch({error:message,busy:false});return message;}}
 dispose(){this.invalidate();this.listeners.clear();}
}
