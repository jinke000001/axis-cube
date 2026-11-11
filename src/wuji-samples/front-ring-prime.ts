import{Quaternion,Vector3}from'three';import{parseMove}from'../core/cube';import{rotatedFingerPose,fingerLibrary,handPose,fingerContacts}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import{createUpperRingProgram}from'./upper-ring';
/** Real right ring flexion properly placed on front F-prime. The measured
 * left grip rotates onto stationary rear/middle slabs; only the active ring
 * shifts76mm from the rear-slab plane onto the original front-slab plane. */
export function createFrontRingPrimeProgram():FingerProgram{
 const source=createUpperRingProgram(),rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2),shift=new Vector3(0,0,.076),move=parseMove("F'"),leftRotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2),left=rotatedFingerPose(handPose(fingerLibrary.hands.left.support),leftRotation),support=fingerContacts('left',fingerLibrary.hands.left.contacts,'support',leftRotation),phase=(s:string)=>s.replaceAll('上层','前层').replaceAll('U','F′').replaceAll('右侧','下侧');
 const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>{const right=rotatedFingerPose(f.right,rotation);right.position.add(shift);return{...f,left,right,angle:-f.angle,contacts:[...support,...f.contacts.filter(c=>c.role==='drive').map(c=>({...c,point:c.point.clone().applyQuaternion(rotation).add(c.role==='drive'?shift:new Vector3()),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()}))]};};
 return{...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:phase(s.phase),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:phase(f.phase)};}};
}
