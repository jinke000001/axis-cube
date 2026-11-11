import{clonePose}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import{createWideBackProgram}from'./wide-back';
/** Only the idle left middle finger clears the approaching right thumb.
 * Original support pads, active finger, curve, meshes and limits are unchanged. */
export function createWideBackV2Program(prime=false):FingerProgram{const p=createWideBackProgram(prime),convert=<T extends{left:ReturnType<typeof clonePose>}>(f:T):T=>{const left=clonePose(f.left);left.joints!.left_finger3_joint1-=.02;return{...f,left};};return{...p,segments:p.segments.map(s=>({...s,sample:t=>convert(s.sample(t))})),sample:t=>convert(p.sample(t))};}
