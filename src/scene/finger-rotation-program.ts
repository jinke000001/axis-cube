import { Quaternion, Vector3 } from "three";
import { moveAngle, type Move } from "../core/cube";
import { smooth, type MotionFrame, type Side } from "./motion";
import { blendFingerPose, handPose, type ContactData, type PoseData } from "./finger-data";
import type { FingerContact } from "./finger-contact";
import type { FingerProgram, FingerSegment } from "./finger-program";
import rotationData from "./finger-rotations.json";

interface Contact extends ContactData { side:Side; role:FingerContact['role']; }
interface Frame {left:PoseData;right:PoseData;contacts:Contact[];cubeAngle:number;turning:boolean;}
interface Segment { id:string;frames:Frame[]; }
const rotations=rotationData as unknown as {primitives:Record<string,Segment[]>};
const axis=new Vector3(1,0,0);

/** A whole turn is baked into the logical stickers only after both hands return. */
export function compileRotationProgram(move:Move,duration=5):FingerProgram {
  if(move.kind!=='rotation'||move.face!=='R'||move.turns===2)throw new Error("整体转体目前只接受已校准的x或x′。");
  const recorded=rotations.primitives[moveAngle(move)<0?'x':"x'"],segments:FingerSegment[]=[];
  let total=0;
  for(const record of recorded) {
    const turning=record.frames.some((f)=>f.turning),side:Side=record.id.startsWith('right')?'right':'left';
    const weight=turning?1.4:record.id.includes('low-to-full')?.23:record.id.includes('recover')?.42:.18;
    segments.push({index:0,start:total,duration:weight,stage:turning?'TURN':'PREPARE',
      phase:turning?'双手协同转体':`${side==='left'?'左':'右'}手${record.id.includes('low-to-full')?'接握准备转体':'回接承托'}`,
      active:side,sample:(p)=>{
        const q=smooth(p)*(record.frames.length-1),i=Math.floor(q),j=Math.min(record.frames.length-1,i+1),t=q-i,a=record.frames[i],b=record.frames[j];
        const angle=a.cubeAngle+(b.cubeAngle-a.cubeAngle)*t;
        const contacts=a.contacts.map((c):FingerContact=>{
          const point=new Vector3().fromArray(c.point),normal=new Vector3().fromArray(c.normal);
          // After the whole turn the cubical envelope is aligned again. Static
          // support checks use the current world-aligned material coordinates.
          if(!turning){point.applyAxisAngle(axis,angle);normal.applyAxisAngle(axis,angle);}
          return {...c,point,normal,padOffset:new Vector3().fromArray(c.padOffset)};
        });
        return {left:blendFingerPose(handPose(a.left),handPose(b.left),t),right:blendFingerPose(handPose(a.right),handPose(b.right),t),contacts,angle};
      }});
    total+=weight;
  }
  const cost=total,scale=duration/total;
  for(const segment of segments){segment.start*=scale;segment.duration*=scale;}
  const sample=(time:number):MotionFrame=>{
    const complete=time>=duration;
    let index=segments.length-1;
    if(!complete)index=Math.max(0,segments.findIndex((s)=>time<s.start+s.duration));
    const segment=segments[index],progress=complete?1:Math.max(0,Math.min(1,(time-segment.start)/segment.duration)),pose=segment.sample(progress);
    return {...pose,index:complete?1:0,angle:complete?0:pose.angle,orientation:new Quaternion(),phase:complete?'稳持完成':segment.phase,
      stage:complete?'HOLD':segment.stage,active:complete?null:segment.active,support:'left',progress,complete};
  };
  return {steps:[{move,start:0,duration,active:'left'}],segments,cost,duration,sample,
    statistics:{fingerTurns:0,wristTurns:0,retainedWrists:0,regrips:2,reorientations:1}};
}
