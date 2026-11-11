import {Quaternion,Vector3} from 'three';
import {parseMove,moveAngle} from '../core/cube';
import {blendFingerPose,clonePose,handPose,type PoseData} from '../scene/finger-data';
import {contactTarget,type FingerContact} from '../scene/finger-contact';
import {fingerJoints,forwardFinger} from '../scene/finger-rig';
import type {FingerProgram,FingerSegment} from '../scene/finger-program';
import {smooth,type MotionFrame} from '../scene/motion';
import raw from '../../art/wuji-teaching/side-flick-calibration.json';

export const TIP_FLICK_METADATA={
 id:'f2l40-source-1-side-flick',sourceAlgorithm:'F2L 40',sourceStepIndex:1,finger:2,
 method:'右食指末节侧垫沿上层后侧拨动，屈指转层，原Wuji关节；准备与释放只动食指。',
 contactRegion:'上层后侧，距顶面7mm、外角17mm；接触保持在独立末节指垫',
 jointOverrides:{},...raw.summary,status:'局部指尖推拨样片；软件采样验收，动作效果由用户确认',
} as const;
interface ContactData{side:'left'|'right';finger:1|2|3|4|5;role:'support'|'drive';point:number[];normal:number[];padOffset:number[];}
interface FrameData{progress:number;angle:number;left:PoseData;right:PoseData;active:ContactData;}
const frames=raw.frames as unknown as FrameData[],move=parseMove('U'),supportData=raw.supports as ContactData[];
const makeContact=(c:ContactData):FingerContact=>({...c,point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)});
function at(progress:number){const cursor=Math.max(0,Math.min(1,progress))*(frames.length-1),lo=Math.floor(cursor),hi=Math.min(frames.length-1,lo+1),p=cursor-lo,a=frames[lo],b=frames[hi];
 const right=blendFingerPose(handPose(a.right),handPose(b.right),p),left=handPose(a.left),angle=moveAngle(move)*progress,drive=makeContact(a.active);drive.padOffset.lerp(new Vector3().fromArray(b.active.padOffset),p);
 // Rigid-link FK preserves exact material contact between authored keys; this
 // corrects submillimetre chord interpolation only and does not solve IK live.
 const angles=fingerJoints('right',2).map(j=>right.joints![j.name]),actual=forwardFinger('right',2,angles,right,drive.padOffset).position;
 right.position.add(contactTarget(drive,move,angle).point.sub(actual));
 return{left,right,angle,drive};}
export function createTipFlickProgram(duration=4.5):FingerProgram{
 if(!Number.isFinite(duration)||duration<=0)throw new Error('指尖样片时长必须为正数。');
 const start=at(0),end=at(1),before=handPose(raw.before),after=handPose(raw.after),support=supportData.map(makeContact),segments:FingerSegment[]=[];
 function add(from:number,length:number,stage:string,phase:string,sample:FingerSegment['sample']){segments.push({index:0,start:from*duration,duration:length*duration,stage,phase,active:'right',finger:2,sample});}
 add(0,.2,'PREPARE','食指指尖从侧边靠近',p=>({left:clonePose(start.left),right:blendFingerPose(before,start.right,smooth(p)),angle:0,contacts:support}));
 add(.2,.1,'CONTACT','指尖侧垫接触上层后侧',()=>({left:clonePose(start.left),right:clonePose(start.right),angle:0,contacts:[...support,start.drive]}));
 add(.3,.24,'TURN','食指沿侧边拨动 · U',p=>{const frame=at(smooth(p));return{left:frame.left,right:frame.right,angle:frame.angle,contacts:[...support,frame.drive]};});
 add(.54,.24,'RELEASE','指尖松开并离开魔方',p=>({left:clonePose(end.left),right:blendFingerPose(end.right,after,smooth(p)),angle:end.angle,contacts:support}));
 add(.78,.22,'HOLD','单拨完成',()=>({left:clonePose(end.left),right:clonePose(after),angle:end.angle,contacts:support}));
 const sample=(time:number):MotionFrame=>{const complete=time>=duration,segment=segments.find(s=>time<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(time-segment.start)/segment.duration)),state=segment.sample(progress);return{...state,index:complete?1:0,angle:complete?0:state.angle,phase:complete?'单拨完成':segment.phase,stage:complete?'HOLD':segment.stage,orientation:new Quaternion(),active:complete?null:'right',support:'left',activeFinger:2,progress,complete};};
 return{duration,cost:duration,segments,steps:[{move,start:0,duration,active:'right'}],sample,statistics:{fingerTurns:1,wristTurns:0,retainedWrists:0,regrips:0,reorientations:0}};
}
