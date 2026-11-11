import{Vector3}from'three';import{blendFingerPose,clonePose}from'../scene/finger-data';import{fingerJoints,forwardFinger,type FingerIndex}from'../scene/finger-rig';import{smooth,type HandPose,type Side}from'../scene/motion';import type{HandoffPart}from'./compact-handoff';
/** Only an already-released same-digit/same-wrist flick can use this local
 * reset. The finger prepares after normal clearance, never through a face. */
export function localFlickHandoff(side:Side,from:HandPose,to:HandPose,digit:FingerIndex,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3):HandoffPart[]{
 const a=clonePose(from),b=clonePose(to);a.position.addScaledVector(normalA,.025);b.position.addScaledVector(normalB,.025);
 const fk=(pose:HandPose,pad:Vector3)=>forwardFinger(side,digit,fingerJoints(side,digit).map(j=>pose.joints![j.name]),pose,pad).position,start=fk(a,padA),end=fk(b,padB),ca=start.clone().addScaledVector(normalA,.06),cb=end.clone().addScaledVector(normalB,.06);
 return[{duration:.2,phase:'指尖已释放 · 沿法线明确离面',sample:p=>blendFingerPose(from,a,smooth(p))},{duration:.65,phase:'掌腕留近 · 离面后预备下一拨',sample:p=>{const t=smooth(p),u=1-t,pose=blendFingerPose(a,b,t),target=start.clone().multiplyScalar(u*u*u).addScaledVector(ca,3*u*u*t).addScaledVector(cb,3*u*t*t).addScaledVector(end,t*t*t);pose.position.add(target.sub(fk(pose,padA.clone().lerp(padB,t))));return pose;}},{duration:.25,phase:'末节预备完成 · 重新接近侧面',sample:p=>blendFingerPose(b,to,smooth(p))}];
}
