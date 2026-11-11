import{Quaternion,Vector3}from'three';
import{NORMALS,moveAngle,parseMove,type Move}from'../core/cube';
import{blendFingerPose,clonePose}from'../scene/finger-data';
import{fingerJoints,forwardFinger,type FingerIndex}from'../scene/finger-rig';
import{smooth,type MotionFrame,type Side}from'../scene/motion';
import type{FingerProgram,FingerSegment}from'../scene/finger-program';
import{createLeftSideFlickProgram}from'./left-side-flick';import{createBottomRingProgram}from'./bottom-ring';

function program(move:Move,segments:FingerSegment[],active:Side):FingerProgram{
 let duration=0;segments=segments.map(s=>{const part={...s,start:duration};duration+=s.duration;return part;});
 return{duration,cost:duration,steps:[{move,start:0,duration,active}],segments,sample(t):MotionFrame{const complete=t>=duration,s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,p=Math.max(0,Math.min(1,(t-s.start)/s.duration));return{...s.sample(p),index:complete?1:0,complete,orientation:new Quaternion(),angle:complete?0:s.sample(p).angle,stage:s.stage,phase:s.phase,active:complete?null:active,support:active==='left'?'right':'left',activeFinger:s.finger,progress:p};},statistics:{fingerTurns:segments.filter(s=>s.stage==='TURN'&&s.finger).length,wristTurns:segments.filter(s=>s.stage==='TURN'&&!s.finger).length,regrips:0,retainedWrists:0,reorientations:0}};
}

/** Two real side-pad strokes in one solver half-turn. The local released pad
 * follows an outward cubic; second material contact is inverse-transported
 * through the first90 degrees. This is a proposal until mesh/visual acceptance. */
export function createReverseDoubleProgram(notation:string,bow=.060):FingerProgram{
 const move=parseMove(notation);if(move.kind||move.turns!==2||!['U','D'].includes(move.face)||moveAngle(move)<0)throw Error('Expected U2-prime/D2-prime');
 const quarter=move.face==='U'?createLeftSideFlickProgram():createBottomRingProgram(true),axis=new Vector3(...NORMALS[move.face]),delta=moveAngle(move)/2,turn=quarter.segments.find(s=>s.stage==='TURN')!,active=turn.active!,digit=turn.finger as FingerIndex,drive=turn.sample(0).contacts.find(c=>c.role==='drive')!,released=quarter.segments.find(s=>s.stage==='RELEASE')!.sample(1),contact=quarter.segments.find(s=>s.stage==='CONTACT')!.sample(0),other=active==='right'?'left':'right';
 const fk=(pose:typeof released.left)=>forwardFinger(active,digit,fingerJoints(active,digit).map(j=>pose.joints![j.name]),pose,drive.padOffset).position;
 const a=released[active],b=contact[active],na=drive.normal.clone().applyAxisAngle(axis,delta),nb=drive.normal.clone(),outsideA=clonePose(a),outsideB=clonePose(b);outsideA.position.addScaledVector(na,.025);outsideB.position.addScaledVector(nb,.025);
 const start=fk(outsideA),end=fk(outsideB),ca=start.clone().addScaledVector(na,bow),cb=end.clone().addScaledVector(nb,bow),parts:FingerSegment[]=[];
 for(let stroke=0;stroke<2;stroke++){
  const offset=stroke*delta,inverse=new Quaternion().setFromAxisAngle(axis,-offset);
  if(stroke){
   const reset=(duration:number,phase:string,pose:(p:number)=>typeof a)=>parts.push({index:0,start:0,duration,stage:'REGRIP',phase:'C113 · 半圈保持90° · '+phase,active,finger:digit,sample:p=>({left:active==='left'?pose(p):clonePose(released.left),right:active==='right'?pose(p):clonePose(released.right),angle:offset,contacts:released.contacts.filter(c=>c.side===other&&c.role==='support')})});
   reset(.20,'已释放指尖沿法线外移',p=>blendFingerPose(a,outsideA,smooth(p)));
   reset(.65,'保持离面 · 指尖局部回弹',p=>{const t=smooth(p),u=1-t,pose=blendFingerPose(outsideA,outsideB,t),desired=start.clone().multiplyScalar(u*u*u).addScaledVector(ca,3*u*u*t).addScaledVector(cb,3*u*t*t).addScaledVector(end,t*t*t);pose.position.add(desired.sub(fk(pose)));return pose;});
   reset(.25,'末节预备后沿法线重新接近',p=>blendFingerPose(outsideB,b,smooth(p)));
  }
  for(const s of quarter.segments.filter(s=>s.stage!=='HOLD'&&!(stroke&&s.stage==='PREPARE')))parts.push({...s,index:0,duration:s.stage==='RELEASE'&&stroke===0?.4:s.stage==='CONTACT'&&stroke===1?.25:s.duration,phase:'C113 · 第'+(stroke+1)+'拨 · '+s.phase,sample:p=>{const f=s.sample(p);return{...f,angle:offset+f.angle,contacts:f.contacts.map(c=>c.role==='drive'?{...c,point:c.point.clone().applyQuaternion(inverse),normal:c.normal.clone().applyQuaternion(inverse)}:c)};}});
 }
 return program(move,parts,active);
}
