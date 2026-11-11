import{Quaternion,Vector3}from'three';import{blendFingerPose,clonePose,fingerLibrary,handPose,rotatedFingerPose,type PoseData}from'../scene/finger-data';import{smooth,type HandPose,type Side}from'../scene/motion';import{compactHandoff,type HandoffPart}from'./compact-handoff';
import rightWide from'../../art/wuji-teaching/wide-right-grip-calibration.json';import leftWide from'../../art/wuji-teaching/wide-left-grip-calibration.json';import records from'../../art/wuji-teaching/compact-handoff-calibration.json';
const X=new Vector3(1,0,0),same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.angleTo(b.quaternion)<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
/** Both genuine wide grips clear the middle pad beyond the side face before
 * a free wrist reset. No layer motion is hidden in the handoff. */
export function extendedWideHandoff(side:Side,from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3,preferred?:1|2,targetDigit:1|2=2):HandoffPart[]{
 const raw=side==='right'?rightWide:leftWide,grip=handPose(raw.pose),record=records.records.find(r=>r.id===side+'-low')!,parked=handPose(record.parked as unknown as PoseData),sign=side==='right'?1:-1;
 const pose=(angle:number,gap=0)=>{const p=rotatedFingerPose(grip,new Quaternion().setFromAxisAngle(X,angle));p.position.x+=sign*gap;return p;};
 const identify=(p:HandPose)=>(side==='right'?[0,-Math.PI/2,Math.PI/2]:[0,-Math.PI/2]).find(a=>same(p,pose(a)));
 const release=(angle:number):HandoffPart[]=>{
  const held=pose(angle),outside=pose(angle,.05),neutral=pose(0,.05),loose={...clonePose(neutral),joints:{...parked.joints}},parts:HandoffPart[]=[{duration:.4,phase:'另一手接稳 · 双层指垫离面',sample:t=>blendFingerPose(held,outside,smooth(t))}];
  if(Math.abs(angle)>1e-8)parts.push({duration:1,phase:'方外复位双层腕姿',sample:t=>pose(angle*(1-smooth(t)),.05)});
  parts.push({duration:.4,phase:'方外释放宽层握指',sample:t=>blendFingerPose(neutral,loose,smooth(t))},{duration:.4,phase:'接成已校准侧拨预备',sample:t=>blendFingerPose(loose,parked,smooth(t))});return parts;
 };
 const a=identify(from),b=identify(to),parts:HandoffPart[]=[];
 if(a!==undefined){parts.push(...release(a));from=parked;}
 if(b!==undefined){if(!same(from,parked))parts.push(...compactHandoff(side,from,parked,padA,new Vector3().fromArray(record.thumbPad),normalA,new Vector3().fromArray(record.thumbNormal),1));parts.push(...release(b).reverse().map(p=>({...p,phase:'准备双层 · '+p.phase,sample:(t:number)=>p.sample(1-t)})));return parts;}
 if(a!==undefined){const known=[handPose(fingerLibrary.hands[side].support),...[0,-Math.PI/2].map(a=>rotatedFingerPose(handPose(fingerLibrary.hands[side].grip),new Quaternion().setFromAxisAngle(X,a)))].some(p=>same(to,p));preferred=known?1:targetDigit;padA=new Vector3().fromArray(preferred===1?record.thumbPad:fingerLibrary.hands[side].gripContacts.find(c=>c.finger===2)!.padOffset);normalA=preferred===1?new Vector3().fromArray(record.thumbNormal):new Vector3(sign,0,0);}
 if(!same(from,to))parts.push(...compactHandoff(side,from,to,padA,padB,normalA,normalB,preferred));return parts;
}
