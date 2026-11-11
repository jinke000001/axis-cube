import{Quaternion,Vector3}from'three';
import{NORMALS,parseMove,moveAngle}from'../core/cube';
import{clonePose}from'../scene/finger-data';
import type{FingerProgram,FingerSegment}from'../scene/finger-program';
import type{MotionFrame}from'../scene/motion';
import{createRingSideFlickProgram}from'./ring-side-flick';
import{smooth}from'../scene/motion';
import{blendFingerPose}from'../scene/finger-data';

/** Two released ring strokes in one original M2-prime step. The second contact is
 * expressed in the already-turned layer frame; local reset never moves a layer. */
export function createLocalMiddleDoubleProgram():FingerProgram{
 const quarter=createRingSideFlickProgram(),move=parseMove("M2'"),quarterMove=quarter.steps[0].move,delta=moveAngle(quarterMove),axis=new Vector3(...NORMALS[move.face]),turn=quarter.segments.find(s=>s.stage==='TURN')!,drive=turn.sample(0).contacts.find(c=>c.role==='drive')!,a=quarter.segments.find(s=>s.stage==='RELEASE')!.sample(1),b=quarter.segments[0].sample(0);
 let duration=0;const segments:FingerSegment[]=[];
 const add=(seconds:number,stage:string,phase:string,sample:FingerSegment['sample'])=>{segments.push({index:0,start:duration,duration:seconds,stage,phase,active:'left',finger:4,sample});duration+=seconds;};
 for(let stroke=0;stroke<2;stroke++){
  const offset=stroke*delta,inverse=new Quaternion().setFromAxisAngle(axis,-offset);
  if(stroke){
   const folded=(pose:typeof a.left)=>{const out=clonePose(pose);out.joints!.left_finger4_joint3=1.10;out.joints!.left_finger4_joint4=.85;return out;},foldA=folded(a.left),foldB=folded(b.left),openB=clonePose(b.left),contactB=quarter.segments.find(s=>s.stage==='CONTACT')!.sample(0).left;
   foldB.position.addScaledVector(drive.normal,.038);openB.position.addScaledVector(drive.normal,.038);
   for(const[from,to,seconds,label]of [[a.left,foldA,.22,'末节屈收离面'],[foldA,foldB,.35,'屈收回弹并沿接触面法线让位'],[foldB,openB,.25,'离面展开末节'],[openB,contactB,.25,'指尖局部重新接近']]as const)add(seconds,'REGRIP','中层保持90° · 掌腕留近 · '+label,p=>({left:blendFingerPose(from,to,smooth(p)),right:clonePose(a.right),contacts:a.contacts.filter(c=>c.role==='support'),angle:offset}));
  }
  for(const s of quarter.segments.filter(s=>s.stage!=='HOLD'&&!(stroke&&s.stage==='PREPARE')))add(stroke?(s.stage==='PREPARE'?.30:s.stage==='CONTACT'?.25:s.duration):(s.stage==='RELEASE'?.40:s.duration),s.stage,(stroke?'第二拨 · ':'第一拨 · ')+s.phase,p=>{const f=s.sample(p);return{...f,angle:offset+f.angle,contacts:f.contacts.map(c=>c.role==='drive'?{...c,point:c.point.clone().applyQuaternion(inverse),normal:c.normal.clone().applyQuaternion(inverse),padOffset:c.padOffset.clone()}:c)};});
 }
 add(.6,'HOLD','原表M2′完成 · 无名指已释放',()=>({...a,left:clonePose(a.left),right:clonePose(a.right),angle:moveAngle(move)}));
 return{duration,cost:duration,steps:[{move,start:0,duration,active:'left'}],segments,sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?1:0,angle:complete?0:f.angle,orientation:new Quaternion(),complete,phase:s.phase,stage:s.stage,active:complete?null:'left',support:'right',activeFinger:4,progress};},statistics:{fingerTurns:2,wristTurns:0,retainedWrists:0,regrips:1,reorientations:0}};
}
