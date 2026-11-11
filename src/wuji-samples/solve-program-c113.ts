import{Quaternion,Vector3}from'three';import{NORMALS,moveAngle,type Move}from'../core/cube';
import{clonePose,fingerContacts,fingerLibrary,handPose,oppositeHand}from'../scene/finger-data';import type{FingerProgram,FingerSegment}from'../scene/finger-program';import type{FingerContact}from'../scene/finger-contact';import type{Side,HandPose,MotionFrame}from'../scene/motion';
import{createTipFlickProgram}from'./tip-flick';import{createLeftSideFlickProgram}from'./left-side-flick';import{createLocalU2Program}from'./compact-relay-local-c111';import{createFrontFlickProgram}from'./front-flick';import{createBackFlickProgram}from'./back-flick';import{createBottomRingProgram}from'./bottom-ring';import{createLocalBottomDoubleProgram}from'./bottom-double-local-c110';
import{createOuterWristProgram,createOuterDoubleFlickProgram}from'./outer-primitives-c113';import{createReverseDoubleProgram}from'./reverse-double-c113';import{leftWristHandoff}from'./left-wrist-handoff-c113';import type{HandoffPart}from'./compact-handoff';import{frontHandoff}from'./front-handoff';import{backHandoff}from'./back-handoff';import{ringHandoff}from'./ring-handoff';import{bottomSupportHandoff}from'./bottom-support-handoff';import{rightHalfHandoff}from'./right-half-handoff';
import{createDoubleStrokeProgram}from'./double-stroke-c110';
import{localFlickHandoff}from'./local-flick-handoff-c113';import type{FingerIndex}from'../scene/finger-rig';
export const SOLVE_OUTER_NOTATIONS=['U',"U'",'U2',"U2'",'R',"R'",'R2',"R2'",'F',"F'",'F2',"F2'",'D',"D'",'D2',"D2'",'L',"L'",'L2',"L2'",'B',"B'",'B2',"B2'"] as const;
type Family='standard'|'front'|'back'|'ring'|'bottom-support'|'left-wrist'|'right-wrist';
type Guide={pad:Vector3;normal:Vector3;finger:number;family:Family};
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-8);
// Reuse only exact accepted endpoints/poses of the context-aware C110 R/U bridge.
const context=createDoubleStrokeProgram('gan-f2l-40').segments.filter(s=>s.stage==='TRANSFER'&&s.active==='right');
function contextual(parts:HandoffPart[],side:Side){return parts.map(part=>{if(side!=='right')return part;const old=context.find(s=>same(s.sample(0).right,part.sample(0))&&same(s.sample(1).right,part.sample(1)));return old?{duration:old.duration,phase:'C110已验连接 · '+old.phase,sample:(p:number)=>old.sample(p).right}:part;});}
const nativeCache=new Map<string,FingerProgram>(),bridgeCache=new Map<string,HandoffPart[]>(),sampleCache=new Map<string,FingerSegment['sample']>();
function nativeUncached(move:Move,before?:number):FingerProgram{
 if(move.kind||!SOLVE_OUTER_NOTATIONS.includes(move.notation as typeof SOLVE_OUTER_NOTATIONS[number]))throw Error('尚未验证的复原动作：'+move.notation);
 if(['R','L'].includes(move.face))return createOuterWristProgram(move.notation,before);
 if(move.face==='U'){
  if(move.turns===2)return moveAngle(move)>0?createReverseDoubleProgram(move.notation):createLocalU2Program();
  return move.turns===3?createLeftSideFlickProgram():createTipFlickProgram();
 }
 if(move.face==='D'){
  if(move.turns===2)return moveAngle(move)>0?createReverseDoubleProgram(move.notation):createLocalBottomDoubleProgram();
  return createBottomRingProgram(move.turns===3);
 }
 if(move.turns===2)return createOuterDoubleFlickProgram(move.notation);
 return move.face==='F'?createFrontFlickProgram(move.turns===3):createBackFlickProgram(move.turns===3);
}
function native(move:Move,before?:number){const key=JSON.stringify([move,before]);let p=nativeCache.get(key);if(!p){p=nativeUncached(move,before);nativeCache.set(key,p);}return p;}
/** Compile the real solver sequence at its native teaching cadence. No formula
 * substitution, whole-cube remapping, hidden layer expansion or five-second cap. */
