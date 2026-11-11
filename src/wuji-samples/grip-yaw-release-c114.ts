import{Vector3}from'three';import{clonePose}from'../scene/finger-data';import type{FingerSegment}from'../scene/finger-program';import{smooth}from'../scene/motion';import{g1Pose}from'./grip-poses-c114';
/** G1's front thumb and left-side finger pads must both leave their faces.
 * The original side-only whole-yaw receive path can skim the front thumb.
 * Contact endpoints, the two45-degree drives and original timings stay fixed. */
export function yawReleaseC114(f:ReturnType<FingerSegment['sample']>,stage:string,p:number){
 if(Math.abs(f.angle-Math.PI/4)>1e-8||!['RELEASE','TRANSFER','CONTACT'].includes(stage))return f;
 const amount=.006*(stage==='RELEASE'?smooth(p):stage==='CONTACT'?1-smooth(p):1);if(!amount)return f;
 if(f.contacts.some(c=>c.side==='left'))throw Error('Yaw release variant needs an explicitly free receiving hand');
 const left=clonePose(f.left),q=left.quaternion.clone().multiply(g1Pose('left','grip').quaternion.invert()),normal=new Vector3(0,0,1).applyQuaternion(q);
 left.position.addScaledVector(normal,amount);return{...f,left};
}
