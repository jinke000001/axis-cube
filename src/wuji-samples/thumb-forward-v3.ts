import {Quaternion,Vector3} from 'three';
import {moveAngle,parseMove} from '../core/cube';
import {blendFingerPose,clonePose,handPose,type PoseData} from '../scene/finger-data';
import {contactTarget,type FingerContact} from '../scene/finger-contact';
import {fingerJoints,forwardFinger} from '../scene/finger-rig';
import type {FingerProgram,FingerSegment} from '../scene/finger-program';
import {smooth,type MotionFrame} from '../scene/motion';
import raw from '../../art/wuji-teaching/thumb-forward-calibration.json';
import idle from '../../art/wuji-teaching/thumb-forward-v3-idle.json';
const withIdle=(p:ReturnType<typeof handPose>):ReturnType<typeof handPose>=>({...p,joints:{...p.joints,...idle.joints}});

export const THUMB_FORWARD_V3_METADATA={id:'c63-red-right-thumb-U',sourceAlgorithm:'OLL31',sourceStepIndex:2,
 hand:'right',finger:1,originalInstruction:'原表红字：右拇指正向U，不能用U′或食指代替。',
 contactRegion:'上层后侧，距顶面7mm、外角17mm，真实拇指末节侧垫。',jointOverrides:{},...raw.summary,
 status:'原右拇指侧拨候选；整式连接和实际慢放另行验收。'}as const;
interface ContactData{side:'left'|'right';finger:1|2|3|4|5;role:'support'|'drive';point:number[];normal:number[];padOffset:number[];}
interface FrameData{progress:number;angle:number;left:PoseData;right:PoseData;active:ContactData;}
const frames=raw.frames as unknown as FrameData[],move=parseMove("U");
const contact=(c:ContactData):FingerContact=>({...c,point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)});
function at(progress:number){
 const cursor=Math.max(0,Math.min(1,progress))*(frames.length-1),lo=Math.floor(cursor),hi=Math.min(frames.length-1,lo+1),a=frames[lo],b=frames[hi],p=cursor-lo;
 const right=withIdle(blendFingerPose(handPose(a.right),handPose(b.right),p)),left=handPose(a.left),angle=moveAngle(move)*progress,drive=contact(a.active);drive.padOffset.lerp(new Vector3().fromArray(b.active.padOffset),p);
 const actual=forwardFinger('right',1,fingerJoints('right',1).map(j=>right.joints![j.name]),right,drive.padOffset).position;
 right.position.add(contactTarget(drive,move,angle).point.sub(actual));
 return{left,right,angle,drive};
}
export function createThumbForwardV3Program(duration=4.5):FingerProgram{
 if(!Number.isFinite(duration)||duration<=0)throw new Error('拇指U样片时长必须为正数。');
 const start=at(0),end=at(1),before=withIdle(handPose(raw.before)),after=withIdle(handPose(raw.after)),support=(raw.supports as ContactData[]).map(contact),segments:FingerSegment[]=[];
 function add(from:number,length:number,stage:string,phase:string,sample:FingerSegment['sample']){segments.push({index:0,start:from*duration,duration:length*duration,stage,phase,active:'right',finger:1,sample});}
 add(0,.2,'PREPARE','左手接稳 · 右拇指接近后侧',p=>({left:clonePose(start.left),right:blendFingerPose(before,start.right,smooth(p)),angle:0,contacts:support}));
 add(.2,.1,'CONTACT','右拇指末节侧垫接触',()=>({left:clonePose(start.left),right:clonePose(start.right),angle:0,contacts:[...support,start.drive]}));
 add(.3,.24,'TURN','右拇指沿侧边拨动 · U',p=>{const f=at(smooth(p));return{left:f.left,right:f.right,angle:f.angle,contacts:[...support,f.drive]};});
 add(.54,.24,'RELEASE','上层停止 · 右拇指松开离面',p=>({left:clonePose(end.left),right:blendFingerPose(end.right,after,smooth(p)),angle:end.angle,contacts:support}));
 add(.78,.22,'HOLD','右拇指U单拨完成',()=>({left:clonePose(end.left),right:clonePose(after),angle:end.angle,contacts:support}));
 function sample(t:number):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?1:0,complete,angle:complete?0:f.angle,phase:s.phase,stage:s.stage,orientation:new Quaternion(),active:complete?null:'right',support:'left',activeFinger:1,progress};}
 return{duration,cost:duration,segments,steps:[{move,start:0,duration,active:'right'}],sample,statistics:{fingerTurns:1,wristTurns:0,retainedWrists:0,regrips:0,reorientations:0}};
}
