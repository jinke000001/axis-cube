import{Quaternion,Vector3}from'three';import{parseMove}from'../core/cube';import{rotatedFingerPose}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import{createWideFrontTipProgram}from'./wide-front-tip';
/** A proper plane placement of the independently fitted two-pad strokes.
 * Both real hands are transformed; cube geometry is invariant, arms still
 * require the original full world-space check. No mesh reflection. */
export function createWideUpperRightProgram(prime=false):FingerProgram{
 const source=createWideFrontTipProgram(prime),rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2),move=parseMove(prime?"u'":'u'),phase=(s:string)=>s.replaceAll('f','u').replaceAll('前侧两层','上中两层');
 const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>({...f,left:rotatedFingerPose(f.left,rotation),right:rotatedFingerPose(f.right,rotation),contacts:f.contacts.map(c=>({...c,point:c.point.clone().applyQuaternion(rotation),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()}))});
 return{...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:phase(s.phase),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:phase(f.phase)};}};
}
