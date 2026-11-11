import{Quaternion,Vector3}from'three';import{blendFingerPose,fingerLibrary,handPose,rotatedFingerPose}from'../scene/finger-data';import{smooth,type HandPose,type Side}from'../scene/motion';import type{HandoffPart}from'./compact-handoff';
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
export function upperSupportRotation(side:Side){return new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),side==='left'?-Math.PI/2:Math.PI/2));}
/** An unloaded support hand first clears the original side, then goes around
 * the rear corner to the stationary bottom slab. The other hand must hold. */
export function upperSupportHandoff(side:Side,from:HandPose,to:HandPose):HandoffPart[]{
 if(same(from,to))return[];const base=handPose(fingerLibrary.hands[side].support),end=rotatedFingerPose(base,upperSupportRotation(side)),enter=same(from,base)&&same(to,end),exit=same(from,end)&&same(to,base);if(!enter&&!exit)throw new Error('上宽层支撑须经已知原握姿');
 const normal=new Vector3(side==='left'?-1:1,0,0),rear=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),side==='left'?-Math.PI/2:Math.PI/2),qEnd=upperSupportRotation(side),pose=(q:Quaternion,gap=.03)=>{const p=rotatedFingerPose(base,q);p.position.addScaledVector(normal.clone().applyQuaternion(q),gap);return p;},identity=new Quaternion();
 const parts:HandoffPart[]=[{duration:.4,phase:'另一手接稳 · 支撑手沿侧面离开',sample:t=>blendFingerPose(base,pose(identity),smooth(t))},{duration:1,phase:'方外绕到后侧',sample:t=>pose(identity.clone().slerp(rear,smooth(t)))},{duration:1,phase:'方外转向静止底层',sample:t=>pose(rear.clone().slerp(qEnd,smooth(t)))},{duration:.4,phase:'支撑手接稳静止底层',sample:t=>blendFingerPose(pose(qEnd),end,smooth(t))}];
 return enter?parts:parts.reverse().map(p=>({...p,phase:'恢复原稳持 · '+p.phase,sample:t=>p.sample(1-t)}));
}
