import{advancePlayback}from'./playback-clock';
import{openingView}from'./opening-view';
import{teachingWording as motionWording}from'./teaching-wording';
import{forwardRef,useEffect,useLayoutEffect,useImperativeHandle,useRef,useState}from'react';
import{Group,Quaternion}from'three';
import{snapshots,DEFAULT_PALETTE,type Palette}from'../core/cube';
import type{DemonstratorHandle,FormulaRecord}from'../demonstrator/types';
import type{TeachingStageProps as BaseProps}from'../demonstrator/TeachingStage';
import type{RestoreSource}from'../wuji-solve-v1/input';
interface TeachingStageProps extends BaseProps{personal:boolean;restore:RestoreSource|null;onView?:(view:'solver'|'side'|'back')=>void;}
type Source=Pick<FormulaRecord,'id'|'steps'|'groups'|'initialState'>;
class PaletteView extends WujiSampleView{palette:Palette=DEFAULT_PALETTE;override update(...args:Parameters<WujiSampleView['update']>){super.update(...args);const[frame,state,move]=args;this.cube.update(state,this.palette,frame.orientation,move,frame.angle);}}
import type{FingerProgram}from'../scene/finger-program';
import{WujiSampleView}from'../wuji-samples/view';
import{isDemonstrationAvailable}from'./availability';
import{createApprovedProgram,sourceBoundary}from'./program';
interface Runtime extends DemonstratorHandle{select(f:FormulaRecord,personal:boolean,restore:RestoreSource|null):void;ghost(v:boolean):void;dispose():void;setPlaybackOptions(speed:number,loopGroup:number|null):void;}
const fingerNames=['','拇指','食指','中指','无名指','小指'];
const phaseNames:Record<string,string>={TRANSFER:'换握',CONTACT:'接触',TURN:'转层',RELEASE:'释放',HOLD:'稳持',APPROACH:'接近'};
const TeachingStage=forwardRef<DemonstratorHandle,TeachingStageProps>(function NewHandStage(props,ref){
 const host=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null),latest=useRef(props);latest.current=props;
 const[ready,setReady]=useState(false),[failure,setFailure]=useState('');
 useImperativeHandle(ref,()=>({play:()=>runtime.current?.play(),pause:()=>runtime.current?.pause(),seek:i=>runtime.current?.seek(i),resetView:()=>runtime.current?.resetView(),setView:v=>runtime.current?.setView(v)}),[]);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  let view:PaletteView;
  try{view=new PaletteView(element);view.renderer.domElement.style.width='100%';view.renderer.domElement.style.height='100%';}catch{const error='这台设备暂时无法显示三维画面。识别图与原表仍可查看。';setFailure(error);latest.current.onStatus({ready:false,playing:false,completed:0,active:0,phase:'三维不可用',finger:'',instruction:'',error});return;}
  let selected:Source=latest.current.formula,personal=false,empty=false,sourceKey="",program:FingerProgram|undefined,states:string[]=[],time=0,playing=false,loaded=false,disposed=false,dirty=true,last=performance.now(),frameId=0,generation=0,renderCount=0,lastEmit=0,error='',viewName:'solver'|'side'|'back'='solver',fittedFront=false,fittedLeft=false,fittedForwardTop=false,fittedMiddleWhole=false,fittedMiddleTip=false,fittedRing=false,fittedLower=false,fittedBack:false|'upper'|'lower'=false;
  let playbackSpeed=latest.current.speed,playbackLoop:number|null=null,loopCycles=0,lastDelta=0;
  const cache=new Map<string,{key:string,time:number,view:'solver'|'side'|'back',camera:number[],target:number[],fov:number,loop:number|null}>();
  const available=()=>!empty&&(personal||isDemonstrationAvailable(selected.id));
  const canPlay=()=>loaded&&!!program&&!error&&available();
  const currentFrame=()=>program?.sample(time);
  const emit=(force=false)=>{
   if(disposed||(!force&&performance.now()-lastEmit<70))return;lastEmit=performance.now();
   const f=currentFrame(),n=selected.steps.length,active=f?Math.min(f.index,n):0,availableNow=available(),ok=canPlay();setReady(ok);setFailure(error);
   const digit=f?.activeFinger,side=f?.active==='left'?'左':'右';
   latest.current.onStatus({ready:ok,playing:ok&&playing,completed:active,active,phase:error?'暂不可播放':empty?'等待录入':!availableNow?'演示校准中':!loaded?'准备动作':phaseNames[f?.stage??'']??'准备',instruction:empty?'拍摄或导入六个面，再生成真实复原演示。':!availableNow?'可先查看识别图、拿法与原表公式。':f?motionWording(f.phase,program?.steps[f.index]?.move)+(selected.steps[f.index]?.hint?.finger==='thumb'&&selected.steps[f.index]?.move.notation==='U'?' · 背面视角看后侧。':selected.steps[f.index]?.hint?.finger==='thumb'&&selected.steps[f.index]?.move.notation==='F'?' · 侧面视角看上侧。':selected.steps[f.index]?.move.notation==='M'?' · 接触时切侧面看末节近景。':selected.steps[f.index]?.move.kind==='wide'&&['B','D'].includes(selected.steps[f.index].move.face)?' · 当前步骤切侧面看末节与释放。':selected.steps[f.index]?.hint?.finger==='ring'&&selected.steps[f.index]?.move.face==='F'?' · 当前步骤切侧面看下侧。':''):'正在载入早期机械手',finger:f?.active?side+'手'+(digit?fingerNames[digit]:f?.stage==='TURN'?'转腕':'换握'):'',...(error?{error}:{})});
  };
  const handsVisible=(show:boolean)=>{for(const child of view.scene.children)if(child instanceof Group&&child!==view.cube.root)child.visible=show;};
  const fit=()=>{
   if(fittedFront||fittedLeft||fittedForwardTop||fittedMiddleWhole||fittedMiddleTip||fittedRing||fittedLower||fittedBack){
    const wideThumb=program?.segments.some(s=>s.stage==='TURN'&&s.finger===1&&s.active==='right'&&program!.steps[s.index].move.kind==='wide'&&program!.steps[s.index].move.face==='F');
    const [minimum,vertical,horizontal]=fittedMiddleWhole?[36,.23,.29]:fittedMiddleTip?[39,.291593,.275037]:fittedBack?(fittedBack==='upper'?[49,.339090,.388091]:[46,.338462,.359714]):fittedLower?[44,.333107,.342451]:fittedRing?[43,.280172,.331598]:fittedForwardTop?[44,.302,.335]:fittedLeft?[42,.294405,.321447]:[47,.343,wideThumb?.407:.372];
    const fov=Math.max(minimum,2*Math.atan(Math.max(vertical,horizontal/view.camera.aspect))*180/Math.PI+6);if(Math.abs(fov-view.camera.fov)>1e-6){view.camera.fov=fov;view.camera.updateProjectionMatrix();}
   }
  };
  const fitNormal=()=>{
   if(fittedFront||fittedLeft||fittedForwardTop||fittedMiddleWhole||fittedMiddleTip||fittedRing||fittedLower||fittedBack){fit();return;}
   // Fit the hand/cube workspace only on a real resize or preset change.
   // User orbit/zoom and document scrolling keep their camera unchanged.
   const distance=view.camera.position.distanceTo(view.controls.target);
   view.camera.fov=Math.max(34,2*Math.atan(.28/(2*distance*view.camera.aspect))*180/Math.PI);
   view.camera.updateProjectionMatrix();
  };
  const applyView=(name:'solver'|'side'|'back')=>{
   viewName=name;fittedFront=false;fittedLeft=false;fittedForwardTop=false;fittedMiddleWhole=false;fittedMiddleTip=false;fittedRing=false;fittedLower=false;fittedBack=false;view.camera.fov=36;view.camera.updateProjectionMatrix();view.reset(name==='solver'?'front':name==='back'?'rear':'side');
   if(name==='solver'){view.camera.position.set(.145,.605,.36);view.controls.target.set(0,.355,0);view.controls.update();}
   if(name==='back'){view.camera.position.set(.16,.49,-.34);view.controls.target.set(0,.355,0);view.controls.update();}
   if(name==='back'&&selected.steps.some(s=>s.move.kind==='slice'||s.move.face==='D')){view.camera.position.set(.16,.22,-.32);view.controls.target.set(0,.33,0);view.controls.update();}
   if(name==='back'&&program?.steps.some(s=>s.move.kind==='slice'&&s.move.notation==='M')){fittedMiddleWhole=true;view.camera.position.set(.10,.24,-.34);view.controls.target.set(0,.33,0);view.controls.update();}
   if(name==='side'&&program?.segments.some(s=>s.stage==='TURN'&&s.finger===1&&s.active==='right'&&["F'","f'"].includes(program!.steps[s.index].move.notation))){fittedFront=true;view.camera.position.set(.10,.06,.12);view.controls.target.set(.01944,.34411,-.00487);view.controls.update();fit();}
   if(name==='side'&&program?.segments.some(s=>s.stage==='TURN'&&s.finger===2&&s.active==='left'&&["F'","f'"].includes(program!.steps[s.index].move.notation))){fittedFront=false;fittedLeft=true;view.camera.position.set(-.12,.62,.16);view.controls.target.set(-.01332625848337611,.3385671279823719,-.006782047651280071);view.controls.update();fit();}
   const forwardThumb=program?.segments.some(s=>s.stage==='TURN'&&s.finger===1&&s.active==='right'&&program!.steps[s.index].move.notation==='F');
   if(name==='side'&&forwardThumb&&program!.steps[Math.min(currentFrame()?.index??0,program!.steps.length-1)]?.move.notation==='F'){fittedFront=false;fittedLeft=false;fittedForwardTop=true;view.camera.position.set(.12,.62,.16);view.controls.target.set(.017381142192165605,.3370667676544447,-.006787757514487458);view.controls.update();fit();}
   const step=Math.min(currentFrame()?.index??0,selected.steps.length-1),move=program?.steps[step]?.move,turn=program?.segments.find(s=>s.index===step&&s.stage==='TURN');
   if(name==='side'&&turn?.active==='right'&&turn.finger===4&&move?.notation==='M'){fittedFront=false;fittedLeft=false;fittedForwardTop=false;fittedMiddleTip=true;view.camera.position.set(.21650635094610965,.55,-.12500000000000003);view.controls.target.set(.00298340502464242,.3370872043189616,.000204205202151975);view.controls.update();}
   if(name==='side'&&turn?.active==='right'&&turn.finger===4&&move?.face==='F'&&move.turns===3){fittedFront=false;fittedLeft=false;fittedForwardTop=false;fittedRing=true;view.camera.position.set(.16,.08,.18);view.controls.target.set(.0187048683065,.3403295068445,-.0145873418951);view.controls.update();}
   if(name==='side'&&turn?.active==='left'&&move?.kind==='wide'&&move.face==='D'){fittedFront=false;fittedLeft=false;fittedForwardTop=false;fittedLower=false;if(turn.finger===2)view.camera.position.set(-.21650635094610965,.10,.12500000000000003);else view.camera.position.set(.16,.22,-.32);view.controls.target.set(0,.33,0);view.controls.update();}
   if(name==='side'&&turn?.active==='right'&&(move?.kind==='wide'||personal)&&move?.face==='B'){const upper=turn.finger===1;fittedFront=false;fittedLeft=false;fittedForwardTop=false;fittedBack=upper?'upper':'lower';view.camera.position.set(.16,upper?.60:.08,-.18);view.controls.target.set(upper?.0383357503254:.0336320658518,upper?.327630860816:.354729071080,upper?.011344878090:.004810937779);view.controls.update();}
   if(personal&&name==='side'&&move?.face==='F'&&turn?.active==='right'){
    fittedFront=false;fittedLeft=false;fittedForwardTop=false;fittedMiddleWhole=false;fittedMiddleTip=false;fittedRing=false;fittedLower=false;fittedBack=false;
    if(turn.finger===1){fittedFront=true;view.camera.position.set(.10,.06,.12);view.controls.target.set(.01944,.34411,-.00487);}
    else{fittedForwardTop=true;view.camera.position.set(.12,.62,.16);view.controls.target.set(.017381142192165605,.3370667676544447,-.006787757514487458);}view.controls.update();
   }
   if(personal&&name==='side'&&move?.face==='D'){view.camera.position.set(.16,.22,-.32);view.controls.target.set(0,.33,0);view.controls.update();}
   if(personal&&name==='side'&&move?.face==='U'){view.camera.position.set(.16,.49,-.34);view.controls.target.set(0,.355,0);view.controls.update();}
   fitNormal();dirty=true;latest.current.onView?.(name);
  };
  const draw=()=>{
   const f=currentFrame();fit();handsVisible(canPlay());
   if(f&&loaded&&program){const i=Math.min(f.index,program.steps.length);view.update(f,states[i],f.complete?undefined:program.steps[i].move);}
   else view.cube.update(selected.initialState,view.palette,new Quaternion());
   view.cube.root.visible=!empty;view.render();renderCount++;
   element.dataset.mode=personal?'personal':'cfop';element.dataset.sourceKey=sourceKey;element.dataset.palette=JSON.stringify(view.palette);element.dataset.duration=String(program?.duration??0);element.dataset.time=String(time);element.dataset.speed=String(playbackSpeed);element.dataset.loopCycles=String(loopCycles);element.dataset.lastDelta=String(lastDelta);element.dataset.view=viewName;element.dataset.formula=selected.id;element.dataset.step=String(f?Math.min(f.index,selected.steps.length):0);element.dataset.state=f?states[Math.min(f.index,states.length-1)]:selected.initialState;element.dataset.angle=String(f?.angle??0);element.dataset.phase=f?.stage??'CALIBRATING';element.dataset.playing=String(playing&&canPlay());element.dataset.availability=canPlay()?'available':available()?'loading':'calibrating';element.dataset.contexts='1';element.dataset.generation=String(generation);element.dataset.renderCount=String(renderCount);element.dataset.camera=JSON.stringify([...view.camera.matrixWorld.elements,...view.camera.projectionMatrix.elements]);
   if(f)element.dataset.pose=JSON.stringify(['left','right'].map(s=>{const p=f[s as 'left'|'right'];return[p.position.toArray(),p.quaternion.toArray(),p.joints];}));else delete element.dataset.pose;
   dirty=false;
  };
  const advanceTo=(now:number)=>{
   const delta=Math.max(0,(now-last)/1000);last=now;lastDelta=delta;
   if(!playing||!program||!canPlay())return;
   const g=selected.groups.find(g=>g.index===playbackLoop);
   const next=advancePlayback(time,delta,playbackSpeed,program.duration,g?{start:sourceBoundary(program,g.start),end:sourceBoundary(program,g.end)}:undefined);
   time=next.time;playing=next.playing;loopCycles+=next.cycles;dirty=true;emit(!playing||next.cycles>0);
  };
  const pause=()=>{advanceTo(performance.now());playing=false;dirty=true;emit(true);};
  const change=()=>{dirty=true;};view.controls.addEventListener('change',change);
  const resize=new ResizeObserver(()=>{fitNormal();dirty=true;});resize.observe(element);
  const hidden=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',hidden);window.addEventListener('axis:app-pause',pause);
  const contextLost=(e:Event)=>{e.preventDefault();error='三维画面暂时中断，请重新加载。原表资料仍保留。';pause();};view.renderer.domElement.addEventListener('webglcontextlost',contextLost);
  const controller:Runtime={
   select(f,own,restore){
    const key=own?(restore?.key??'empty'):f.id;if(sourceKey===key&&personal===own)return;
    if(sourceKey)cache.set(personal?'personal':'cfop',{key:sourceKey,time,view:viewName,camera:view.camera.position.toArray(),target:view.controls.target.toArray(),fov:view.camera.fov,loop:playbackLoop});
    generation++;personal=own;empty=own&&!restore;sourceKey=key;selected=own&&restore?restore:f;view.palette=own&&restore?restore.palette:DEFAULT_PALETTE;
    view.cube.root.visible=false;time=0;playing=false;playbackLoop=null;loopCycles=0;last=performance.now();program=undefined;states=[];error='';handsVisible(false);dirty=true;
    try{if(own&&restore){program=restore.program;states=[...restore.states];}else if(!own&&isDemonstrationAvailable(f.id)){program=createApprovedProgram(f.id);if(program.steps.length!==f.steps.length||program.steps.some((s,i)=>JSON.stringify(s.move)!==JSON.stringify(f.steps[i].move)))throw new Error('原表步骤与动作不一致');states=snapshots(f.initialState,f.steps.map(s=>s.move));}}
    catch{program=undefined;error='动作资料未能加载，已停止机械播放；输入资料保留。';}
    const saved=cache.get(own?'personal':'cfop');applyView(own?'solver':openingView(f));
    if(saved?.key===key){time=saved.time;playbackLoop=null;applyView(saved.view);view.camera.position.fromArray(saved.camera);view.controls.target.fromArray(saved.target);view.camera.fov=saved.fov;view.camera.updateProjectionMatrix();view.controls.update();}
    emit(true);
   },
   play(){if(!canPlay()||!program)return;const g=selected.groups.find(g=>g.index===playbackLoop);if(g&&(time<sourceBoundary(program,g.start)||time>=sourceBoundary(program,g.end)))time=sourceBoundary(program,g.start);if(time>=program.duration)time=0;playing=true;last=performance.now();emit(true);},
   pause,
   seek(i){if(!canPlay()||!program)return;playing=false;time=sourceBoundary(program,i);dirty=true;emit(true);},
   setPlaybackOptions(speed,loopGroup){advanceTo(performance.now());playbackSpeed=speed;playbackLoop=loopGroup;dirty=true;emit(true);},
   setView:applyView,resetView(){applyView(viewName);},ghost(v){if(loaded)view.ghost(v);dirty=true;},
   dispose(){disposed=true;cancelAnimationFrame(frameId);resize.disconnect();view.controls.removeEventListener('change',change);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('axis:app-pause',pause);view.renderer.domElement.removeEventListener('webglcontextlost',contextLost);view.dispose();view.renderer.forceContextLoss();view.renderer.domElement.remove();},
  };
  runtime.current=controller;controller.select(latest.current.formula,latest.current.personal,latest.current.restore);
  void view.load().then(()=>{if(disposed){view.dispose();return;}loaded=true;view.ghost(latest.current.ghostHands);dirty=true;emit(true);}).catch(()=>{if(!disposed){error='早期机械手资源未能载入，请重新加载。';pause();}});
  function animate(now:number){if(disposed)return;advanceTo(now);
   if(dirty){try{draw();}catch{error='三维演示暂时中断，请重新加载后继续。';playing=false;dirty=false;emit(true);}}frameId=requestAnimationFrame(animate);
  }
  frameId=requestAnimationFrame(animate);return()=>{runtime.current=null;controller.dispose();};
 },[]);
 useLayoutEffect(()=>{runtime.current?.select(props.formula,props.personal,props.restore);},[props.formula,props.personal,props.restore]);useLayoutEffect(()=>{runtime.current?.setPlaybackOptions(props.speed,props.loopGroup);},[props.speed,props.loopGroup]);useEffect(()=>{runtime.current?.ghost(props.ghostHands);},[props.ghostHands]);
 return<div ref={host} className="cfop-teaching-stage" style={{position:'absolute',inset:0,overflow:'hidden'}}>{!ready&&!failure&&(props.personal?!!props.restore:isDemonstrationAvailable(props.formula.id))&&<div role="status" className="cfop-stage-message" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',pointerEvents:'none',color:'#b9ccd7'}}>正在准备早期机械手…</div>}</div>;
});
export default TeachingStage;
