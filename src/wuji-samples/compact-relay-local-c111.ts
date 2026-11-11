import {Quaternion,Vector3} from 'three';
import {parseMove} from '../core/cube';
import {blendFingerPose,clonePose} from '../scene/finger-data';
import type {FingerProgram,FingerSegment} from '../scene/finger-program';
import {smooth,type HandPose,type MotionFrame} from '../scene/motion';
import {createTipFlickProgram} from './tip-flick';
import {createMiddleSideFlickProgram} from './side-relay';
import calibration from '../../art/wuji-teaching/compact-relay-calibration.json';

function withFinger(pose:HandPose,finger:2|3,angles:readonly number[]){
 const out=clonePose(pose);angles.forEach((a,i)=>out.joints![`right_finger${finger}_joint${i+1}`]=a);return out;
}
export const COMPACT_RELAY_METADATA={
 id:'c8-index-middle-compact-U2',
 methodLabel:'中指在第一拨前预备；食指屈收释放后保留屈曲，中指近距离接力，维持同一累积U2。',
 ...calibration,
};
/** New U2 phrase; leaves the accepted C5 and C7b standalone samples untouched. */
export function createLocalU2Program():FingerProgram{
 const first=createTipFlickProgram(),second=createMiddleSideFlickProgram(),move=parseMove('U2');
 const prepared=calibration.middlePrepared,fold=calibration.chosenIndexFold;
 const segments:FingerSegment[]=[],offset=-Math.PI/2,Y=new Vector3(0,1,0);let time=0;
 const firstTurn=first.segments.find(s=>s.stage==='TURN')!;
 const releaseStart=withFinger(firstTurn.sample(1).right,3,prepared);
 const releaseEnd=withFinger(releaseStart,2,fold);
 function add(s:FingerSegment){segments.push({...s,start:time,index:0});time+=s.duration;}
 for(const s of first.segments.filter(s=>s.stage!=='HOLD'))add({...s,duration:s.stage==='RELEASE'?.4:s.duration,
  phase:s.stage==='RELEASE'?'食指屈收离面 · 中指已预备':s.phase,
  sample:p=>{const f=s.sample(p);return{...f,right:s.stage==='RELEASE'?blendFingerPose(releaseStart,releaseEnd,smooth(p)):withFinger(f.right,3,prepared)};}
 });
 const startSecond=withFinger(second.segments.find(s=>s.stage==='CONTACT')!.sample(0).right,2,fold),left=clonePose(first.sample(0).left);
 const support=first.sample(0).contacts!.filter(c=>c.role==='support');
 add({index:0,start:0,duration:.45,stage:'TRANSFER',phase:'局部接力 · 食指屈收同时中指预备',active:'right',finger:3,
  sample:p=>({left:clonePose(left),right:blendFingerPose(releaseEnd,startSecond,smooth(p)),angle:offset,contacts:[...support]})});
 for(const s of second.segments.filter(s=>s.stage!=='PREPARE'))add({...s,duration:s.stage==='CONTACT'?.25:s.duration,
  phase:s.stage==='TURN'?'中指第二拨 · 完成 U2':s.phase,
  sample:p=>{const f=s.sample(p);return{...f,right:withFinger(f.right,2,fold),angle:f.angle+offset,
   contacts:f.contacts.map(c=>c.role==='drive'?{...c,point:c.point.clone().applyAxisAngle(Y,-offset),normal:c.normal.clone().applyAxisAngle(Y,-offset)}:c)};}
 });
 const duration=time;
 const sample=(t:number):MotionFrame=>{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?1:0,complete,angle:complete?0:f.angle,orientation:new Quaternion(),stage:s.stage,phase:complete?'双拨完成':s.phase,active:complete?null:'right',support:'left',activeFinger:s.finger,progress};};
 return{duration,cost:duration,segments,steps:[{move,start:0,duration,active:'right'}],sample,statistics:{fingerTurns:2,wristTurns:0,regrips:0,retainedWrists:0,reorientations:0}};
}
