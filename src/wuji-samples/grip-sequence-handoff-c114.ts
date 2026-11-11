import{Vector3}from'three';
import{blendFingerPose,clonePose,fingerLibrary}from'../scene/finger-data';
import type{FingerContact}from'../scene/finger-contact';import{smooth,type HandPose,type Side}from'../scene/motion';
import{compactHandoff,type HandoffPart}from'./compact-handoff';
import fitted from'../../art/wuji-teaching/grip-c114-r1/swept-library-handoffs-a1.json';
export type GripGuide={finger:1|2|3|4|5;pad:Vector3;normal:Vector3};
export type GripRoutePlan={clearance:number;offset:number[];jointPower:number;wristPower:number};
export type GripHandoffSpec={key:string;side:Side;from:HandPose;to:HandPose;fromContacts:readonly FingerContact[];toContacts:readonly FingerContact[];fromGuide:GripGuide;toGuide:GripGuide};
let observer:((s:GripHandoffSpec)=>void)|undefined;
export const observeGripHandoffsC114=(fn:typeof observer)=>{observer=fn;};
const poseKey=(p:HandPose)=>[p.position.toArray(),p.quaternion.toArray(),Object.entries(p.joints!).sort().map(e=>e[1])].flat().map(n=>(n as number).toFixed(9));
const handoffKey=(s:Omit<GripHandoffSpec,'key'>)=>JSON.stringify([s.side,poseKey(s.from),poseKey(s.to),s.fromContacts.map(c=>c.normal.toArray()),s.toContacts.map(c=>c.normal.toArray()),s.fromGuide.normal.toArray(),s.toGuide.normal.toArray()]);
function clearanceVector(contacts:readonly FingerContact[],fallback:Vector3,distance:number){
 const normals:Vector3[]=[];for(const c of contacts){const n=c.normal.clone().normalize();if(!normals.some(v=>v.distanceTo(n)<1e-6))normals.push(n);}
 if(!normals.length)normals.push(fallback.clone().normalize());
 const offset=normals.reduce((v,n)=>v.addScaledVector(n,distance),new Vector3());
 if(normals.some(n=>offset.dot(n)<distance*.8))throw Error('C114 opposed contact normals need a dedicated finger gait');
 return offset;
}
export function sampleGripRouteC114(spec:GripHandoffSpec,plan:GripRoutePlan,p:number){
 const a=clonePose(spec.from),b=clonePose(spec.to);
 a.position.add(clearanceVector(spec.fromContacts,spec.fromGuide.normal,plan.clearance));
 b.position.add(clearanceVector(spec.toContacts,spec.toGuide.normal,plan.clearance));
 const t=smooth(p),pose=blendFingerPose(a,b,smooth(p**plan.jointPower));
 pose.quaternion.slerpQuaternions(a.quaternion,b.quaternion,smooth(p**plan.wristPower));
 pose.position.copy(a.position).lerp(b.position,t).addScaledVector(new Vector3().fromArray(plan.offset),Math.sin(Math.PI*t));
 return pose;
}
/** Contact-aware release and approach surround the existing fingertip-guided
 * path. A side-only withdrawal can skim a loaded top thumb; the union of
 * actual contact normals gives every loaded pad positive normal clearance.
 * Native C5 drive data and shared handoff implementation stay unchanged. */
export function gripHandoffC114(side:Side,from:HandPose,to:HandPose,fromContacts:readonly FingerContact[],toContacts:readonly FingerContact[],fromGuide:GripGuide,toGuide:GripGuide,clearance=.012,mode:'guide'|'normal-arc'='normal-arc',bow=.03):HandoffPart[]{
 const specBase={side,from,to,fromContacts,toContacts,fromGuide,toGuide},key=handoffKey(specBase),spec={...specBase,key};observer?.(spec);
 const plan=(fitted.records as Record<string,GripRoutePlan>)[key];if(plan)clearance=plan.clearance;
 const a=clonePose(from),b=clonePose(to);a.position.add(clearanceVector(fromContacts,fromGuide.normal,clearance));b.position.add(clearanceVector(toContacts,toGuide.normal,clearance));
 const finger:1|2=fromGuide.finger===1||toGuide.finger===1?1:2;
 const fallback=()=>new Vector3().fromArray(fingerLibrary.hands[side].gripContacts.find(c=>c.finger===finger)!.padOffset);
 const pad=(g:GripGuide,contacts:readonly FingerContact[])=>g.finger===finger?g.pad.clone():contacts.find(c=>c.finger===finger)?.padOffset.clone()??fallback();
 let core:HandoffPart[];
 if(mode==='guide')core=compactHandoff(side,a,b,pad(fromGuide,fromContacts),pad(toGuide,toContacts),fromGuide.normal,toGuide.normal,finger);
 else{
  const normals=[...fromContacts,...toContacts],direction=normals.reduce((v,c)=>v.add(c.normal),new Vector3());if(direction.lengthSq()<1e-8)direction.set(side==='right'?1:-1,0,0);direction.normalize();
  const selected=plan??{clearance,offset:direction.multiplyScalar(bow).toArray(),jointPower:1,wristPower:1};
  const sample=(p:number)=>sampleGripRouteC114(spec,selected,p);
  let length=0,last=sample(0).position;for(let i=1;i<=64;i++){const next=sample(i/64).position;length+=next.distanceTo(last);last=next;}
  core=[{duration:Math.max(.7,length/.18),phase:'离面后沿接触面外侧换腕',sample}];
 }
 return[{duration:.2,phase:'各接触面同时法向卸力',sample:p=>blendFingerPose(from,a,smooth(p))},...core.map(s=>({...s,phase:'保持离面 · 指尖引导下一握姿'})),{duration:.2,phase:'沿接触面法向接稳',sample:p=>blendFingerPose(b,to,smooth(p))}];
}
