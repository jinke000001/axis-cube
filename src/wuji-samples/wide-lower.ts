import{Quaternion,Vector3}from'three';import{parseMove}from'../core/cube';import{rotatedFingerPose}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import{createWideUpperLeftProgram}from'./wide-upper-left';
/** Unmarked d-prime uses the real left index. Proper Rx180 placement of
 * the two-pad upper-prime program; the right hand now holds the static U slab. */
export function createWideLowerProgram():FingerProgram{
 const source=createWideUpperLeftProgram(),rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI),move=parseMove("d'"),phase=(s:string)=>s.replaceAll('上中两层','下中两层').replaceAll('U′','d′');const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>({...f,left:rotatedFingerPose(f.left,rotation),right:rotatedFingerPose(f.right,rotation),contacts:f.contacts.map(c=>({...c,point:c.point.clone().applyQuaternion(rotation),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()}))});
 return{...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:phase(s.phase),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:phase(f.phase)};}};
}