export type RestoreProgram=FingerProgram&{readonly geometryStateKey:string};
export function compileRestoreProgram(moves:readonly Move[]):RestoreProgram{
 const low={left:handPose(fingerLibrary.hands.left.support),right:handPose(fingerLibrary.hands.right.support)},held={left:clonePose(low.left),right:clonePose(low.right)},contacts:Record<Side,FingerContact[]>={left:fingerContacts('left',fingerLibrary.hands.left.contacts),right:fingerContacts('right',fingerLibrary.hands.right.contacts)};
 const standard=(side:Side):Guide=>({pad:new Vector3().fromArray(fingerLibrary.hands[side].gripContacts.find(c=>c.finger===2)!.padOffset),normal:new Vector3(side==='left'?-1:1,0,0),finger:2,family:'standard'});
 const guides={left:standard('left'),right:standard('right')},wrist:Partial<Record<Side,number>>={},segments:FingerSegment[]=[],steps:FingerProgram['steps'][number][]=[];let index=0,time=0,regrips=0;
 const add=(s:Omit<FingerSegment,'index'|'start'>)=>{const part={...s,index,start:time};segments.push(part);time+=s.duration;const end=s.sample(1);held.left=clonePose(end.left);held.right=clonePose(end.right);};
 function transfer(side:Side,target:HandPose,to:Guide){
  if(same(target,low[side]))to=standard(side);
  if(same(held[side],target)){guides[side]=to;return;}
  const other=oppositeHand(side),fixed=clonePose(held[other]),support=contacts[other].slice(),from=guides[side];if(support.length<3)throw Error('换握前缺少另一手三个支撑');
  const bridgeKey=JSON.stringify([side,held[side],target,from,to]);let parts=bridgeCache.get(bridgeKey);
  if(parts){}else if(from.family===to.family&&['standard','front','back','ring'].includes(to.family)&&from.finger===to.finger&&!same(held[side],low[side])&&!same(target,low[side])&&held[side].quaternion.clone().normalize().angleTo(target.quaternion.clone().normalize())<1e-7)parts=localFlickHandoff(side,held[side],target,from.finger as FingerIndex,from.pad,to.pad,from.normal,to.normal);
  else if(side==='right'&&(from.family==='bottom-support'||to.family==='bottom-support'))parts=bottomSupportHandoff(held[side],target);
  else if(side==='left'&&(from.family==='left-wrist'||to.family==='left-wrist'))parts=leftWristHandoff(held[side],target,from.pad,to.pad,from.normal,to.normal);
  else if(from.family==='front'||to.family==='front')parts=frontHandoff(side,held[side],target,from.pad,to.pad,from.normal,to.normal,from.finger===1||to.finger===1?1:undefined);
  else if(from.family==='back'||to.family==='back')parts=backHandoff(side,held[side],target,from.pad,to.pad,from.normal,to.normal,from.finger===1||to.finger===1?1:undefined);
  else if(from.family==='ring'||to.family==='ring')parts=ringHandoff(side,held[side],target,from.pad,to.pad,from.normal,to.normal,4);
  else parts=rightHalfHandoff(side,held[side],target,from.pad,to.pad,from.normal,to.normal,from.finger===1||to.finger===1?1:undefined);
  if(!bridgeCache.has(bridgeKey)){parts=contextual(parts!,side);bridgeCache.set(bridgeKey,parts);}
  for(const[j,part]of parts!.entries()){
   const key=JSON.stringify([bridgeKey,j,fixed,support]);let sample=sampleCache.get(key);if(!sample){sample=p=>({left:side==='left'?part.sample(p):clonePose(fixed),right:side==='right'?part.sample(p):clonePose(fixed),angle:0,contacts:support});sampleCache.set(key,sample);}
   add({duration:part.duration,stage:'TRANSFER',phase:'C113连接 · '+part.phase,active:side,sample});
  }
  contacts[side]=[];guides[side]=to;delete wrist[side];regrips++;
 }
 function home(side:Side){if(same(held[side],low[side])){contacts[side]=fingerContacts(side,fingerLibrary.hands[side].contacts);guides[side]=standard(side);delete wrist[side];return;}const other=oppositeHand(side);if(contacts[other].length<3){if(contacts[side].length<3)throw Error('双手均未接稳');home(other);}transfer(side,low[side],standard(side));contacts[side]=fingerContacts(side,fingerLibrary.hands[side].contacts);}
 for(index=0;index<moves.length;index++){
  const move=moves[index],start=time,active:Side=move.face==='L'||move.face==='D'||(move.face==='U'&&(move.turns===3||move.turns===2&&moveAngle(move)>0))?'left':'right',other=oppositeHand(active),family:Family=move.face==='F'?'front':move.face==='B'?'back':move.face==='D'?'ring':move.face==='L'?'left-wrist':move.face==='R'?'right-wrist':'standard';
  // Support-family changes first restore the free hand, then move the supporting
  // hand. Only a side with three measured supports can release the other.
  const needed=family==='front'||family==='back'?family:'standard';
  if((guides[active].family==='front'||guides[active].family==='back')&&guides[active].family!==needed)home(active);
  if((guides[other].family==='front'||guides[other].family==='back')&&guides[other].family!==needed){home(active);home(other);}
  if(guides[active].family==='bottom-support')home(active);
  if(guides[other].family==='bottom-support'&&move.face!=='D'){home(active);home(other);}
  let before:number|undefined;
  if(['R','L'].includes(move.face)&&wrist[active]!==undefined&&Math.abs(wrist[active]!+moveAngle(move))<=Math.PI/2+1e-8)before=wrist[active];
  const p=native(move,before),initial=p.segments[0].sample(0),support=initial.contacts.filter(c=>c.side===other&&c.role==='support');
  if(!same(held[other],initial[other])){
   home(active);home(other);const c=support.find(c=>c.finger===1)??support[0];if(!c)throw Error('原生动作缺少支撑');
   const supportFamily:Family=move.face==='D'?'bottom-support':family==='front'||family==='back'?family:'standard';
   transfer(other,initial[other],{pad:c.padOffset.clone(),normal:c.normal.clone(),finger:c.finger,family:supportFamily});contacts[other]=support;
  }else contacts[other]=support;
  const turns=p.segments.filter(s=>s.stage==='TURN'),first=turns[0],drive=first.sample(0).contacts.find(c=>c.role==='drive')!;
  if(family==='ring'&&guides[active].family==='ring'&&held[active].quaternion.clone().normalize().angleTo(initial[active].quaternion.clone().normalize())>1e-7)home(active);
  transfer(active,initial[active],{pad:drive.padOffset.clone(),normal:drive.normal.clone(),finger:drive.finger,family});
  if(!same(held.left,initial.left)||!same(held.right,initial.right))throw Error('原生动作入口双手未同步');
  for(const s of p.segments.filter(s=>s.stage!=='HOLD'))add({...s,phase:'复原 · '+s.phase});
  const last=turns.filter(t=>move.face==='U'&&move.turns===2?t.finger===2:true).at(-1)!,f=last.sample(1),witness=f.contacts.find(c=>c.role==='drive')!;
  guides[active]={pad:witness.padOffset.clone(),normal:witness.normal.clone().applyAxisAngle(new Vector3(...NORMALS[move.face]),f.angle),finger:witness.finger,family};
  contacts[active]=['R','L'].includes(move.face)?fingerContacts(active,fingerLibrary.hands[active].gripContacts,'support',new Quaternion().setFromAxisAngle(new Vector3(...NORMALS[move.face]),(before??(move.turns===2?-Math.sign(moveAngle(move))*Math.PI/2:moveAngle(move)<0?0:-Math.PI/2))+moveAngle(move))):[];
  contacts[other]=support;
  if(['R','L'].includes(move.face))wrist[active]=(before??(move.turns===2?-Math.sign(moveAngle(move))*Math.PI/2:moveAngle(move)<0?0:-Math.PI/2))+moveAngle(move);else delete wrist[active];
  steps.push({move,start,duration:time-start,active});
 }
 const geometryStateKey=JSON.stringify([held,contacts,guides,wrist]),final={left:clonePose(held.left),right:clonePose(held.right)},lastAngle=moves.length?moveAngle(moves.at(-1)!):0;index=Math.max(0,moves.length-1);
 const holdKey=JSON.stringify(['hold',final,contacts,lastAngle]);let hold=sampleCache.get(holdKey);if(!hold){const finalContacts=[...contacts.left,...contacts.right];hold=()=>({left:clonePose(final.left),right:clonePose(final.right),angle:lastAngle,contacts:finalContacts});sampleCache.set(holdKey,hold);}
 add({duration:.6,stage:'HOLD',phase:moves.length?'复原完成 · 稳持':'已经还原 · 无需转层',active:null,sample:hold});if(steps.length)steps.at(-1)!.duration+=.6;
 const duration=time;
 return{steps,segments,duration,cost:duration,geometryStateKey,sample(t):MotionFrame{const complete=t>=duration||!moves.length;let lo=0,hi=segments.length-1;while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(segments[mid].start<=t)lo=mid;else hi=mid-1;}const s=segments[lo],progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?moves.length:s.index,complete,angle:complete?0:f.angle,orientation:new Quaternion(),phase:s.phase,stage:s.stage,active:complete?null:s.active,support:s.active?oppositeHand(s.active):'left',activeFinger:s.finger,progress};},statistics:{fingerTurns:segments.filter(s=>s.stage==='TURN'&&s.finger).length,wristTurns:segments.filter(s=>s.stage==='TURN'&&!s.finger).length,regrips,retainedWrists:0,reorientations:0}};
}
