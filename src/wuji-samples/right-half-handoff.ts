import{Quaternion,Vector3}from'three';
import{blendFingerPose,clonePose,fingerLibrary,handPose,rotatedFingerPose,type PoseData}from'../scene/finger-data';
import{smooth,type HandPose,type Side}from'../scene/motion';
import{compactHandoff,type HandoffPart}from'./compact-handoff';
import raw from'../../art/wuji-teaching/compact-handoff-calibration.json';
const X=new Vector3(1,0,0),grip=handPose(fingerLibrary.hands.right.grip),record=raw.records.find(r=>r.id==='right-low')!,parked=handPose(record.parked as unknown as PoseData);
const pose=(angle:number,gap=0)=>{const p=rotatedFingerPose(grip,new Quaternion().setFromAxisAngle(X,angle));p.position.x+=gap;return p;};
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.angleTo(b.quaternion)<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
function release():HandoffPart[]{
 const held=pose(Math.PI/2),outside=pose(Math.PI/2,.03),neutral=pose(0,.03),loose={...clonePose(neutral),joints:{...parked.joints}};
 return[
  {duration:.38,phase:'左手接稳 · 半圈握指离面',sample:t=>blendFingerPose(held,outside,smooth(t))},
  {duration:1,phase:'方外复位半圈起腕',sample:t=>pose(Math.PI/2*(1-smooth(t)),.03)},
  {duration:.38,phase:'释放半圈握指',sample:t=>blendFingerPose(neutral,loose,smooth(t))},
  {duration:.4,phase:'接成侧拨预备',sample:t=>blendFingerPose(loose,parked,smooth(t))},
 ];
}
/** C8 handles 0/-90 degree grips. The new +90 degree endpoint releases
 * outward before rolling the free wrist, so its thumb cannot cut a cube corner. */
export function rightHalfHandoff(side:Side,from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3,preferred?:1|2):HandoffPart[]{
 if(side!=='right')return compactHandoff(side,from,to,padA,padB,normalA,normalB,preferred);
 const a=same(from,pose(Math.PI/2)),b=same(to,pose(Math.PI/2)),parts:HandoffPart[]=[];
 if(a){parts.push(...release());from=parked;padA=new Vector3().fromArray(record.thumbPad);normalA=new Vector3().fromArray(record.thumbNormal);preferred=1;}
 if(b){if(!same(from,parked))parts.push(...compactHandoff(side,from,parked,padA,new Vector3().fromArray(record.thumbPad),normalA,new Vector3().fromArray(record.thumbNormal),1));parts.push(...release().reverse().map(p=>({...p,phase:'准备定向半圈 · '+p.phase,sample:(t:number)=>p.sample(1-t)})));return parts;}
 if(!same(from,to))parts.push(...compactHandoff(side,from,to,padA,padB,normalA,normalB,preferred));return parts;
}
