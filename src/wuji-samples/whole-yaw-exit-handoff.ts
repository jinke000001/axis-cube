import{Quaternion,Vector3}from'three';import{blendFingerPose,clonePose,handPose,fingerLibrary,rotatedFingerPose}from'../scene/finger-data';import{smooth,type HandPose,type Side}from'../scene/motion';import{rightHalfHandoff}from'./right-half-handoff';import type{HandoffPart}from'./compact-handoff';
/** The frozen C10 whole-yaw receiving grip releases radially before the free
 * wrist returns. Layer orientation remains fixed throughout these parts. */
export function wholeYawExitHandoff(side:Side,from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,_normalA:Vector3,normalB:Vector3,preferred?:1|2):HandoffPart[]{
 const angle=side==='left'?0:Math.PI/2,normal=new Vector3(side==='left'?-1:1,0,0).applyAxisAngle(new Vector3(0,1,0),angle),released=clonePose(from);released.position.addScaledVector(normal,.03);const parts:HandoffPart[]=[{duration:.4,phase:'另一手接稳 · 侧握沿法向离面',sample:p=>blendFingerPose(from,released,smooth(p))}];let start=released;
 padA=new Vector3().fromArray(fingerLibrary.hands[side].gripContacts.find(c=>c.finger===1)!.padOffset);preferred=1;
 if(angle){const base=handPose(fingerLibrary.hands[side].grip),orbit=(a:number,gap:number)=>{const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),a),pose=rotatedFingerPose(base,q);pose.position.add(new Vector3(side==='left'?-gap:gap,0,0).applyQuaternion(q));return pose;};parts.push({duration:1.2,phase:'方外接回原侧握',sample:p=>orbit(angle*(1-smooth(p)),.03)},{duration:.35,phase:'原侧握接近',sample:p=>orbit(0,.03*(1-smooth(p)))});start=base;normal.set(side==='left'?-1:1,0,0);}
 parts.push(...rightHalfHandoff(side,start,to,padA,padB,normal,normalB,preferred));return parts;
}
