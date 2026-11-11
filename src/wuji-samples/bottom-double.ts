import{Quaternion,Vector3}from'three';
import{NORMALS,parseMove,moveAngle}from'../core/cube';
import{clonePose,blendFingerPose}from'../scene/finger-data';
import{fingerJoints,forwardFinger}from'../scene/finger-rig';
import{smooth}from'../scene/motion';
import{contactTarget}from'../scene/finger-contact';
import type{FingerProgram,FingerSegment}from'../scene/finger-program';
import type{MotionFrame}from'../scene/motion';
import{createBottomRingProgram}from'./bottom-ring';

/** Two released ring strokes in one original D2 step. The second contact is
 * expressed in the already-turned layer frame; reset never moves a layer. */
export function createBottomDoubleProgram():FingerProgram{
 const quarter=createBottomRingProgram(),move=parseMove('D2'),quarterMove=quarter.steps[0].move,delta=moveAngle(quarterMove),axis=new Vector3(...NORMALS[move.face]),turn=quarter.segments.find(s=>s.stage==='TURN')!,drive=turn.sample(0).contacts.find(c=>c.role==='drive')!,a=quarter.segments.find(s=>s.stage==='RELEASE')!.sample(1),b=quarter.segments[0].sample(0),normalA=contactTarget(drive,quarterMove,delta).normal,normalB=drive.normal;
 let duration=0;const segments:FingerSegment[]=[];
 const add=(seconds:number,stage:string,phase:string,sample:FingerSegment['sample'])=>{segments.push({index:0,start:duration,duration:seconds,stage,phase,active:'left',finger:4,sample});duration+=seconds;};
 for(let stroke=0;stroke<2;stroke++){
  const offset=stroke*delta,inverse=new Quaternion().setFromAxisAngle(axis,-offset);
  if(stroke){
   const fk=(pose:typeof a.left)=>forwardFinger('left',4,fingerJoints('left',4).map(j=>pose.joints![j.name]),pose,drive.padOffset).position,start=fk(a.left),end=fk(b.left),ca=start.clone().addScaledVector(normalA,.06),cb=end.clone().addScaledVector(normalB,.06);
   add(1.1,'REGRIP','底层停止 · 环指离面绕过底层外角后预备',p=>{const t=smooth(p),u=1-t,left=blendFingerPose(a.left,b.left,t),target=start.clone().multiplyScalar(u*u*u).addScaledVector(ca,3*u*u*t).addScaledVector(cb,3*u*t*t).addScaledVector(end,t*t*t);left.position.add(target.sub(fk(left)));return{left,right:clonePose(a.right),contacts:a.contacts.filter(c=>c.role==='support'),angle:offset};});
  }
  for(const s of quarter.segments.filter(s=>s.stage!=='HOLD'))add(s.duration,s.stage,(stroke?'第二拨 · ':'第一拨 · ')+s.phase,p=>{const f=s.sample(p);return{...f,angle:offset+f.angle,contacts:f.contacts.map(c=>c.role==='drive'?{...c,point:c.point.clone().applyQuaternion(inverse),normal:c.normal.clone().applyQuaternion(inverse),padOffset:c.padOffset.clone()}:c)};});
 }
 add(.6,'HOLD','原表D2完成 · 无名指已释放',()=>({...a,left:clonePose(a.left),right:clonePose(a.right),angle:moveAngle(move)}));
 return{duration,cost:duration,steps:[{move,start:0,duration,active:'left'}],segments,sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress);return{...f,index:complete?1:0,angle:complete?0:f.angle,orientation:new Quaternion(),complete,phase:s.phase,stage:s.stage,active:complete?null:'left',support:'right',activeFinger:4,progress};},statistics:{fingerTurns:2,wristTurns:0,retainedWrists:0,regrips:1,reorientations:0}};
}
