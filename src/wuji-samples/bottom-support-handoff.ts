import{Vector3}from'three';import{blendFingerPose,clonePose,fingerLibrary,handPose}from'../scene/finger-data';import{smooth,type HandPose}from'../scene/motion';import type{HandoffPart}from'./compact-handoff';
const low=handPose(fingerLibrary.hands.right.support),raised=clonePose(low);raised.position.y+=.038;
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.angleTo(b.quaternion)<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
/** Free right support clears the face before changing its row. */
export function bottomSupportHandoff(from:HandPose,to:HandPose):HandoffPart[]{
 if(same(from,to))return[];const up=same(from,low)&&same(to,raised),down=same(from,raised)&&same(to,low);if(!up&&!down)throw new Error('底层支撑必须从已知原握姿交接');
 const a=clonePose(low),b=clonePose(raised);a.position.add(new Vector3(.03,0,0));b.position.add(new Vector3(.03,0,0));
 const parts=[{duration:.4,phase:'另一手接稳 · 右手离开侧面',sample:(p:number)=>blendFingerPose(low,a,smooth(p))},{duration:.5,phase:'方外上移一行 · 接稳静止上中层',sample:(p:number)=>blendFingerPose(a,b,smooth(p))},{duration:.4,phase:'右手重新接稳',sample:(p:number)=>blendFingerPose(b,raised,smooth(p))}];
 return up?parts:parts.reverse().map(part=>({...part,phase:'恢复原支撑 · '+part.phase,sample:(p:number)=>part.sample(1-p)}));
}
