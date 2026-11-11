import{Quaternion,Vector3}from'three';import{parseMove}from'../core/cube';import{rotatedFingerPose}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import type{FingerContact}from'../scene/finger-contact';import{createThumbForwardV3Program}from'./thumb-forward-v3';
/** The same forward thumb flexion on the actual front-layer side. */
export function createThumbForwardFrontV3Program():FingerProgram{
 const source=createThumbForwardV3Program(),rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2),move=parseMove('F');
 const contact=(c:FingerContact):FingerContact=>({...c,point:c.point.clone().applyQuaternion(rotation),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()});
 const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>({...f,left:rotatedFingerPose(f.left,rotation),right:rotatedFingerPose(f.right,rotation),contacts:f.contacts.map(contact)});
 return{...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:s.phase.replaceAll('U','F'),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:f.phase.replaceAll('U','F')};}};
}
