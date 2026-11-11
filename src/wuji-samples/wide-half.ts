import {Quaternion,Vector3} from 'three';
import {parseMove,moveAngle} from '../core/cube';
import {clonePose,fingerContacts,fingerLibrary,handPose,rotatedFingerPose,type ContactData} from '../scene/finger-data';
import {smooth,type MotionFrame} from '../scene/motion';
import type {FingerProgram,FingerSegment} from '../scene/finger-program';
import raw from '../../art/wuji-teaching/wide-right-grip-calibration.json';

/** Direct two-layer r grip: distal pads drive both moving layer 0 and layer 1.
 * The stationary left layer remains held; this is not an R + slice substitution. */
export function createWideHalfProgram(prime=false):FingerProgram{
  if(!raw.contactFitPassed)throw new Error('宽层接触尚未校准');
  const move=parseMove(prime?"r2'":'r2'),axis=new Vector3(1,0,0),before=prime?-Math.PI/2:Math.PI/2,after=before+moveAngle(move),q=(a:number)=>new Quaternion().setFromAxisAngle(axis,a);
  const grip=handPose(raw.pose),left=handPose(fingerLibrary.hands.left.support),support=fingerContacts('left',fingerLibrary.hands.left.contacts),drive=fingerContacts('right',raw.contacts as ContactData[],'drive',q(before));
  let duration=0;const segments:FingerSegment[]=[];
  const add=(seconds:number,stage:string,phase:string,sample:FingerSegment['sample'])=>{segments.push({index:0,start:duration,duration:seconds,stage,phase,active:'right',sample});duration+=seconds;};
  add(.3,'CONTACT','拇指接中层 · 无名指小指接外层',()=>({left:clonePose(left),right:rotatedFingerPose(grip,q(before)),contacts:[...support,...drive],angle:0}));
  add(2.6,'TURN','右手直接转两层 · '+move.notation,p=>({left:clonePose(left),right:rotatedFingerPose(grip,q(before+(after-before)*smooth(p))),contacts:[...support,...drive],angle:moveAngle(move)*smooth(p)}));
  add(.4,'HOLD','两层停稳 · 左层保持',()=>({left:clonePose(left),right:rotatedFingerPose(grip,q(after)),contacts:[...support,...fingerContacts('right',raw.contacts as ContactData[],'support',q(after))],angle:moveAngle(move)}));
  return{duration,cost:duration,steps:[{move,start:0,duration,active:'right'}],segments,sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,p=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(p);return{...f,contacts:complete?[...support,...fingerContacts('right',raw.contacts as ContactData[],'support',q(after))]:f.contacts,orientation:new Quaternion(),index:complete?1:0,complete,angle:complete?0:f.angle,phase:s.phase,stage:s.stage,active:complete?null:'right',support:'left',progress:p};},statistics:{fingerTurns:0,wristTurns:1,retainedWrists:0,regrips:0,reorientations:0}};
}
