import { Quaternion, Vector3 } from "three";
import { NORMALS, moveAngle, parseMove } from "../core/cube";
import { smooth, type HandPose, type MotionFrame, type Side } from "./motion";
import type { PlaybackProgram } from "./playback";
import type { FingerContact } from "./finger-contact";
import type { FingerIndex } from "./finger-rig";

interface RecordedPose {
  position: number[];
  quaternion: number[];
  joints: Record<string,number>;
}
interface RecordedContact {
  side: Side;
  finger: FingerIndex;
  padOffset: number[];
  cubeLocalPoint: number[];
  normal: number[];
}
export interface CalibratedStroke {
  turn: string;
  supports: RecordedContact[];
  frames: {
    progress: number;
    angle: number;
    left: RecordedPose;
    right: RecordedPose;
    active: RecordedContact;
  }[];
}

function blendPose(a: RecordedPose, b: RecordedPose, t: number): HandPose {
  return {
    position:new Vector3().fromArray(a.position).lerp(new Vector3().fromArray(b.position),t),
    quaternion:new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion),t),
    closed:1,
    joints:Object.fromEntries(Object.entries(a.joints).map(([name,value])=>[name,value+(b.joints[name]-value)*t])),
  };
}
function contact(data: RecordedContact, role: FingerContact["role"]): FingerContact {
  return {side:data.side,finger:data.finger,role,
    point:new Vector3().fromArray(data.cubeLocalPoint),
    normal:new Vector3().fromArray(data.normal),
    padOffset:new Vector3().fromArray(data.padOffset)};
}

/**
 * A measured turn segment, sampled without history-dependent IK.
 * This primitive does not invent entry, exit or regrip motions: the complete
 * finger program must explicitly provide and validate those transitions.
 */
export function strokePlayback(data: CalibratedStroke, duration=4): PlaybackProgram {
  const move=parseMove(data.turn), frames=data.frames;
  if (frames.length < 2 || frames[0].progress !== 0 || frames.at(-1)!.progress !== 1 ||
    !Number.isFinite(duration) || duration<=0) throw new Error("指法轨迹缺少完整时间范围。");
  if (Math.abs(frames[0].angle)>1e-8 || Math.abs(frames.at(-1)!.angle-moveAngle(move))>1e-7)
    throw new Error("指法实际转角与公式不一致。");
  for (let i=0;i<frames.length;i++) {
    const frame=frames[i];
    if (!Number.isFinite(frame.progress) || !Number.isFinite(frame.angle) ||
      (i && frame.progress<=frames[i-1].progress)) throw new Error("指法轨迹时间不连续。");
    for (const side of ["left","right"] as const) {
      const pose=frame[side];
      if (pose.position.length!==3 || pose.quaternion.length!==4 ||
        [...pose.position,...pose.quaternion,...Object.values(pose.joints)].some((n)=>!Number.isFinite(n)) ||
        Array.from({length:20},(_,j)=>`${side}_finger${Math.floor(j/4)+1}_joint${j%4+1}`).some((name)=>!(name in pose.joints)))
        throw new Error("指法轨迹包含不完整的关节或腕姿态。");
    }
  }
  const active=frames[0].active.side;
  const steps=[{move,start:0,duration,active}];
  const sample=(time:number):MotionFrame=>{
    const p=smooth(Math.max(0,Math.min(1,time/duration)));
    let lo=0,hi=frames.length-1;
    while(lo+1<hi) {const mid=(lo+hi)>>1;if(frames[mid].progress<=p)lo=mid;else hi=mid;}
    const a=frames[lo],b=frames[hi],t=(p-a.progress)/(b.progress-a.progress);
    const angle=a.angle+(b.angle-a.angle)*t;
    const driven=contact(a.active,"drive");
    driven.padOffset.lerp(new Vector3().fromArray(b.active.padOffset),t);
    const contacts=data.supports.map((s)=>contact(s,"support"));
    const complete=time>=duration;
    if(complete) {
      const q=new Quaternion().setFromAxisAngle(new Vector3(...NORMALS[move.face]),angle);
      driven.point.applyQuaternion(q);driven.normal.applyQuaternion(q);driven.role="support";
    }
    contacts.push(driven);
    return {index:complete?1:0,phase:complete?"拨层完成":`${active==="left"?"左":"右"}${["拇指","食指","中指","无名指","小指"][a.active.finger-1]}拨层`,stage:complete?"HOLD":"TURN",
      angle:complete?0:angle,orientation:new Quaternion(),
      left:blendPose(a.left,b.left,t),right:blendPose(a.right,b.right,t),
      support:active==="left"?"right":"left",progress:p,active:complete?null:active,
      activeFinger:a.active.finger,complete,contacts};
  };
  return {steps,duration,sample};
}
