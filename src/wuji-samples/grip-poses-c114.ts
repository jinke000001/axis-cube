import{Vector3}from'three';
import{fingerLibrary,handPose,clonePose,type PoseData,type ContactData}from'../scene/finger-data';
import{CENTER,type HandPose,type Side}from'../scene/motion';
import type{FingerContact}from'../scene/finger-contact';
import poses from'../../art/wuji-teaching/grip-c114-r1/poses.json';
import idle from'../../art/wuji-teaching/grip-c114-r1/idle.json';
export type GripRole='support'|'grip';
export const C114_GRIP_VERSION='c114-r1-g1';
type Entry={pose:PoseData;contacts:ContactData[]};
const entries=poses.hands as unknown as Record<Side,Record<GripRole,Entry>>;
export const g1Pose=(side:Side,role:GripRole)=>handPose(entries[side][role].pose);
export function g1Contacts(side:Side,role:GripRole):FingerContact[]{return entries[side][role].contacts.map(c=>({...c,side,role:'support',point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)}));}
export function canonicalRole(side:Side,p:HandPose):GripRole|undefined{return(['support','grip']as const).find(r=>Object.entries(fingerLibrary.hands[side][r].joints).every(([k,v])=>Math.abs(v-p.joints![k])<1e-6));}
/** Transport the private G1 shape by the original rigid hand transform.
 * This preserves the corresponding old thumb terminal world transform; it is
 * not a claim that palm/wrist or thumb proximal joints remain unchanged. */
export function transportGrip(side:Side,p:HandPose,role=canonicalRole(side,p)){
 if(!role)throw Error('C114 support/grip class needs explicit calibration: '+side);
 const old=handPose(fingerLibrary.hands[side][role]),q=p.quaternion.clone().multiply(old.quaternion.clone().invert()),transform=(v:Vector3)=>v.sub(old.position).applyQuaternion(q).add(p.position),out=g1Pose(side,role);
 out.position.copy(transform(out.position));out.quaternion.premultiply(q);
 const cs=g1Contacts(side,role).map(c=>({...c,point:transform(c.point.clone().add(CENTER)).sub(CENTER),normal:c.normal.clone().applyQuaternion(q)}));
 return{pose:out,contacts:cs,role};
}
/** Preserve functional prepared/folded fingers in double strokes. Only the
 * explicitly supplied free digits get the versioned C5 idle shape. */
export function idlePose(side:Side,p:HandPose,digits:readonly(2|3|4|5)[]){const out=clonePose(p);for(const digit of digits){const a=digit===2?[.2,0,.3,.3]:idle[side][String(digit)as'3'|'4'|'5'];a.forEach((v,i)=>out.joints![`${side}_finger${digit}_joint${i+1}`]=v);}return out;}
