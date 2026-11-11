import{Quaternion,Vector3}from'three';import{blendFingerPose,clonePose,fingerLibrary,handPose,rotatedFingerPose,type PoseData}from'../scene/finger-data';import{smooth,type HandPose}from'../scene/motion';import{compactHandoff,type HandoffPart}from'./compact-handoff';import data from'../../art/wuji-teaching/compact-handoff-calibration.json';
const axis=new Vector3(-1,0,0),grip=handPose(fingerLibrary.hands.left.grip),raw=data.records.find(r=>r.id==='left-low')!,parked=handPose(raw.parked as unknown as PoseData);
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-8);
const pose=(a:number,gap=0)=>{const p=rotatedFingerPose(grip,new Quaternion().setFromAxisAngle(axis,a));p.position.x-=gap;return p;};
function release(angle:number):HandoffPart[]{const held=pose(angle),out=pose(angle,.03),neutral=pose(0,.03),loose=clonePose(neutral);loose.joints={...parked.joints};return[
 {duration:.3,phase:'C113 · 右手接稳 · 左层握指沿法线离面',sample:p=>blendFingerPose(held,out,smooth(p))},
 ...(Math.abs(angle)>1e-9?[{duration:.8,phase:'C113 · 左腕在方外回到中立',sample:(p:number)=>pose(angle*(1-smooth(p)),.03)}]:[]),
 {duration:.38,phase:'C113 · 方外释放左握指',sample:p=>blendFingerPose(neutral,loose,smooth(p))},
 {duration:.4,phase:'C113 · 左手接成闲置指预备',sample:p=>blendFingerPose(loose,parked,smooth(p))}];}
/** Actual left geometry, proper rotation, unchanged finger limits. Every new
 * bridge is kept in C113's finite transition audit; no mirrored hand mesh. */
export function leftWristHandoff(from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3):HandoffPart[]{
 if(same(from,to))return[];const angles=[-Math.PI/2,0,Math.PI/2],a=angles.find(x=>same(from,pose(x))),b=angles.find(x=>same(to,pose(x))),parts:HandoffPart[]=[];
 if(a!==undefined){parts.push(...release(a));from=parked;padA=new Vector3().fromArray(raw.thumbPad);normalA=new Vector3().fromArray(raw.thumbNormal);}
 if(b!==undefined){parts.push(...compactHandoff('left',from,parked,padA,new Vector3().fromArray(raw.thumbPad),normalA,new Vector3().fromArray(raw.thumbNormal),1));parts.push(...release(b).reverse().map(s=>({...s,phase:'C113 · 准备左层握持 · '+s.phase,sample:(p:number)=>s.sample(1-p)})));return parts;}
 return[...parts,...compactHandoff('left',from,to,padA,padB,normalA,normalB,a!==undefined?1:undefined)];
}
