import{Quaternion,Vector3}from'three';import{parseMove}from'../core/cube';import{clonePose,fingerContacts,fingerLibrary,handPose,rotatedFingerPose}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import{createUpperRingProgram}from'./upper-ring';
/** Properly place the real right ring U flexion on the middle slice. Rz+90
 * sends clockwise U to forward M; only the unloaded active hand shifts38mm
 * onto the middle slab. The original real left hand holds the outer L slab. */
export function createMiddleForwardProgram():FingerProgram{
 const source=createUpperRingProgram(),rotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2),shift=new Vector3(.038,0,0),move=parseMove('M'),left=handPose(fingerLibrary.hands.left.support),support=fingerContacts('left',fingerLibrary.hands.left.contacts,'support'),phase=(s:string)=>s.replaceAll('上层','中层').replaceAll('U','M').replaceAll('右侧','背侧');
 const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>{const right=rotatedFingerPose(f.right,rotation);right.position.add(shift);return{...f,left:clonePose(left),right,contacts:[...support,...f.contacts.filter(c=>c.role==='drive').map(c=>({...c,point:c.point.clone().applyQuaternion(rotation).add(shift),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()}))]};};
 return{...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:phase(s.phase),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:phase(f.phase)};}};
}
