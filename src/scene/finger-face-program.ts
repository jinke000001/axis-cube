import { Quaternion, Vector3 } from "three";
import { FACE_NAMES, moveAngle, type Move } from "../core/cube";
import { smooth, type MotionFrame, type Side } from "./motion";
import type { FingerContact } from "./finger-contact";
import { blendFingerPose, clonePose, handPose, oppositeHand, rotatedFingerPose, type ContactData, type PoseData } from "./finger-data";
import type { FingerProgram, FingerSegment } from "./finger-program";
import type { PlaybackStep } from "./playback";
import libraryData from "./finger-faces.json";

interface FullContact extends ContactData { side: Side; role: FingerContact["role"]; }
interface RecordedFrame { left: PoseData; right: PoseData; contacts: FullContact[]; }
interface FacePrimitive {
  active: Side; normal: number[]; angle: number; entry: string;
  initial: Record<Side,PoseData>; contacts: FullContact[]; regrip: RecordedFrame[];
}
interface FaceLibrary { primitives: Record<string,FacePrimitive>; entries:Record<string,{frames:RecordedFrame[];order:Side[]}>; }
const library=libraryData as unknown as FaceLibrary;
export const facePrimitiveKey=(move:Move)=>move.face+(moveAngle(move)>0?"'":"");
const contacts=(values:readonly FullContact[]):FingerContact[]=>values.map((c)=>({side:c.side,finger:c.finger,role:c.role,
  point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)}));
function recorded(frames:readonly RecordedFrame[],progress:number) {
  const p=Math.max(0,Math.min(1,progress))*(frames.length-1),a=Math.floor(p),b=Math.min(frames.length-1,a+1),t=p-a;
  return {left:blendFingerPose(handPose(frames[a].left),handPose(frames[b].left),t),right:blendFingerPose(handPose(frames[a].right),handPose(frames[b].right),t),contacts:contacts(frames[a].contacts),angle:0};
}

/** Fixed cube frame, with measured single-hand entry/return and wrist regrips. */
export function compileFaceProgram(moves:readonly Move[],duration=5):FingerProgram {
  if(!moves.length||moves.some((move)=>!['F','D','B'].includes(move.face)||move.kind))throw new Error("面访问片段只接受F/D/B外层动作。");
  const segments:FingerSegment[]=[],steps:PlaybackStep[]=[];
  const statistics={fingerTurns:0,wristTurns:0,retainedWrists:0,regrips:0,reorientations:0};
  let total=0,index=0,angle=0,currentEntry:string|undefined;
  function add(stage:string,phase:string,weight:number,active:Side|null,sample:FingerSegment['sample']) {
    segments.push({index,start:total,duration:weight,stage,phase,active,sample});total+=weight;
  }
  function route(id:string,reverse=false) {
    const entry=library.entries[id],held=angle;
    // Split at the contact handoff so the outgoing and receiving hands each
    // have an explicit zero-velocity endpoint and an unambiguous support set.
    const half=entry.frames.length/2;
    const groups=[entry.frames.slice(0,half),entry.frames.slice(half)];
    const order=reverse?[1,0]:[0,1];
    for(const part of order) {
      const frames=groups[part],active=entry.order[part];
      add("PREPARE",`${active==='left'?'左':'右'}手${reverse?'回接':'换握到位'}`,1.15,active,(p)=>({...recorded(frames,reverse?1-smooth(p):smooth(p)),angle:held}));
    }
    statistics.regrips+=2;
  }
  for(index=0;index<moves.length;index++) {
    angle=0;const move=moves[index],start=total,primitive=library.primitives[facePrimitiveKey(move)];
    if(currentEntry!==primitive.entry) {
      if(currentEntry)route(currentEntry,true);
      route(primitive.entry);currentEntry=primitive.entry;
    }
    const normal=new Vector3().fromArray(primitive.normal);
    for(let part=0;part<(move.turns===2?2:1);part++) {
      const offset=angle,active=primitive.active,support=oppositeHand(active),base=handPose(primitive.initial[active]),fixed=handPose(primitive.initial[support]);
      const contact=contacts(primitive.contacts).map((c)=>c.role==='drive'?{...c,point:c.point.clone().applyAxisAngle(normal,-offset),normal:c.normal.clone().applyAxisAngle(normal,-offset)}:c);
      add("TURN",`${active==='left'?'左':'右'}腕转${FACE_NAMES[move.face]}`,1.1, (active), (p)=>{
        const turn=primitive.angle*smooth(p),q=new Quaternion().setFromAxisAngle(normal,turn);
        const driven=rotatedFingerPose(base,q),held=clonePose(fixed);
        return {left:active==='left'?driven:held,right:active==='right'?driven:held,contacts:contact,angle:offset+turn};
      });
      angle+=primitive.angle;statistics.wristTurns++;
      const held=angle;
      add("PREPARE",`${active==='left'?'左':'右'}腕顺势回接`,.55,active,(p)=>({...recorded(primitive.regrip,smooth(p)),angle:held}));
      statistics.regrips++;
    }
    steps.push({move,start,duration:total-start,active:primitive.active});
  }
  index=moves.length-1;route(currentEntry!,true);
  steps.at(-1)!.duration=total-steps.at(-1)!.start;
  const last=segments.at(-1)!.sample(1),scale=duration/total;
  for(const s of segments){s.start*=scale;s.duration*=scale;}
  for(const s of steps){s.start*=scale;s.duration*=scale;}
  const sample=(time:number):MotionFrame=>{
    let lo=0,hi=segments.length-1;
    while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(segments[mid].start<=time)lo=mid;else hi=mid-1;}
    const segment=segments[lo],complete=time>=duration,p=Math.max(0,Math.min(1,(time-segment.start)/segment.duration)),value=complete?last:segment.sample(p);
    return {...value,index:complete?moves.length:segment.index,angle:complete?0:value.angle,orientation:new Quaternion(),phase:complete?'稳持完成':segment.phase,stage:complete?'HOLD':segment.stage,
      active:complete?null:segment.active,support:segment.active?oppositeHand(segment.active):'left',progress:p,complete};
  };
  return {steps,segments,duration,cost:total,sample,statistics};
}
