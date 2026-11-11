import{Quaternion,Vector3}from'three';import{blendFingerPose,fingerLibrary,handPose,rotatedFingerPose}from'../scene/finger-data';import{smooth,type HandPose}from'../scene/motion';import type{HandoffPart}from'./compact-handoff';
const base=handPose(fingerLibrary.hands.left.support),Y=new Vector3(0,1,0),X=new Vector3(-1,0,0),pose=(angle:number,gap=0)=>{const q=new Quaternion().setFromAxisAngle(Y,angle),p=rotatedFingerPose(base,q);p.position.addScaledVector(X.clone().applyQuaternion(q),gap);return p;};
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.angleTo(b.quaternion)<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
export function rearSupportHandoff(from:HandPose,to:HandPose):HandoffPart[]{
 if(same(from,to))return[];const enter=same(from,pose(0))&&same(to,pose(-Math.PI/2)),exit=same(from,pose(-Math.PI/2))&&same(to,pose(0));if(!enter&&!exit)throw new Error('后层支撑须经原左手稳持位');
 const parts:HandoffPart[]=[{duration:.4,phase:'右手接稳 · 左指沿侧面离开',sample:t=>blendFingerPose(pose(0),pose(0,.03),smooth(t))},{duration:1,phase:'左手在方外接向静止后层',sample:t=>pose(-Math.PI/2*smooth(t),.03)},{duration:.4,phase:'左手接稳静止后层',sample:t=>blendFingerPose(pose(-Math.PI/2,.03),pose(-Math.PI/2),smooth(t))}];
 return enter?parts:parts.reverse().map(p=>({...p,phase:'恢复左侧稳持 · '+p.phase,sample:t=>p.sample(1-t)}));
}
