import{Quaternion,Vector3}from'three';import{parseMove,moveAngle}from'../core/cube';
import{clonePose,fingerContacts,fingerLibrary,handPose,rotatedFingerPose,type ContactData}from'../scene/finger-data';import{smooth,type MotionFrame}from'../scene/motion';import type{FingerProgram,FingerSegment}from'../scene/finger-program';import raw from'../../art/wuji-teaching/wide-left-grip-calibration.json';
/** Direct l/l-prime with actual independently fitted left pads. Use the
 * high-to-low clockwise wrist range, keeping the free arm above its lower fold. */
export function createWideLeftProgram(prime=false):FingerProgram{
 if(!raw.contactFitPassed)throw new Error('左宽层接触未校准');
 const move=parseMove(prime?"l'":'l'),axis=new Vector3(-1,0,0),before=prime?0:Math.PI/2,after=before+moveAngle(move),q=(a:number)=>new Quaternion().setFromAxisAngle(axis,a),grip=handPose(raw.pose),right=handPose(fingerLibrary.hands.right.support),support=fingerContacts('right',fingerLibrary.hands.right.contacts),drive=fingerContacts('left',raw.contacts as ContactData[],'drive',q(before)),held=fingerContacts('left',raw.contacts as ContactData[],'support',q(after));
 let duration=0;const segments:FingerSegment[]=[];const add=(seconds:number,stage:string,phase:string,sample:FingerSegment['sample'])=>{segments.push({index:0,start:duration,duration:seconds,stage,phase,active:'left',sample});duration+=seconds;};
 add(.3,'CONTACT','左拇指接中层 · 环小指接左层',()=>({left:rotatedFingerPose(grip,q(before)),right:clonePose(right),contacts:[...support,...drive],angle:0}));
 add(1.65,'TURN','左手直接转两层 · '+move.notation,p=>({left:rotatedFingerPose(grip,q(before+(after-before)*smooth(p))),right:clonePose(right),contacts:[...support,...drive],angle:moveAngle(move)*smooth(p)}));
 add(.4,'HOLD','左两层停稳 · 右层保持',()=>({left:rotatedFingerPose(grip,q(after)),right:clonePose(right),contacts:[...support,...held],angle:moveAngle(move)}));
 return{duration,cost:duration,steps:[{move,start:0,duration,active:'left'}],segments,sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,contacts:complete?[...support,...held]:f.contacts,index:complete?1:0,complete,angle:complete?0:f.angle,orientation:new Quaternion(),stage:s.stage,phase:s.phase,active:complete?null:'left',support:'right',progress};},statistics:{fingerTurns:0,wristTurns:1,retainedWrists:0,regrips:0,reorientations:0}};
}
