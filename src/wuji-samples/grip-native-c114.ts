import{Quaternion,Vector3}from'three';
import{NORMALS,type Move}from'../core/cube';
import type{FingerProgram,FingerSegment}from'../scene/finger-program';
import{type MotionFrame,type Side}from'../scene/motion';
import{createTipFlickProgram}from'./tip-flick';import{createLeftSideFlickProgram}from'./left-side-flick';
import{createThumbSideFlickProgram}from'./thumb-side-flick';import{createLocalU2Program}from'./compact-relay-local-c111';
import{createOuterWristProgram}from'./outer-primitives-c113';
import{idlePose,transportGrip}from'./grip-poses-c114';
import{contextWristC114}from'./grip-context-c114';
import type{HandPose}from'../scene/motion';import type{FingerContact}from'../scene/finger-contact';
import u2Idle from'../../art/wuji-teaching/grip-c114-r1/u2-idle-a3.json';
export type C114Instruction={move:Move;hand?:Side;finger?:1|2|3|4|5};
export function assembleC114(parts:readonly FingerSegment[],moves:readonly Move[]):FingerProgram{
 let duration=0;const segments=parts.map(s=>{const out={...s,start:duration};duration+=s.duration;return out;}),steps=moves.map((move,index)=>{const own=segments.filter(s=>s.index===index);return{move,start:own[0].start,duration:own.at(-1)!.start+own.at(-1)!.duration-own[0].start,active:own.find(s=>s.stage==='TURN')?.active??'right'};});
 return{duration,cost:duration,steps,segments,statistics:{fingerTurns:segments.filter(s=>s.stage==='TURN'&&s.finger).length,wristTurns:segments.filter(s=>s.stage==='TURN'&&!s.finger).length,regrips:0,retainedWrists:0,reorientations:0},sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?moves.length:s.index,angle:complete?0:f.angle,complete,orientation:new Quaternion(),stage:s.stage,phase:s.phase,active:complete?null:s.active,support:s.active==='left'?'right':'left',activeFinger:s.finger,progress};}};
}
const cache=new Map<string,FingerProgram>();
export function nativeC114(instruction:C114Instruction,before?:number,options:{context?:boolean;support?:{pose:HandPose;contacts:FingerContact[]}}={}):FingerProgram{
 const {move}=instruction,key=JSON.stringify([instruction,before,options]);if(cache.has(key))return cache.get(key)!;
 let old:FingerProgram,active:Side,digits:readonly(2|3|4|5)[];
 if(!move.kind&&['R','L'].includes(move.face)){old=createOuterWristProgram(move.notation,before);active=move.face==='R'?'right':'left';digits=[];}
 else if(!move.kind&&move.face==='U'){
  if(move.turns===2){if(move.notation!== 'U2')throw Error('C114 reverse U2 still pending');old=createLocalU2Program();active='right';digits=[4,5];}
  else if(instruction.finger===1){if(instruction.hand!=='right'||move.turns!==3)throw Error('Unknown original thumb direction');old=createThumbSideFlickProgram();active='right';digits=[2,3,4,5];}
  else if(move.turns===3){old=createLeftSideFlickProgram();active='left';digits=[3,4,5];}
  else{old=createTipFlickProgram();active='right';digits=[3,4,5];}
 }else throw Error('C114 native family not migrated yet: '+move.notation);
 const other:Side=active==='left'?'right':'left',wrist=digits.length===0;
 const parts=old.segments.map(s=>({...s,phase:'G1 · '+s.phase,sample:(p:number)=>{
  const f=s.sample(p),fixed=options.support??transportGrip(other,f[other]);
  if(!wrist){
   const moving=idlePose(active,f[active],digits);
   if(move.face==='U'&&move.turns===2)for(const digit of['4','5']as const)for(let j=0;j<4;j++)moving.joints![`${active}_finger${digit}_joint${j+1}`]=u2Idle.angles[digit][j];
   return{...f,[other]:fixed.pose,[active]:moving,contacts:[...fixed.contacts,...f.contacts.filter(c=>c.side===active)]};
  }
  const driven=options.context&&active==='right'?contextWristC114(f[active]):transportGrip(active,f[active]),axis=new Vector3(...NORMALS[move.face]);
  const drives=driven.contacts.map(c=>({...c,role:'drive' as const,point:c.point.clone().applyAxisAngle(axis,-f.angle),normal:c.normal.clone().applyAxisAngle(axis,-f.angle)}));
  return{...f,[other]:fixed.pose,[active]:driven.pose,contacts:[...fixed.contacts,...drives]};
 }}));
 const result=assembleC114(parts,[move]);cache.set(key,result);return result;
}
