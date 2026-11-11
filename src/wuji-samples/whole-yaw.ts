import { Quaternion, Vector3 } from 'three';
import { parseMove, moveAngle } from '../core/cube';
import { clonePose, fingerContacts, fingerLibrary, handPose, rotatedFingerPose } from '../scene/finger-data';
import type { FingerProgram, FingerSegment } from '../scene/finger-program';
import { smooth, type MotionFrame, type HandPose } from '../scene/motion';

/** A single printed y' with a receiving regrip at 45°. The right hand keeps
 * measured material contact while the left hand receives the adjacent face.
 * No layer turn is inserted, and the original hand/arm geometry is unchanged. */
export function createWholeYawProgram(): FingerProgram {
  const move=parseMove("y'"),Y=new Vector3(0,1,0),half=Math.PI/4;
  const q=(angle:number)=>new Quaternion().setFromAxisAngle(Y,angle);
  const base={left:handPose(fingerLibrary.hands.left.grip),right:handPose(fingerLibrary.hands.right.grip)};
  const left=fingerContacts('left',fingerLibrary.hands.left.gripContacts,'drive');
  const right=fingerContacts('right',fingerLibrary.hands.right.gripContacts,'drive');
  const received=left.map(c=>({...c,point:c.point.clone().applyQuaternion(q(-2*half)),normal:c.normal.clone().applyQuaternion(q(-2*half))}));
  const pose=(side:'left'|'right',angle:number,gap=0):HandPose=>{
    const p=rotatedFingerPose(base[side],q(angle));
    p.position.add(new Vector3(side==='left'?-gap:gap,0,0).applyQuaternion(q(angle)));return p;
  };
  let duration=0;const segments:FingerSegment[]=[];
  const add=(seconds:number,stage:string,phase:string,sample:FingerSegment['sample'])=>{segments.push({index:0,start:duration,duration:seconds,stage,phase,active:'right',sample});duration+=seconds;};
  add(.3,'CONTACT','双手侧握整颗魔方',()=>({left:clonePose(base.left),right:clonePose(base.right),contacts:[...left,...right],angle:0}));
  add(.9,'TURN','双手整体换向 · 前半程',p=>{const a=half*smooth(p);return{left:pose('left',a),right:pose('right',a),contacts:[...left,...right],angle:a};});
  add(.35,'RELEASE','右手接稳整颗 · 左手沿法向离面',p=>({left:pose('left',half,.03*smooth(p)),right:pose('right',half),contacts:right,angle:half}));
  add(1.0,'TRANSFER','右手保持整颗方位 · 左手绕外侧接相邻面',p=>({left:pose('left',half-2*half*smooth(p),.03),right:pose('right',half),contacts:right,angle:half}));
  add(.35,'CONTACT','右手接稳 · 左手接住相邻面',p=>({left:pose('left',-half,.03*(1-smooth(p))),right:pose('right',half),contacts:right,angle:half}));
  add(.9,'TURN','双手整体换向 · 完成原表y′',p=>{const a=half+half*smooth(p);return{left:pose('left',a-2*half),right:pose('right',a),contacts:[...received,...right],angle:a};});
  const final={left:pose('left',0),right:pose('right',2*half),contacts:[...received,...right],angle:2*half};
  add(.2,'HOLD','整体换向完成 · 接稳',()=>({...final,left:clonePose(final.left),right:clonePose(final.right)}));
  return{duration,cost:duration,segments,steps:[{move,start:0,duration,active:'right'}],sample(t):MotionFrame{
    const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,p=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(p);
    return{...f,contacts:complete?f.contacts.map(c=>({...c,role:'support',point:c.point.clone().applyQuaternion(q(moveAngle(move))),normal:c.normal.clone().applyQuaternion(q(moveAngle(move)))})):f.contacts,angle:complete?0:f.angle,orientation:new Quaternion(),index:complete?1:0,complete,phase:s.phase,stage:s.stage,active:complete?null:'right',support:'left',progress:p};
  },statistics:{fingerTurns:0,wristTurns:0,retainedWrists:0,regrips:1,reorientations:1}};
}
