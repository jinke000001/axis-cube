import {Quaternion,Vector3} from 'three';
import {parseMove,moveAngle} from '../core/cube';
import {blendFingerPose,clonePose,handPose,type PoseData} from '../scene/finger-data';
import {contactTarget,type FingerContact} from '../scene/finger-contact';
import {fingerJoints,forwardFinger} from '../scene/finger-rig';
import type {FingerProgram,FingerSegment} from '../scene/finger-program';
import {smooth,type MotionFrame} from '../scene/motion';
import {createTipFlickProgram} from './tip-flick';
import raw from '../../art/wuji-teaching/right-middle-side-calibration.json';

interface ContactData{side:'left'|'right';finger:1|2|3|4|5;role:'support'|'drive';point:number[];normal:number[];padOffset:number[];}
interface FrameData{progress:number;angle:number;left:PoseData;right:PoseData;active:ContactData;}
const frames=raw.frames as unknown as FrameData[],move=parseMove('U'),supportData=raw.supports as ContactData[];
const makeContact=(c:ContactData):FingerContact=>({...c,point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)});
function at(progress:number){const cursor=Math.max(0,Math.min(1,progress))*(frames.length-1),lo=Math.floor(cursor),hi=Math.min(frames.length-1,lo+1),p=cursor-lo,a=frames[lo],b=frames[hi];
 const right=blendFingerPose(handPose(a.right),handPose(b.right),p),left=handPose(a.left),angle=moveAngle(move)*progress,drive=makeContact(a.active);drive.padOffset.lerp(new Vector3().fromArray(b.active.padOffset),p);
 // Rigid-link FK preserves exact material contact between authored keys; this
 // corrects submillimetre chord interpolation only and does not solve IK live.
 const angles=fingerJoints('right',3).map(j=>right.joints![j.name]),actual=forwardFinger('right',3,angles,right,drive.padOffset).position;
 right.position.add(contactTarget(drive,move,angle).point.sub(actual));
 return{left,right,angle,drive};}
export function createMiddleSideFlickProgram(duration=4.5):FingerProgram{
 if(!Number.isFinite(duration)||duration<=0)throw new Error('指尖样片时长必须为正数。');
 const start=at(0),end=at(1),before=handPose(raw.before),after=handPose(raw.after),support=supportData.map(makeContact),segments:FingerSegment[]=[];
 function add(from:number,length:number,stage:string,phase:string,sample:FingerSegment['sample']){segments.push({index:0,start:from*duration,duration:length*duration,stage,phase,active:'right',finger:3,sample});}
 add(0,.2,'PREPARE','中指指尖从侧边靠近',p=>({left:clonePose(start.left),right:blendFingerPose(before,start.right,smooth(p)),angle:0,contacts:support}));
 add(.2,.1,'CONTACT','指尖侧垫接触上层后侧',()=>({left:clonePose(start.left),right:clonePose(start.right),angle:0,contacts:[...support,start.drive]}));
 add(.3,.24,'TURN','中指沿侧边拨动 · U',p=>{const frame=at(smooth(p));return{left:frame.left,right:frame.right,angle:frame.angle,contacts:[...support,frame.drive]};});
 add(.54,.24,'RELEASE','指尖松开并离开魔方',p=>({left:clonePose(end.left),right:blendFingerPose(end.right,after,smooth(p)),angle:end.angle,contacts:support}));
 add(.78,.22,'HOLD','单拨完成',()=>({left:clonePose(end.left),right:clonePose(after),angle:end.angle,contacts:support}));
 const sample=(time:number):MotionFrame=>{const complete=time>=duration,segment=segments.find(s=>time<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(time-segment.start)/segment.duration)),state=segment.sample(progress);return{...state,index:complete?1:0,angle:complete?0:state.angle,phase:complete?'单拨完成':segment.phase,stage:complete?'HOLD':segment.stage,orientation:new Quaternion(),active:complete?null:'right',support:'left',activeFinger:3,progress,complete};};
 return{duration,cost:duration,segments,steps:[{move,start:0,duration,active:'right'}],sample,statistics:{fingerTurns:1,wristTurns:0,retainedWrists:0,regrips:0,reorientations:0}};
}

/** Two distinct source quarter strokes, one cumulative U2 state. */
export function createSideU2Program():FingerProgram{
 const first=createTipFlickProgram(),second=createMiddleSideFlickProgram(),move=parseMove('U2');
 const offset=-Math.PI/2,Y=new Vector3(0,1,0),segments:FingerSegment[]=[];let time=0;
 function add(s:FingerSegment){segments.push({...s,start:time,index:0});time+=s.duration;}
 for(const s of first.segments.filter(s=>s.stage!=='HOLD'))add(s);
 const a=first.sample(first.duration),b=second.sample(0),support=a.contacts!.filter(c=>c.role==='support');
 const out=clonePose(a.right),ready=clonePose(b.right);out.position.x+=.05;ready.position.x+=.05;
 for(const [from,to,duration] of [[a.right,out,.4],[out,ready,.7],[ready,b.right,.4]] as const)
  add({index:0,start:0,duration,stage:'TRANSFER',phase:'食指释放 · 中指沿侧边接力',active:'right',finger:3,
   sample:p=>({left:clonePose(a.left),right:blendFingerPose(from,to,smooth(p)),angle:offset,contacts:[...support]})});
 for(const s of second.segments){add({...s,phase:s.stage==='TURN'?'中指第二拨 · 完成 U2':s.phase,sample:p=>{
  const f=s.sample(p);return {...f,angle:f.angle+offset,contacts:f.contacts.map(c=>c.role==='drive'?{...c,point:c.point.clone().applyAxisAngle(Y,-offset),normal:c.normal.clone().applyAxisAngle(Y,-offset)}:c)};
 }});}
 const duration=time;
 const sample=(t:number):MotionFrame=>{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?1:0,complete,angle:complete?0:f.angle,orientation:new Quaternion(),stage:s.stage,phase:complete?'双拨完成':s.phase,active:complete?null:'right',support:'left',activeFinger:s.finger,progress};};
 return{duration,cost:duration,segments,steps:[{move,start:0,duration,active:'right'}],sample,statistics:{fingerTurns:2,wristTurns:0,regrips:0,retainedWrists:0,reorientations:0}};
}
