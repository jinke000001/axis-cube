import{Quaternion,Vector3}from'three';import{NORMALS,parseMove,moveAngle}from'../core/cube';import{clonePose,fingerContacts,fingerLibrary,handPose,rotatedFingerPose}from'../scene/finger-data';import{smooth,type MotionFrame}from'../scene/motion';import type{FingerProgram,FingerSegment}from'../scene/finger-program';
/** Calibration only: both unchanged original support grips carry the one
 * rigid cube. A quarter-aligned initial grip never inserts a cube turn. */
export function createWholeAxisProgram(notation:string,before=0):FingerProgram{
 const move=parseMove(notation);if(move.kind!=='rotation')throw new Error('必须是原表整体换向');
 const axis=new Vector3(...NORMALS[move.face]),q=(a:number)=>new Quaternion().setFromAxisAngle(axis,a),base={left:handPose(fingerLibrary.hands.left.support),right:handPose(fingerLibrary.hands.right.support)},after=before+moveAngle(move),drive=[...fingerContacts('left',fingerLibrary.hands.left.contacts,'drive',q(before)),...fingerContacts('right',fingerLibrary.hands.right.contacts,'drive',q(before))],held=[...fingerContacts('left',fingerLibrary.hands.left.contacts,'support',q(after)),...fingerContacts('right',fingerLibrary.hands.right.contacts,'support',q(after))];
 const poses=(angle:number)=>({left:rotatedFingerPose(base.left,q(angle)),right:rotatedFingerPose(base.right,q(angle))});
 let duration=0;const segments:FingerSegment[]=[];const add=(seconds:number,stage:string,phase:string,sample:FingerSegment['sample'])=>{segments.push({index:0,start:duration,duration:seconds,stage,phase,active:'right',sample});duration+=seconds;};
 add(.3,'CONTACT','双手接稳整颗魔方',()=>({...poses(before),contacts:drive,angle:0}));
 add(2,'TURN','双手按原表整体换向 · '+notation,p=>({...poses(before+moveAngle(move)*smooth(p)),contacts:drive,angle:moveAngle(move)*smooth(p)}));
 add(.4,'HOLD','整体方位停稳 · 双手承托',()=>({...poses(after),contacts:held,angle:moveAngle(move)}));
 return{duration,cost:duration,steps:[{move,start:0,duration,active:'right'}],segments,sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,left:clonePose(f.left),right:clonePose(f.right),angle:complete?0:f.angle,index:complete?1:0,complete,orientation:new Quaternion(),stage:s.stage,phase:s.phase,active:complete?null:'right',support:'left',progress};},statistics:{fingerTurns:0,wristTurns:0,retainedWrists:0,regrips:0,reorientations:1}};
}
