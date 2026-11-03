import { Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NORMALS, moveAngle, type Vec3 } from '../core/cube';
import { FINGER_NAMES, HANDS, getCompiledTeachingMotion, getCompiledTeachingMotionIds, withAuthoringMotionReference, sampleTeachingMotion, type TeachingFrame, type TeachingPose, type TeachingMotion, type TeachingContact } from './motion';
import type { TeachingFinger, TeachingHand } from './types';
import { FINGER_LENGTHS, FINGER_BASES, REST_TIP_HEIGHTS } from './rig-spec';
import { frameCubeShapes, obbPenetration, type RoundedBox } from './geometry-shapes';
import {buildArmTrajectory,validateArmTrajectory,sampleArmTrajectory,ARM_TRAJECTORY_PARAMETERS,type ArmTrajectoryData} from './arm-trajectory';
import {interpolateFingerDirections} from './finger-path';
import specification from '../../art/teaching-hand/rig.json';
export { FINGER_LENGTHS, FINGER_BASES } from './rig-spec';
const UP=new Vector3(0,1,0);
const v=(p:readonly number[])=>new Vector3().fromArray(p);
const a=(p:Vector3)=>p.toArray() as Vec3;
const restLocal=(hand:TeachingHand,finger:TeachingFinger)=>new Vector3((hand==='right'?-1:1)*.01,REST_TIP_HEIGHTS[finger],finger==='thumb'?.055:-.055);
function isResting(pose:TeachingPose,hand:TeachingHand,finger:TeachingFinger) {
  return pose[hand].tips[finger].resting===true;
}
export interface RigidFingerSolution {
  hand:TeachingHand;
  finger:TeachingFinger;
  joints:[Vec3,Vec3,Vec3,Vec3];
  reachError:number;
  minimumClearance:number;
}

/** Signed point-to-box distance, conservative around the stationary cube shell. */
function boxDistance(point:Vector3,half=.0453):number {
  const dx=Math.abs(point.x)-half,dy=Math.abs(point.y)-half,dz=Math.abs(point.z)-half;
  return Math.hypot(Math.max(0,dx),Math.max(0,dy),Math.max(0,dz))+Math.min(0,Math.max(dx,dy,dz));
}
type DistanceField=(point:Vector3)=>number;
function linkClearance(from:Vector3,to:Vector3,radius=.0036,distance:DistanceField=boxDistance):number {
  let min=Infinity;
  const point=new Vector3(),dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
  for(let i=1;i<16;i++) min=Math.min(min,distance(point.set(from.x+dx*i/16,from.y+dy*i/16,from.z+dz*i/16))-radius);
  return min;
}
function cubeEnvelope(frame?:Pick<TeachingFrame,'move'|'angle'>):DistanceField {
  if(!frame?.move||Math.abs(frame.angle)<1e-9)return boxDistance;
  const normal=v(NORMALS[frame.move.face]),axis=Math.abs(normal.x)>.5?'x':Math.abs(normal.y)>.5?'y':'z';
  const layers=frame.move.layers??[1],groups:{moving:boolean;layers:number[]}[]=[];
  for(const layer of [-1,0,1]) {
    const moving=layers.some(x=>x===layer),last=groups.at(-1);
    if(last?.moving===moving)last.layers.push(layer);else groups.push({moving,layers:[layer]});
  }
  const boxes=groups.map(group=> {
    const q=group.moving?new Quaternion().setFromAxisAngle(normal,frame.angle):new Quaternion();
    const center=normal.clone().multiplyScalar(group.layers.reduce((a,b)=>a+b,0)/group.layers.length*.03).applyQuaternion(q);
    const half=new Vector3(.0453,.0453,.0453);half[axis]=group.layers.length*.015+.0003;
    return {center,inverse:q.invert(),half,radius:half.length()};
  });
  const local=new Vector3();
  return point=> {
    let minimum=Infinity;
    for(const box of boxes) {
      const bound=box.radius+minimum+1e-10;
      if(Number.isFinite(bound)&&(bound<=0||point.distanceToSquared(box.center)>bound*bound))continue;
      local.copy(point).sub(box.center).applyQuaternion(box.inverse);
      const dx=Math.abs(local.x)-box.half.x,dy=Math.abs(local.y)-box.half.y,dz=Math.abs(local.z)-box.half.z;
      const dist=Math.hypot(Math.max(0,dx),Math.max(0,dy),Math.max(0,dz))+Math.min(0,Math.max(dx,dy,dz));
      minimum=Math.min(minimum,dist);
    }
    return minimum;
  };
}
const supportForecasts=new WeakMap<TeachingMotion,Map<string,DistanceField[]>>();
/** A held pad can outlast several source turns. Plan its bones against all
 * of those swept layers before selecting a pole, rather than changing poles
 * as each new letter makes a different local space look available. */
function supportCubeEnvelopes(pose:TeachingPose,frame:PoseFrame,owner:{hand:TeachingHand;finger:TeachingFinger}):DistanceField[]|undefined {
  const program=frame.motionId?getCompiledTeachingMotion(frame.motionId):undefined;
  if(!program||frame.time===undefined)return;
  let index=program.segments.findIndex(segment=>frame.time!>=segment.start-1e-9&&frame.time!<segment.start+segment.duration-1e-9);
  if(index<0)index=program.segments.length-1;
  const key=`${index}:${owner.hand}:${owner.finger}`;
  let cache=supportForecasts.get(program);if(!cache){cache=new Map();supportForecasts.set(program,cache);}
  const existing=cache.get(key);if(existing)return existing;
  const reference=program.segments[index].from[owner.hand];
  const same=(values:readonly number[],other:readonly number[])=>values.every((n,i)=>Math.abs(n-other[i])<1e-8);
  const matches=(candidate:typeof reference)=>same(candidate.palm,reference.palm)&&same(candidate.rotation,reference.rotation)
    &&same(candidate.tips[owner.finger].point,reference.tips[owner.finger].point)
    &&same(candidate.tips[owner.finger].normal,reference.tips[owner.finger].normal);
  const held=(i:number)=> {
    const segment=program.segments[i];
    return segment.contacts.some(contact=>contact.role==='support'&&!contact.rotating&&contact.hand===owner.hand&&contact.finger===owner.finger)
      &&matches(segment.from[owner.hand])&&matches(segment.to[owner.hand]);
  };
  // A moving palm/anchor needs the normal per-turn continuous solver.
  if(!matches(pose[owner.hand])||!held(index))return;
  let first=index,last=index;
  while(first>0&&held(first-1))first--;
  while(last+1<program.segments.length&&held(last+1))last++;
  const fields=new Map<string,DistanceField>();
  fields.set('stationary',boxDistance);
  for(let i=first;i<=last;i++) {
    const move=program.steps[program.segments[i].step].move;
    for(const blend of [.25,.5,.75,1]) {
      const angle=moveAngle(move)*blend,identity=`${move.face}:${(move.layers??[1]).join(',')}:${angle}`;
      if(!fields.has(identity))fields.set(identity,cubeEnvelope({move,angle}));
    }
  }
  const envelopes=[...fields.values()];
  for(let i=first;i<=last;i++)cache.set(`${i}:${owner.hand}:${owner.finger}`,envelopes);
  return envelopes;
}
function poseEnvelope(pose:TeachingPose,frame?:Pick<TeachingFrame,'move'|'angle'>,swept=false,owner?:{hand:TeachingHand;finger:TeachingFinger}):DistanceField {
  const forecast=swept&&owner&&frame&&'contacts' in frame?supportCubeEnvelopes(pose,frame as PoseFrame,owner):undefined;
  const envelopes=forecast??(swept&&frame?.move?[0,.25,.5,.75,1].map(blend=>cubeEnvelope({move:frame.move,angle:moveAngle(frame.move!)*blend})):[cubeEnvelope(frame)]);
  const cube=(point:Vector3)=>{let gap=Infinity;for(const field of envelopes)gap=Math.min(gap,field(point));return gap;};
  const boxes=HANDS.flatMap(hand=> {
    const h=pose[hand],q=new Quaternion().fromArray(h.rotation),sign=hand==='right'?1:-1;
    return [{center:v(h.palm),inverse:q.clone().invert(),half:v(specification.geometry.palmSize).multiplyScalar(.5)},
      {center:new Vector3(-sign*specification.geometry.palmInnerOffset,0,0).applyQuaternion(q).add(v(h.palm)),inverse:q.clone().invert(),half:v(specification.geometry.palmInnerSize).multiplyScalar(.5)}];
  });
  const couplers=HANDS.map(hand=>v(specification.wristAttachment).applyQuaternion(new Quaternion().fromArray(pose[hand].rotation)).add(v(pose[hand].palm)));
  const local=new Vector3();
  const bounded=boxes.map(box=>({...box,radius:box.half.length()}));
  return point=> {
    let minimum=cube(point);
    for(const center of couplers)minimum=Math.min(minimum,point.distanceTo(center)-specification.geometry.wristCouplerRadius);
    for(const box of bounded) {
      const bound=box.radius+minimum+1e-10;
      if(bound<=0||point.distanceToSquared(box.center)>bound*bound)continue;
      const p=local.copy(point).sub(box.center).applyQuaternion(box.inverse);
      const dx=Math.abs(p.x)-box.half.x,dy=Math.abs(p.y)-box.half.y,dz=Math.abs(p.z)-box.half.z;
      minimum=Math.min(minimum,Math.hypot(Math.max(0,dx),Math.max(0,dy),Math.max(0,dz))+Math.min(0,Math.max(dx,dy,dz)));
    }
    return minimum;
  };
}
const mountColumns=new WeakMap<TeachingPose,{hand:TeachingHand;finger:TeachingFinger;start:Vector3;end:Vector3;center:Vector3}[]>();
function mountField(pose:TeachingPose,owner:{hand:TeachingHand;finger:TeachingFinger},base:DistanceField):DistanceField {
  let columns=mountColumns.get(pose);
  if(!columns) {
    columns=HANDS.flatMap(hand=>FINGER_NAMES.map(finger=> {
      const sign=hand==='right'?1:-1,q=new Quaternion().fromArray(pose[hand].rotation),offset=FINGER_BASES[finger];
      const start=new Vector3(sign*offset[0],offset[1],offset[2]).applyQuaternion(q).add(v(pose[hand].palm));
      const end=start.clone().add(new Vector3(sign*specification.geometry.mcpMountLength,0,0).applyQuaternion(q));
      return {hand,finger,start,end,center:start.clone().add(end).multiplyScalar(.5)};
    }));mountColumns.set(pose,columns);
  }
  return point=> {
    let gap=base(point);
    for(const column of columns) {
      if(point.distanceToSquared(column.center)>.02**2)continue;
      if(column.hand===owner.hand&&column.finger===owner.finger&&point.distanceToSquared(column.start)<.008**2)continue;
      gap=Math.min(gap,segmentDistance(point,point,column.start,column.end)-specification.geometry.mcpMountRadius);
    }
    return gap;
  };
}
function segmentDistance(a:Vector3,b:Vector3,c:Vector3,d:Vector3) {
  const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=d.x-c.x,vy=d.y-c.y,vz=d.z-c.z,wx=a.x-c.x,wy=a.y-c.y,wz=a.z-c.z;
  const aa=ux*ux+uy*uy+uz*uz,bb=ux*vx+uy*vy+uz*vz,cc=vx*vx+vy*vy+vz*vz,dd=ux*wx+uy*wy+uz*wz,ee=vx*wx+vy*wy+vz*wz;
  const clamp=(x:number)=>Math.max(0,Math.min(1,x));
  let s=0,t=0;
  if(aa<1e-12&&cc<1e-12)return a.distanceTo(c);
  if(aa<1e-12)t=clamp(ee/cc);
  else if(cc<1e-12)s=clamp(-dd/aa);
  else {const denom=aa*cc-bb*bb;s=denom>1e-12?clamp((bb*ee-cc*dd)/denom):0;t=(bb*s+ee)/cc;
    if(t<0){t=0;s=clamp(-dd/aa);}else if(t>1){t=1;s=clamp((bb-dd)/aa);}}
  return Math.hypot(wx+ux*s-vx*t,wy+uy*s-vy*t,wz+uz*s-vz*t);
}
function adjacentLinkClearance(points:Vector3[]) {
  let gap=Infinity;
  for(let joint=1;joint<points.length-1;joint++) {
    const center=points[joint],before=points[joint-1],after=points[joint+1];
    const left=before.clone().sub(center).normalize(),right=after.clone().sub(center).normalize();
    const radius=.0028,trim=specification.geometry.jointRadii[joint]+radius+.0003;
    gap=Math.min(gap,segmentDistance(before.clone().addScaledVector(left,-.002),center.clone().addScaledVector(left,trim),
      center.clone().addScaledVector(right,trim),after.clone().addScaledVector(right,-.002))-radius*2);
  }
  return gap;
}
type ObstacleLink={a:Vector3;b:Vector3;center?:Vector3;radius?:number};
function otherClearance(points:Vector3[],obstacles:ObstacleLink[]) {
  let min=Infinity;
  for(let i=0;i<points.length-1;i++) {
    const center=points[i].clone().add(points[i+1]).multiplyScalar(.5),radius=points[i].distanceTo(points[i+1])*.5;
    for(const o of obstacles) {
      const bound=radius+o.radius!+.012;
      if(center.distanceToSquared(o.center!)>bound*bound)continue;
      min=Math.min(min,segmentDistance(points[i],points[i+1],o.a,o.b)-.0082);
    }
  }
  return min;
}
function twoLink(start:Vector3,end:Vector3,l1:number,l2:number,pole:Vector3,avoidCube:boolean,tip?:Vector3,obstacles:ObstacleLink[]=[],field:DistanceField=boxDistance,linkRadius=.0036) {
  const delta=end.clone().sub(start), actual=delta.length();
  const distance=Math.max(Math.abs(l1-l2)+1e-6,Math.min(l1+l2-1e-6,actual));
  const direction=delta.normalize();
  const target=start.clone().addScaledVector(direction,distance);
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),radius=Math.sqrt(Math.max(0,l1*l1-along*along));
  let radial=pole.clone().sub(start).addScaledVector(direction,-pole.clone().sub(start).dot(direction));
  if(radial.lengthSq()<1e-16) {
    const basis=Math.abs(direction.x)<.8?new Vector3(1,0,0):new Vector3(0,1,0);
    radial=basis.addScaledVector(direction,-basis.dot(direction));
  }
  radial.normalize();const binormal=direction.clone().cross(radial).normalize();
  let best=start.clone().addScaledVector(direction,along).addScaledVector(radial,radius), score=Infinity,clearance=-Infinity;
  // Pole choices keep the knuckles on the outside; each candidate has exactly
  // the authored link lengths, never an elongated or detached finger.
  for(const i of [0,...Array.from({length:16},(_,i)=>[i+1,-i-1]).flat()]) {
    const angle=i*Math.PI/16;
    const elbow=start.clone().addScaledVector(direction,along)
      .addScaledVector(radial,radius*Math.cos(angle)).addScaledVector(binormal,radius*Math.sin(angle));
    const self=tip?Math.min(segmentDistance(start,elbow,target,tip)-.0077,
      segmentDistance(elbow,target,tip,tip)-.0069,adjacentLinkClearance([start,elbow,target,tip])):1;
    const other=obstacles.length?otherClearance(tip?[start,elbow,target,tip]:[start,elbow,target],obstacles):1;
    const gap=avoidCube?Math.min(linkClearance(start,elbow,linkRadius,field),linkClearance(elbow,target,linkRadius,field),field(elbow)-Math.max(.0041,linkRadius),field(target)-Math.max(.0041,linkRadius),self,other):1;
    const cost=Math.max(0,.001-gap)*1e4+angle*angle*.0004;
    if(cost<score) {score=cost;best=elbow;clearance=gap;}
    if(cost===0)break;
  }
  return {elbow:best,target,error:Math.abs(actual-distance),clearance};
}
function constrainDistalDirection(direction:Vector3,contact?:TeachingContact,normal?:Vector3) {
  if(!contact?.distalAway)return direction;
  const away=v(contact.distalAway),component=direction.dot(away),minimum=.18;
  if(component<minimum) {
    direction.addScaledVector(away,-component);
    if(direction.lengthSq()<1e-12)direction.copy(normal??new Vector3(0,0,1));
    direction.normalize().multiplyScalar(Math.sqrt(1-minimum*minimum)).addScaledVector(away,minimum);
  }
  return direction;
}
type PoseFrame=Pick<TeachingFrame,'move'|'angle'|'contacts'|'motionId'|'time'>;
const padGuides=new WeakMap<PoseFrame,TeachingContact[]>();
/** A toolpath constraint is not a physical contact. During the short final
 * approach/departure the pad follows the authored surface-normal line, while
 * frame.contacts continues to contain only fingers actually touching. */
function trajectoryConstraints(frame:PoseFrame):TeachingContact[] {
  const cached=padGuides.get(frame);if(cached)return cached;
  const contacts=[...frame.contacts],program=frame.motionId?getCompiledTeachingMotion(frame.motionId):undefined;
  if(program&&frame.time!==undefined)for(let index=0;index<program.segments.length;index++) {
    const segment=program.segments[index];
    if(frame.time<segment.start-1e-8||frame.time>segment.start+segment.duration+1e-8)continue;
    if(segment.padGuides?.length) {
      for(const guide of segment.padGuides)if(!contacts.some(c=>c.hand===guide.hand&&c.finger===guide.finger))contacts.push(guide);
      continue;
    }
    if(!['contact','release'].includes(segment.phase))continue;
    const direction=segment.phase==='contact'?1:-1;
    let next=index+direction;
    while(next>=0&&next<program.segments.length&&program.segments[next].step===segment.step&&program.segments[next].phase!=='drive')next+=direction;
    const drive=program.segments[next];if(!drive||drive.step!==segment.step||drive.phase!=='drive')continue;
    for(const contact of drive.contacts.filter(c=>c.role==='drive')) {
      if(contacts.some(c=>c.hand===contact.hand&&c.finger===contact.finger))continue;
      const from=segment.from[contact.hand].tips[contact.finger],to=segment.to[contact.hand].tips[contact.finger];
      const delta=v(to.point).sub(v(from.point)),normal=v(to.normal);
      if(delta.length()<1e-7||delta.length()>.025||delta.clone().cross(normal).length()>1e-7||v(from.normal).dot(normal)<.99999)continue;
      contacts.push(contact);
    }
  }
  padGuides.set(frame,contacts);return contacts;
}
interface BranchReference {pose:TeachingPose;solutions:RigidFingerSolution[]}
let restingSolutions:RigidFingerSolution[]|undefined;
function restSolutions() {
  if(restingSolutions)return restingSolutions;
  const pose={} as TeachingPose;
  for(const hand of HANDS) {
    const palm=new Vector3((hand==='right'?1:-1)*.09,-.004,0);
    pose[hand]={palm:a(palm),rotation:[0,0,0,1],tips:Object.fromEntries(FINGER_NAMES.map(finger=>[finger,{point:a(restLocal(hand,finger).add(palm)),normal:[hand==='right'?1:-1,0,0],resting:true}])) as TeachingPose['left']['tips']};
  }
  restingSolutions=solvePoseWithBranch(pose,undefined,undefined,true);return restingSolutions;
}
function solvePoseWithBranch(pose:TeachingPose,frame?:PoseFrame,reference?:BranchReference,buildingRest=false):RigidFingerSolution[] {
  const constraints=frame?trajectoryConstraints(frame):[];
  const envelope=poseEnvelope(pose,frame);
  const distance=buildingRest?(point:Vector3)=>Math.min(envelope(point),boxDistance(point,.064)):envelope;
  const solvedFingers:RigidFingerSolution[]=[];
  const digits=HANDS.flatMap(hand=>FINGER_NAMES.map(finger=>({hand,finger,
    contact:constraints.find(c=>c.hand===hand&&c.finger===finger)})))
    .sort((a,b)=>(a.contact?.role==='support'?0:a.contact?1:2)-(b.contact?.role==='support'?0:b.contact?1:2));
  if(!buildingRest)for(const {hand,finger,contact} of digits)if(!contact&&isResting(pose,hand,finger)) {
    const source=restSolutions().find(s=>s.hand===hand&&s.finger===finger)!,q=new Quaternion().fromArray(pose[hand].rotation);
    const canonical=new Vector3((hand==='right'?1:-1)*.09,-.004,0);
    solvedFingers.push({...source,joints:source.joints.map(p=>a(v(p).sub(canonical).applyQuaternion(q).add(v(pose[hand].palm)))) as RigidFingerSolution['joints']});
  }
  for(const {hand,finger,contact} of digits) {
    if(solvedFingers.some(s=>s.hand===hand&&s.finger===finger))continue;
    const field=mountField(pose,{hand,finger},contact?.role==='support'?poseEnvelope(pose,frame,true,{hand,finger}):distance);
    const sign=hand==='right'?1:-1, h=pose[hand],tip=h.tips[finger];
    const q=new Quaternion().fromArray(h.rotation),base=FINGER_BASES[finger];
    const origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(v(h.palm));
    const end=v(tip.point),normal=v(tip.normal).normalize();
    let pole=new Vector3(sign*.092,{thumb:-.051,index:.089,middle:.029,ring:-.041,little:-.091}[finger],finger==='thumb'?.12:-.09)
      .applyQuaternion(q).add(v(h.palm));
    const previous=reference?.solutions.find(s=>s.hand===hand&&s.finger===finger);
    const deltaQ=reference?q.clone().multiply(new Quaternion().fromArray(reference.pose[hand].rotation).invert()):new Quaternion();
    if(previous)pole=v(previous.joints[1]).sub(v(previous.joints[0])).applyQuaternion(deltaQ).add(origin);
    let best:ReturnType<typeof twoLink>|undefined,bestDirection=normal,score=Infinity,bestGap=-Infinity;
    const obstacles:ObstacleLink[]=solvedFingers.flatMap(s=>s.joints.slice(0,3).map((p,i)=>({a:v(p),b:v(s.joints[i+1])})));
    // Even a digit solved later owns its MCP joint already. Avoid that fixed
    // bearing rather than allowing an earlier finger to cut through its base.
    for(const otherHand of HANDS)for(const otherFinger of FINGER_NAMES) {
      if(otherHand===hand&&otherFinger===finger)continue;
      const oh=pose[otherHand],os=otherHand==='right'?1:-1,ob=FINGER_BASES[otherFinger];
      const point=new Vector3(os*ob[0],ob[1],ob[2]).applyQuaternion(new Quaternion().fromArray(oh.rotation)).add(v(oh.palm));
      obstacles.push({a:point,b:point});
      if(constraints.some(c=>c.hand===otherHand&&c.finger===otherFinger)||isResting(pose,otherHand,otherFinger)) {
        const tipPoint=v(oh.tips[otherFinger].point);obstacles.push({a:tipPoint,b:tipPoint});
      }
    }
    for(const obstacle of obstacles){obstacle.center=obstacle.a.clone().add(obstacle.b).multiplyScalar(.5);obstacle.radius=obstacle.a.distanceTo(obstacle.b)*.5;}
    if(!contact)for(let pass=0;pass<6;pass++)for(const obstacle of obstacles) {
      const line=obstacle.b.clone().sub(obstacle.a),length=line.lengthSq();
      const closest=obstacle.a.clone().addScaledVector(line,length?Math.max(0,Math.min(1,end.clone().sub(obstacle.a).dot(line)/length)):0);
      const delta=end.clone().sub(closest),gap=delta.length();
      if(gap<.009) {
        if(gap<1e-8)delta.set(sign,0,0).applyQuaternion(q);else delta.divideScalar(gap);
        const proposed=closest.addScaledVector(delta,.009);
        if(field(proposed)>.0034)end.copy(proposed);
      }
    }
    const toward=origin.clone().sub(end).normalize();
    const tangent=toward.clone().addScaledVector(normal,-toward.dot(normal));
    if(tangent.lengthSq()<1e-10){const basis=Math.abs(normal.x)<.8?new Vector3(1,0,0):new Vector3(0,1,0);tangent.copy(basis).addScaledVector(normal,-basis.dot(normal));}
    tangent.normalize();const side=normal.clone().cross(tangent).normalize();
    const candidates:{direction:Vector3;tilt:number}[]=[];
    if(previous) {
      const direction=v(previous.joints[2]).sub(v(previous.joints[3])).applyQuaternion(deltaQ).normalize();
      if(!contact||contact.positionOnly||direction.dot(normal)>=.2)candidates.push({direction,tilt:0});
      if(!contact)for(const blend of [.15,.3,.5])candidates.push({direction:direction.clone().applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(direction,normal),blend)),tilt:blend*.1});
    }
    for(const tilt of [0,.45,.9,1.2])for(const spin of tilt===0?[0]:[-1,0,1]) {
      const direction=normal.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(tangent,Math.sin(tilt)*Math.cos(spin*.8))
        .addScaledVector(side,Math.sin(tilt)*Math.sin(spin*.8)).normalize();
      candidates.push({direction,tilt});
    }
    let expanded=false;
    for(let candidateIndex=0;candidateIndex<candidates.length;candidateIndex++) {
      const {direction,tilt}=candidates[candidateIndex];
      constrainDistalDirection(direction,contact,normal);
      const distal=end.clone().addScaledVector(direction,FINGER_LENGTHS[2]);
      const solved=twoLink(origin,distal,FINGER_LENGTHS[0],FINGER_LENGTHS[1],pole,true,end,obstacles,field);
      const gap=Math.min(solved.clearance,linkClearance(solved.target,end,.0026,field));
      const continuity=previous?solved.elbow.distanceTo(v(previous.joints[1]).sub(v(reference!.pose[hand].palm)).applyQuaternion(deltaQ).add(v(h.palm)))
        +solved.target.distanceTo(v(previous.joints[2]).sub(v(reference!.pose[hand].palm)).applyQuaternion(deltaQ).add(v(h.palm))):0;
      const cost=solved.error*1e5+Math.max(0,.0005-gap)*1e4+tilt*.002+continuity*.5;
      if(cost<score){score=cost;best=solved;bestDirection=direction;bestGap=gap;}
      if(previous&&solved.error<1e-7&&gap>.0005)break;
      if(candidateIndex===candidates.length-1&&!expanded&&!buildingRest&&contact&&origin.distanceTo(end)<.045&&(bestGap<.0005||best!.error>1e-7)) {
        expanded=true;
        // A close pad can only remain rigid by putting the DIP on the
        // far side of its tangent plane. The original inward-only fan missed
        // that entire legal half-space and folded the first two links back.
        for(const tilt of [.45,.9,1.2,1.35])for(const spin of [-Math.PI,-2.4,-1.6,0,1.6,2.4]) {
          const direction=normal.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(tangent,Math.sin(tilt)*Math.cos(spin))
            .addScaledVector(side,Math.sin(tilt)*Math.sin(spin)).normalize();
          candidates.push({direction,tilt});
        }
      }
    }
    const solved=best!;
    // A failed reach is visible to verification; never stretch the GLB links.
    const actualEnd=solved.target.clone().addScaledVector(bestDirection,-FINGER_LENGTHS[2]);
    solvedFingers.push({hand,finger,joints:[a(origin),a(solved.elbow),a(solved.target),a(actualEnd)] as RigidFingerSolution['joints'],
      reachError:actualEnd.distanceTo(end),minimumClearance:Math.min(solved.clearance,linkClearance(solved.target,actualEnd,.0026,field))});
  }
  return solvedFingers.sort((a,b)=>HANDS.indexOf(a.hand)-HANDS.indexOf(b.hand)||FINGER_NAMES.indexOf(a.finger)-FINGER_NAMES.indexOf(b.finger));
}
type BranchBias=[number,number,number];
class TrajectoryBendError extends Error {}
interface BranchTrack {times:number[];references:BranchReference[];biases:BranchBias[][];arms?:ArmTrajectoryData}
const branchTracks=new WeakMap<TeachingMotion,BranchTrack>();
function branchTrack(program:TeachingMotion):BranchTrack {
  const existing=branchTracks.get(program);if(existing)return existing;
  if(typeof window!=='undefined')throw new Error('本条指法轨迹尚未准备完成');
  if(program.authoringReference) {
    if(program.referenceEdit==='retirement-yield') {
      const reference=program.authoringReference,path=program.retirementYields?.[0];
      if(!path)throw new Error('收指让位缺少原始参考时轴');
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),added=path.end-path.referenceEnd;
        const zero=():BranchBias[]=>Array.from({length:10},()=>[0,0,0]);
        const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);};
        const at=(time:number):BranchReference=>{const frame=fitTeachingFrame(sampleTeachingMotion(reference,time));return {pose:frame.pose,solutions:structuredClone(solveTeachingPose(frame.pose,frame))};};
        const begin=at(path.start),owner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.finger),ringOwner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.yielding);
        const inverse=new Quaternion().fromArray(begin.pose[path.hand].rotation).invert(),ring=begin.solutions[ringOwner];
        const axis=v(ring.joints[1]).sub(v(ring.joints[0])).normalize().applyQuaternion(inverse),offset=v(ring.joints[3]).sub(v(ring.joints[0])).applyQuaternion(inverse);
        const distal=v(ring.joints[3]).sub(v(ring.joints[2])).applyQuaternion(inverse),liftAngle=Math.atan2(distal.z,distal.x);
        const targetX=offset.clone().applyAxisAngle(new Vector3(0,1,0),path.sidePocketYaw).x;let lo=0,hi=Math.PI/2;
        for(let i=0;i<60;i++){const angle=(lo+hi)/2;if(offset.clone().applyAxisAngle(axis,angle).x<targetX)lo=angle;else hi=angle;}
        const yieldAngle=(lo+hi)/2;
        const map=(time:number)=>time<path.start-1e-8?time:time<=path.referenceEnd+1e-8?path.yielded+time-path.start:time+added;
        const oldTime=(time:number)=>time<path.start?time:time<path.yielded?path.start:time<path.retired?path.start+time-path.yielded:time<path.end?path.referenceEnd:time-added;
        const list=[...base.times.map(map),path.start,path.lifted,path.yielded,path.retired,path.unturned,path.via,path.end];
        for(let time=path.start;time<path.end;time+=.005)list.push(time);
        const times=list.sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]>1e-8);
        const references=times.map(time=> {
          const source=at(oldTime(time)),frame=fitTeachingFrame(sampleTeachingMotion(program,time)),result={pose:frame.pose,solutions:structuredClone(source.solutions)};
          if(time>=path.start-1e-8&&time<=path.end+1e-8) {
            const lift=time<path.lifted?liftAngle*smooth((time-path.start)/(path.lifted-path.start)):liftAngle;
            const turn=time<path.lifted?0:time<path.yielded?yieldAngle*smooth((time-path.lifted)/(path.yielded-path.lifted)):time<path.retired?yieldAngle:time<path.unturned?yieldAngle*(1-smooth((time-path.retired)/(path.unturned-path.retired))):0;
            const finger=source.solutions[ringOwner],origin=v(finger.joints[0]),worldAxis=v(finger.joints[1]).sub(origin).normalize(),q=new Quaternion().setFromAxisAngle(worldAxis,turn);
            const points=finger.joints.map(point=>v(point).sub(origin).applyQuaternion(q).add(origin)),palmQ=new Quaternion().fromArray(frame.pose[path.hand].rotation),palmY=new Vector3(0,1,0).applyQuaternion(palmQ);
            points[3]=points[2].clone().add(v(finger.joints[3]).sub(v(finger.joints[2])).applyAxisAngle(palmY,lift).applyQuaternion(q));
            if(time>=path.unturned) {
              const outward=new Vector3(1,0,0).applyQuaternion(palmQ),via=v(path.distalReturnVia).normalize().applyQuaternion(palmQ),original=v(finger.joints[3]).sub(v(finger.joints[2])).normalize();
              const from=time<=path.via?outward:via,to=time<=path.via?via:original,blend=time<=path.via?smooth((time-path.unturned)/(path.via-path.unturned)):smooth((time-path.via)/(path.end-path.via));
              const direction=from.clone().applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(from,to),blend));
              points[3]=points[2].clone().addScaledVector(direction,FINGER_LENGTHS[2]);
            }
            result.solutions[ringOwner]={...finger,joints:points.map(a) as RigidFingerSolution['joints']};
            if(time>=path.yielded&&time<=path.retired) {
              const guide:TeachingContact={hand:path.hand,finger:path.finger,role:'drive',rotating:false,positionOnly:true,normal:frame.pose[path.hand].tips[path.finger].normal,cubie:[0,0,0],local:[0,0,0]};
              result.solutions[owner]=interpolateBranch(frame.pose,source,source,0,zero(),[guide],owner)[0];
            }
          }
          return result;
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.end-1e-8)return zero();
          const index=base.times.findIndex(t=>Math.abs(t-oldTime(time))<1e-7);if(index<0)throw new Error('收指让位之外必须保留原参考关键帧');return structuredClone(base.biases[index]);
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='grip-recovery') {
      const reference=program.authoringReference,original=program.authoringAlternate,path=program.gripRecoveries?.[0];
      if(!original||!path)throw new Error('握姿回接缺少同次生成的两份参考');
      const track=withAuthoringMotionReference(reference,()=>withAuthoringMotionReference(original,()=> {
        const base=branchTrack(reference),model=branchTrack(original),added=path.entryDuration+path.exitDuration;
        const zero=():BranchBias[]=>Array.from({length:10},()=>[0,0,0]);
        const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
        const at=(p:TeachingMotion,time:number):BranchReference=> {
          const frame=fitTeachingFrame(sampleTeachingMotion(p,time));
          return {pose:frame.pose,solutions:structuredClone(solveTeachingPose(frame.pose,frame))};
        };
        const begin=at(reference,path.start),finish=at(reference,path.referenceEnd);
        const owner=begin.solutions.findIndex(f=>f.hand===path.supportHand&&f.finger===path.supportFinger);
        const core=(time:number):BranchReference=> {
          const frame=fitTeachingFrame(sampleTeachingMotion(reference,time)),source=at(original,path.originalStart+time-path.start);
          for(const hand of HANDS)if(v(frame.pose[hand].palm).distanceTo(v(source.pose[hand].palm))>1e-8)throw new Error('回接参考掌位置不一致');
          const weight=time<path.supportStart+path.supportDuration?smooth((time-path.supportStart)/path.supportDuration):time>path.supportRestore?smooth((path.referenceEnd-time)/(path.referenceEnd-path.supportRestore)):1;
          if(weight>0) {
            if(!frame.contacts.some(c=>c.hand===path.supportHand&&c.finger===path.supportFinger))throw new Error('承托指调整前必须真实接稳');
            const finger=source.solutions[owner],origin=v(finger.joints[0]),pad=v(finger.joints[3]),dip=pad.clone().addScaledVector(v(path.supportDirection).normalize(),FINGER_LENGTHS[2]);
            const axis=dip.clone().sub(origin),distance=axis.length();
            if(distance>FINGER_LENGTHS[0]+FINGER_LENGTHS[1]||distance<Math.abs(FINGER_LENGTHS[0]-FINGER_LENGTHS[1]))throw new Error('回接承托分支不可达');
            axis.normalize();const along=(FINGER_LENGTHS[0]**2-FINGER_LENGTHS[1]**2+distance*distance)/(2*distance);
            const radial=v(path.supportPole).addScaledVector(axis,-v(path.supportPole).dot(axis));
            if(radial.lengthSq()<1e-10)throw new Error('回接承托弯曲平面退化');
            const pip=origin.clone().addScaledVector(axis,along).addScaledVector(radial.normalize(),Math.sqrt(Math.max(0,FINGER_LENGTHS[0]**2-along*along)));
            const target:BranchReference={pose:source.pose,solutions:structuredClone(source.solutions)};
            target.solutions[owner]={...finger,joints:[a(origin),a(pip),a(dip),a(pad)]};
            source.solutions[owner]=interpolateBranch(frame.pose,source,target,weight,zero(),frame.contacts,owner)[0];
          }
          return {pose:frame.pose,solutions:source.solutions};
        };
        const prepared=core(path.start),finished=core(path.referenceEnd);
        const map=(t:number)=>t<path.start-1e-8?t:t>path.referenceEnd+1e-8?t+added:t+path.entryDuration;
        const list=[...base.times.map(map),path.start,path.ready,path.finished,path.end];
        for(const t of model.times)if(t>=path.originalStart&&t<=path.originalEnd)list.push(path.ready+t-path.originalStart);
        for(let t=path.start;t<path.end;t+=.005)list.push(t);
        const times=list.sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]>1e-8);
        const references=times.map(time=> {
          if(time<path.start-1e-8)return at(reference,time);
          if(time>path.end+1e-8)return at(reference,time-added);
          const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
          if(time<path.ready)return {pose:frame.pose,solutions:interpolateBranch(frame.pose,begin,prepared,smooth((time-path.start)/path.entryDuration),zero(),frame.contacts)};
          if(time<=path.finished)return {pose:frame.pose,solutions:core(Math.min(path.referenceEnd,time-path.entryDuration)).solutions};
          return {pose:frame.pose,solutions:interpolateBranch(frame.pose,finished,finish,smooth((time-path.finished)/path.exitDuration),zero(),frame.contacts)};
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.end-1e-8)return zero();
          const old=time<path.start?time:time-added,index=base.times.findIndex(t=>Math.abs(t-old)<1e-7);
          if(index<0)throw new Error('回接窗口外必须保留参考关键帧');return structuredClone(base.biases[index]);
        });
        return {times,references,biases};
      }));
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='relay-passage') {
      const reference=program.authoringReference,path=program.relayYields?.find(item=>item.referencePath),route=path?.referencePath;
      if(!path||!route||path.referenceEnd===undefined)throw new Error('接力外角通道缺少参考时轴');
      const referenceEnd=path.referenceEnd;
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),added=path.end-referenceEnd;
        const zero=():BranchBias[]=>Array.from({length:10},()=>[0,0,0]);
        const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
        const at=(time:number):BranchReference=>{const frame=fitTeachingFrame(sampleTeachingMotion(reference,time));return {pose:frame.pose,solutions:structuredClone(solveTeachingPose(frame.pose,frame))};};
        const begin=at(path.start),ringOwner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.finger),middleOwner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.incoming);
        const inverse=new Quaternion().fromArray(begin.pose[path.hand].rotation).invert();
        const local=begin.solutions[ringOwner].joints.map(point=>v(point).sub(v(begin.pose[path.hand].palm)).applyQuaternion(inverse));
        const axis=local[1].clone().sub(local[0]).normalize(),offset=local[3].clone().sub(local[0]);
        const targetX=offset.clone().applyAxisAngle(new Vector3(0,1,0),path.sidePocketYaw).x;let lo=-Math.PI/2,hi=0;
        for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(offset.clone().applyAxisAngle(axis,mid).x<targetX)lo=mid;else hi=mid;}
        const sideAngle=(lo+hi)/2,lastLink=local[3].clone().sub(local[2]),liftAngle=Math.atan2(lastLink.z,lastLink.x);
        const map=(time:number)=>time<path.start-1e-8?time:time<=referenceEnd+1e-8?path.yielded+time-path.start:time+added;
        const sourceTime=(time:number)=>time<path.start?time:time<path.yielded?path.start:time<path.arrived?path.start+time-path.yielded:time<path.end?referenceEnd:time-added;
        const list=[...base.times.map(map),path.start,path.lifted,path.yielded,path.arrived,path.refolded,path.end];
        for(let t=path.start;t<path.end;t+=.005)list.push(t);
        const times=list.sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]>1e-8);
        const references=times.map(time=> {
          const source=at(sourceTime(time)),frame=fitTeachingFrame(sampleTeachingMotion(program,time));
          const result={pose:frame.pose,solutions:structuredClone(source.solutions)};
          if(time>=path.start-1e-8&&time<=path.end+1e-8) {
            const lift=time<path.lifted?liftAngle*smooth((time-path.start)/.12):time<path.arrived?liftAngle:time<path.refolded?liftAngle*(1-smooth((time-path.arrived)/.12)):0;
            const turn=time<path.lifted?0:time<path.yielded?sideAngle*smooth((time-path.lifted)/.15):time<path.refolded?sideAngle:sideAngle*(1-smooth((time-path.refolded)/.15));
            const ring=result.solutions[ringOwner],origin=v(ring.joints[0]),axis=v(ring.joints[1]).sub(origin).normalize(),q=new Quaternion().setFromAxisAngle(axis,turn);
            const points=ring.joints.map(point=>v(point).sub(origin).applyQuaternion(q).add(origin));
            const palmY=new Vector3(0,1,0).applyQuaternion(new Quaternion().fromArray(frame.pose[path.hand].rotation));
            points[3]=points[2].clone().add(v(ring.joints[3]).sub(v(ring.joints[2])).applyAxisAngle(palmY,lift).applyQuaternion(q));
            result.solutions[ringOwner]={...ring,joints:points.map(a) as RigidFingerSolution['joints']};
            if(time>path.yielded&&time<path.arrived) {
              const u=(time-path.yielded)/(path.arrived-path.yielded),weight=u>route.cornerFrom?Math.sin(Math.PI*(u-route.cornerFrom)/(1-route.cornerFrom))**2:0;
              if(weight>1e-12) {
                const pose=structuredClone(frame.pose);pose[path.hand].tips[path.incoming].point=a(v(source.solutions[middleOwner].joints[3]).addScaledVector(v(route.cornerDirection),route.cornerAmplitude*weight));
                const guide:TeachingContact={hand:path.hand,finger:path.incoming,role:'drive',rotating:false,positionOnly:true,normal:pose[path.hand].tips[path.incoming].normal,cubie:[0,0,0],local:[0,0,0]};
                result.solutions[middleOwner]=interpolateBranch(pose,source,source,0,zero(),[guide],middleOwner)[0];
              }
            }
          }
          return result;
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.end-1e-8)return zero();
          const index=base.times.findIndex(t=>Math.abs(t-sourceTime(time))<1e-7);
          if(index<0)throw new Error('接力外角参考必须保留原后继关键帧');return structuredClone(base.biases[index]);
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='supported-relay') {
      const reference=program.authoringReference,path=program.supportedRelays?.[0];
      if(!path)throw new Error('承托接力缺少明确的参考时轴');
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),added=path.entryDuration+path.exitDuration+.54;
        const zero=():BranchBias[]=>Array.from({length:10},()=>[0,0,0]);
        const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
        const at=(time:number):BranchReference=>{const frame=fitTeachingFrame(sampleTeachingMotion(reference,time));return {pose:frame.pose,solutions:structuredClone(solveTeachingPose(frame.pose,frame))};};
        const supportBegin=at(path.start),supportEnd=at(path.referenceRestore),arrival=at(path.referencePrepareStart);
        const supportOwner=supportBegin.solutions.findIndex(s=>s.hand===path.supportHand&&s.finger===path.supportFinger);
        const ringOwner=arrival.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.yielding),middleOwner=arrival.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.incoming);
        const original=supportBegin.solutions[supportOwner],origin=v(original.joints[0]),pad=v(original.joints[3]);
        const distal=pad.clone().addScaledVector(v(path.supportDirection).normalize(),FINGER_LENGTHS[2]),axis=distal.clone().sub(origin),distance=axis.length();axis.normalize();
        if(distance<=Math.abs(FINGER_LENGTHS[0]-FINGER_LENGTHS[1])||distance>=FINGER_LENGTHS[0]+FINGER_LENGTHS[1])throw new Error('承托外角分支超出刚性骨长');
        const radial=v(path.supportPole).addScaledVector(axis,-v(path.supportPole).dot(axis));
        if(radial.lengthSq()<1e-8)throw new Error('承托外角分支方向退化');radial.normalize();
        const along=(FINGER_LENGTHS[0]**2-FINGER_LENGTHS[1]**2+distance**2)/(2*distance),radius=Math.sqrt(FINGER_LENGTHS[0]**2-along**2);
        const elbow=origin.clone().addScaledVector(axis,along).addScaledVector(radial,radius);
        const safe:RigidFingerSolution={...original,joints:[a(origin),a(elbow),a(distal),a(pad)],reachError:0};
        const safeReference=(source:BranchReference):BranchReference=>{
          if(v(source.solutions[supportOwner].joints[0]).distanceTo(origin)>1e-7||v(source.pose[path.supportHand].tips[path.supportFinger].point).distanceTo(pad)>1e-7)
            throw new Error('固定承托避让不能套用到移动的掌或接触点');
          const result=structuredClone(source);result.solutions[supportOwner]=structuredClone(safe);return result;
        };
        const prepared=safeReference(supportBegin),finished=safeReference(supportEnd);
        const inverse=new Quaternion().fromArray(arrival.pose[path.hand].rotation).invert();
        const ringLocal=arrival.solutions[ringOwner].joints.map(point=>v(point).sub(v(arrival.pose[path.hand].palm)).applyQuaternion(inverse));
        const ringAxis=ringLocal[1].clone().sub(ringLocal[0]).normalize(),offset=ringLocal[3].clone().sub(ringLocal[0]);
        const targetX=offset.clone().applyAxisAngle(new Vector3(0,1,0),path.sidePocketYaw).x;let lo=-Math.PI/2,hi=0;
        for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(offset.clone().applyAxisAngle(ringAxis,mid).x<targetX)lo=mid;else hi=mid;}
        const sideAngle=(lo+hi)/2,lastLink=ringLocal[3].clone().sub(ringLocal[2]),liftAngle=Math.atan2(lastLink.z,lastLink.x);
        const map=(time:number)=>time+(time>=path.start-1e-8?path.entryDuration:0)+(time>=path.referencePrepareStart-1e-8?.27:0)
          +(time>=path.referencePrepareEnd-1e-8?.27:0)+(time>=path.referenceRestore-1e-8?path.exitDuration:0);
        const sourceTime=(time:number)=>time<path.start?time:time<path.ready?path.start:time<path.yieldStart?time-path.entryDuration:
          time<path.yielded?path.referencePrepareStart:time<path.arrived?path.referencePrepareStart+time-path.yielded:
          time<path.restored?path.referencePrepareEnd:time<path.restore?time-path.entryDuration-.54:time<path.end?path.referenceRestore:time-added;
        const list=[...base.times.map(map),path.start,path.ready,path.yieldStart,path.lifted,path.yielded,path.arrived,path.refolded,path.restored,path.restore,path.end];
        for(const [from,to] of [[path.start,path.ready],[path.yieldStart,path.restored],[path.restore,path.end]])for(let t=from;t<to;t+=.005)list.push(t);
        const times=list.sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]>1e-8);
        const references=times.map(time=> {
          const oldTime=sourceTime(time),source=at(oldTime),frame=fitTeachingFrame(sampleTeachingMotion(program,time)),result={pose:frame.pose,solutions:structuredClone(source.solutions)};
          if(time>=path.start-1e-8&&time<=path.end+1e-8) {
            safeReference(source);
            if(time<path.ready)result.solutions[supportOwner]=interpolateBranch(frame.pose,supportBegin,prepared,smooth((time-path.start)/path.entryDuration),zero(),frame.contacts,supportOwner)[0];
            else if(time<=path.restore)result.solutions[supportOwner]=structuredClone(safe);
            else result.solutions[supportOwner]=interpolateBranch(frame.pose,finished,supportEnd,smooth((time-path.restore)/path.exitDuration),zero(),frame.contacts,supportOwner)[0];
          }
          if(time>=path.yieldStart-1e-8&&time<=path.restored+1e-8) {
            const lift=time<path.lifted?liftAngle*smooth((time-path.yieldStart)/.12):time<path.arrived?liftAngle:time<path.refolded?liftAngle*(1-smooth((time-path.arrived)/.12)):0;
            const turn=time<path.lifted?0:time<path.yielded?sideAngle*smooth((time-path.lifted)/.15):time<path.refolded?sideAngle:sideAngle*(1-smooth((time-path.refolded)/.15));
            const ring=result.solutions[ringOwner],start=v(ring.joints[0]),axis=v(ring.joints[1]).sub(start).normalize(),q=new Quaternion().setFromAxisAngle(axis,turn);
            const points=ring.joints.map(point=>v(point).sub(start).applyQuaternion(q).add(start));
            const palmY=new Vector3(0,1,0).applyQuaternion(new Quaternion().fromArray(frame.pose[path.hand].rotation));
            points[3]=points[2].clone().add(v(ring.joints[3]).sub(v(ring.joints[2])).applyAxisAngle(palmY,lift).applyQuaternion(q));
            result.solutions[ringOwner]={...ring,joints:points.map(a) as RigidFingerSolution['joints']};
            if(time>path.yielded&&time<path.arrived) {
              const u=(time-path.yielded)/(path.arrived-path.yielded),weight=u>path.cornerFrom?Math.sin(Math.PI*(u-path.cornerFrom)/(1-path.cornerFrom))**2:0;
              if(weight>1e-12) {
                const pose=structuredClone(frame.pose);pose[path.hand].tips[path.incoming].point=a(v(source.solutions[middleOwner].joints[3]).addScaledVector(v(path.cornerDirection),path.cornerAmplitude*weight));
                const guide:TeachingContact={hand:path.hand,finger:path.incoming,role:'drive',rotating:false,positionOnly:true,normal:pose[path.hand].tips[path.incoming].normal,cubie:[0,0,0],local:[0,0,0]};
                result.solutions[middleOwner]=interpolateBranch(pose,source,source,0,zero(),[guide],middleOwner)[0];
              }
            }
          }
          return result;
        });
        const biases=times.slice(0,-1).map(time=> {
          if((time>=path.start-1e-8&&time<path.ready-1e-8)||(time>=path.yieldStart-1e-8&&time<path.restored-1e-8)||(time>=path.restore-1e-8&&time<path.end-1e-8))return zero();
          const oldTime=sourceTime(time),index=base.times.findIndex(t=>Math.abs(t-oldTime)<1e-7);
          if(index<0)throw new Error('接力参考外部时轴必须保留原关键帧');
          const result=structuredClone(base.biases[index]);if(time>=path.ready&&time<path.restore)result[supportOwner]=[0,0,0];return result;
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='grip-template') {
      const reference=program.authoringReference,path=program.gripTemplates?.[0];
      if(!path)throw new Error('整段握姿参考缺少来源与时轴');
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),added=path.entryDuration+path.exitDuration;
        const zero=():BranchBias[]=>Array.from({length:10},()=>[0,0,0]);
        const at=(time:number):BranchReference=> {
          const frame=fitTeachingFrame(sampleTeachingMotion(reference,time));
          return {pose:frame.pose,solutions:structuredClone(solveTeachingPose(frame.pose,frame))};
        };
        const originalStart=at(path.start),originalEnd=at(path.referenceEnd);
        const owners=path.roles.map(role=>originalStart.solutions.findIndex(s=>s.hand===role.hand&&s.finger===role.finger));
        const core=(time:number):BranchReference=> {
          const frame=fitTeachingFrame(sampleTeachingMotion(reference,time));
          const modelTime=path.templateStart+time-path.start,model=at(Math.min(path.templateEnd,modelTime));
          const result={pose:structuredClone(frame.pose),solutions:structuredClone(solveTeachingPose(frame.pose,frame))};
          const segment=reference.segments.slice().reverse().find(s=>s.start<=time)!;
          for(const owner of owners) {
            const {hand,finger}=result.solutions[owner],physical=frame.contacts.find(c=>c.hand===hand&&c.finger===finger);
            const target=result.pose[hand].tips[finger],modelTip=v(model.solutions[owner].joints[3]);
            if(physical) {
              if(modelTip.distanceTo(v(target.point))>1e-7)throw new Error('握姿参考不能改变当前真实接触点');
            } else {
              if(finger==='ring') {
                const progress=Math.max(0,Math.min(1,(time-segment.start)/segment.duration)),blend=progress*progress*(3-2*progress);
                const weight=time>=path.referenceEnd-1e-10?1:Math.abs(segment.start-path.start)<1e-8?1-blend:segment.step===path.sourceStep&&segment.phase==='handoff'?blend:0;
                modelTip.addScaledVector(v(result.pose[hand].palm).sub(v(model.pose[hand].palm)),weight);
              }
              target.point=a(modelTip);
            }
            const guide:TeachingContact=physical??{hand,finger,role:'drive',rotating:false,positionOnly:true,normal:target.normal,cubie:[0,0,0],local:[0,0,0]};
            result.solutions[owner]=interpolateBranch(result.pose,model,model,0,zero(),[guide],owner)[0];
          }
          return result;
        };
        const prepared=core(path.start),finished=core(path.referenceEnd);
        const map=(time:number)=>time<path.start-1e-8?time:time>path.referenceEnd+1e-8?time+added:time+path.entryDuration;
        const list=[...base.times.map(map),path.start,path.ready,path.finished,path.end];
        for(const time of base.times)if(time>=path.templateStart&&time<=path.templateEnd)list.push(path.ready+time-path.templateStart);
        // A template is reconstructed at the current MCP and pads. Bake the
        // resulting curve itself, including inherited interval corrections;
        // interpolating only the old endpoints would lose those corrections.
        for(let t=path.start;t<path.end;t+=.005)list.push(t);
        const times=list.sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]>1e-8);
        const references=times.map(time=> {
          if(time<path.start-1e-8)return at(time);
          if(time>path.end+1e-8)return at(time-added);
          const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
          if(time<path.ready) {
            const u=(time-path.start)/path.entryDuration;
            return {pose:frame.pose,solutions:interpolateBranch(frame.pose,originalStart,prepared,u*u*(3-2*u),zero(),frame.contacts)};
          }
          if(time<=path.finished) {
            const result=core(Math.min(path.referenceEnd,time-path.entryDuration));
            return {pose:frame.pose,solutions:result.solutions};
          }
          const u=(time-path.finished)/path.exitDuration;
          return {pose:frame.pose,solutions:interpolateBranch(frame.pose,finished,originalEnd,u*u*(3-2*u),zero(),frame.contacts)};
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.end-1e-8)return zero();
          const oldTime=time<path.start?time:time-added,index=base.times.findIndex(t=>Math.abs(t-oldTime)<1e-7);
          if(index<0)throw new Error('握姿参考外部时轴必须保留原关键帧');
          return structuredClone(base.biases[index]);
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='external-preform') {
      const reference=program.authoringReference,path=program.externalPreforms?.[0];
      if(!path)throw new Error('方外预成形缺少时轴映射');
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),first=base.times.findIndex(t=>Math.abs(t-path.start)<1e-7),last=base.times.findIndex(t=>Math.abs(t-path.referenceEnd)<1e-7);
        if(first<0||last<0)throw new Error('方外预成形原骨形边界不完整');
        const begin=base.references[first],finish=base.references[last],owner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.first),added=path.end-path.referenceEnd;
        const map=(t:number)=>t<path.start-1e-8?t:t>path.referenceEnd+1e-8?t+added:path.preformed+(t-path.start);
        const timeList=[...base.times.map(map),path.start,path.withdrawn,path.preformed,path.replayed,path.end];
        for(const [start,end] of [[path.start,path.withdrawn],[path.withdrawn,path.preformed],[path.replayed,path.end]])
          for(let i=1;i<6;i++)timeList.push(start+(end-start)*i/6);
        const times=timeList.sort((a,b)=>a-b).filter((t,i,list)=>i===0||t-list[i-1]>1e-8);
        const carry=(solution:RigidFingerSolution,from:TeachingPose,to:TeachingPose)=> {
          const hand=solution.hand,inverse=new Quaternion().fromArray(from[hand].rotation).invert(),q=new Quaternion().fromArray(to[hand].rotation);
          return {...solution,joints:solution.joints.map(point=>a(v(point).sub(v(from[hand].palm)).applyQuaternion(inverse).applyQuaternion(q).add(v(to[hand].palm)))) as RigidFingerSolution['joints']};
        };
        const references=times.map(time=> {
          const oldTime=time<path.start?time:time<path.preformed?path.start:time<=path.replayed?path.start+time-path.preformed:time<path.end?path.referenceEnd:time-added;
          const oldFrame=fitTeachingFrame(sampleTeachingMotion(reference,oldTime)),frame=fitTeachingFrame(sampleTeachingMotion(program,time)),solutions=structuredClone(solveTeachingPose(oldFrame.pose,oldFrame));
          if(time>=path.start-1e-8&&time<=path.end+1e-8) {
            for(let digit=0;digit<10;digit++)if(solutions[digit].hand===path.hand)solutions[digit]=carry(solutions[digit],oldFrame.pose,frame.pose);
            if(time>=path.withdrawn-1e-8&&time<path.preformed-1e-8) {
              const u=(time-path.withdrawn)/(path.preformed-path.withdrawn);
              solutions[owner]=interpolateBranch(frame.pose,begin,finish,u*u*(3-2*u),Array.from({length:10},()=>[0,0,0]),[],owner)[0];
            } else if(time>=path.preformed-1e-8)solutions[owner]=carry(finish.solutions[owner],finish.pose,frame.pose);
          }
          return {pose:frame.pose,solutions};
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.end-1e-8)return Array.from({length:10},():BranchBias=>[0,0,0]);
          const oldTime=time<path.start?time:time-added,index=base.times.findIndex(t=>Math.abs(t-oldTime)<1e-7);
          return structuredClone(base.biases[index]);
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='under-reception') {
      const reference=program.authoringReference,path=program.underReceptions?.[0];
      if(!path)throw new Error('下侧接收缺少时轴映射');
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),first=base.times.findIndex(t=>Math.abs(t-path.start)<1e-7),last=base.times.findIndex(t=>Math.abs(t-path.referenceEnd)<1e-7);
        if(first<0||last<0)throw new Error('下侧接收原骨形边界不完整');
        const begin=base.references[first],finish=base.references[last],owner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.finger),added=path.end-path.referenceEnd;
        const map=(t:number)=>t<path.start-1e-8?t:t>path.referenceEnd+1e-8?t+added:path.routeStart+(t-path.start)*(path.landed-path.routeStart)/(path.referenceEnd-path.start);
        const timeList=[...base.times.map(map),path.start,path.end,...path.breaks];
        for(let t=path.start;t<path.end;t+=.025)timeList.push(t);
        const times=timeList.sort((a,b)=>a-b).filter((t,i,list)=>i===0||t-list[i-1]>1e-8);
        const references=times.map(time=> {
          const oldTime=time<path.start?time:time<path.routeStart?path.start:time<=path.landed?path.start+(time-path.routeStart)*(path.referenceEnd-path.start)/(path.landed-path.routeStart):time<path.end?path.referenceEnd:time-added;
          const oldFrame=fitTeachingFrame(sampleTeachingMotion(reference,oldTime)),frame=fitTeachingFrame(sampleTeachingMotion(program,time));
          for(const hand of HANDS)if(v(frame.pose[hand].palm).distanceTo(v(oldFrame.pose[hand].palm))>1e-8
            ||1-Math.abs(new Quaternion().fromArray(frame.pose[hand].rotation).dot(new Quaternion().fromArray(oldFrame.pose[hand].rotation)))>1e-8)
            throw new Error('下侧接收不能移动原承托掌腕');
          const solutions=structuredClone(solveTeachingPose(oldFrame.pose,oldFrame));
          if(time>=path.start-1e-8&&time<=path.end+1e-8) {
            const t=Math.max(0,Math.min(1,(time-path.routeStart)/(path.landed-path.routeStart))),blend=t*t*(3-2*t);
            solutions[owner]=interpolateBranch(frame.pose,begin,finish,blend,Array.from({length:10},()=>[0,0,0]),trajectoryConstraints(frame),owner)[0];
          }
          return {pose:frame.pose,solutions};
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.end-1e-8)return Array.from({length:10},():BranchBias=>[0,0,0]);
          const oldTime=time<path.start?time:time-added,index=base.times.findIndex(t=>Math.abs(t-oldTime)<1e-7);
          return structuredClone(base.biases[index]);
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    if(program.referenceEdit==='preclearance') {
      const reference=program.authoringReference,path=program.preclearances?.[0];
      if(!path)throw new Error('前置让位缺少时轴映射');
      const track=withAuthoringMotionReference(reference,()=> {
        const base=branchTrack(reference),first=base.times.findIndex(t=>Math.abs(t-path.start)<1e-7),last=base.times.findIndex(t=>Math.abs(t-path.referenceEnd)<1e-7);
        if(first<0||last<0)throw new Error('前置让位缺少原骨形边界');
        const begin=base.references[first],finish=base.references[last],owner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.finger);
        const times=[...new Set([...base.times.map(t=>t<path.start-1e-8?t:t+path.duration),...Array.from({length:7},(_,i)=>path.start+path.duration*i/6)])].sort((a,b)=>a-b);
        const references=times.map(time=> {
          const oldTime=time<path.start?time:time<=path.cleared?path.start:time-path.duration;
          const oldIndex=base.times.findIndex(t=>Math.abs(t-oldTime)<1e-7),source=base.references[oldIndex];
          if(!source)throw new Error('前置让位不能重新采样原骨轨');
          const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
          for(const hand of HANDS)if(v(frame.pose[hand].palm).distanceTo(v(source.pose[hand].palm))>1e-8
            ||1-Math.abs(new Quaternion().fromArray(frame.pose[hand].rotation).dot(new Quaternion().fromArray(source.pose[hand].rotation)))>1e-8)
            throw new Error('前置让位不能改变参考掌腕轨迹');
          const result={pose:frame.pose,solutions:structuredClone(source.solutions)};
          if(time>=path.start-1e-8&&time<=path.end+1e-8) {
            const u=Math.max(0,Math.min(1,(time-path.start)/path.duration));
            result.solutions[owner]=interpolateBranch(frame.pose,begin,finish,u*u*(3-2*u),Array.from({length:10},()=>[0,0,0]),[],owner)[0];
          }
          return result;
        });
        const biases=times.slice(0,-1).map(time=> {
          if(time>=path.start-1e-8&&time<path.cleared-1e-8)return Array.from({length:10},():BranchBias=>[0,0,0]);
          const oldTime=time<path.start?time:time-path.duration,oldIndex=base.times.findIndex(t=>Math.abs(t-oldTime)<1e-7);
          return structuredClone(base.biases[oldIndex]);
        });
        return {times,references,biases};
      });
      branchTracks.set(program,track);return track;
    }
    const reference=program.authoringReference,paths=program.idleParking??[];
    if(paths.length!==1)throw new Error('参考时轴目前只允许一个明确暂置区间');
    const path=paths[0],oldEnd=path.start+path.referenceDuration,added=path.duration-path.referenceDuration;
    const map=(time:number)=>time<=path.start?time:time<oldEnd?path.start+(time-path.start)*path.duration/path.referenceDuration:time+added;
    const track=withAuthoringMotionReference(reference,()=> {
      const base=branchTrack(reference),times=base.times.map(map);
      const references=base.references.map((source,i)=> {
        const frame=fitTeachingFrame(sampleTeachingMotion(program,times[i]));
        for(const hand of HANDS)if(v(source.pose[hand].palm).distanceTo(v(frame.pose[hand].palm))>1e-8
          ||1-Math.abs(new Quaternion().fromArray(source.pose[hand].rotation).dot(new Quaternion().fromArray(frame.pose[hand].rotation)))>1e-8)
          throw new Error('闲指暂置不能改变参考掌腕轨迹');
        return {pose:frame.pose,solutions:structuredClone(source.solutions)};
      });
      applyIdleParking(program,times,references);
      applyJointReceptions(program,times,references);
      return {times,references,biases:structuredClone(base.biases)};
    });
    branchTracks.set(program,track);return track;
  }
  const times=[...new Set([0,program.duration,...program.segments.flatMap(s=>[0,.5].map(t=>s.start+s.duration*t))])].sort((a,b)=>a-b);
  const nodeFrame=(time:number)=> {
    const frame=sampleTeachingMotion(program,time);
    frame.contacts=[...frame.contacts];
    const neighbours=[Math.max(0,time-1e-7),Math.min(program.duration,time+1e-7)].flatMap(t=>sampleTeachingMotion(program,t).contacts);
    for(const contact of neighbours)if(!frame.contacts.some(c=>c.hand===contact.hand&&c.finger===contact.finger))frame.contacts.push(contact);
    return fitTeachingFrame(frame);
  };
  const references:BranchReference[]=[];
  const zero=():BranchBias[]=>Array.from({length:10},()=>[0,0,0]);
  for(const time of times) {
    const frame=nodeFrame(time);
    references.push({pose:frame.pose,solutions:solvePoseWithBranch(frame.pose,frame,references.at(-1))});
  }
  const plannedFreeKeys=new WeakMap<BranchReference,Set<number>>();
  // Choose the homotopy of each complete release-to-next-contact travel
  // before local corrections. Independent midpoint IK may otherwise send a
  // free digit behind the palm and then back around its front in a few ms.
  const planFreeTravel=(only?:TeachingFinger)=>{
  for(let finger=0;finger<10;finger++) {
    const owner=references[0].solutions[finger];if(only&&owner.finger!==only)continue;
    const intervals=times.slice(0,-1).map((time,index)=> {
      const frame=sampleTeachingMotion(program,(time+times[index+1])*.5);
      const restBefore=isResting(references[index].pose,owner.hand,owner.finger),restAfter=isResting(references[index+1].pose,owner.hand,owner.finger);
      return !(restBefore&&restAfter)&&!trajectoryConstraints(frame).some(c=>c.hand===owner.hand&&c.finger===owner.finger);
    });
    for(let first=0;first<intervals.length;) {
      if(!intervals[first]){first++;continue;}
      const waypoint=(time:number)=>program.segments.some((segment,index)=> {
        if(Math.abs(time-segment.start-segment.duration)>1e-7)return false;
        const relevant=program.steps[segment.step].move.kind==='wide'||program.steps[segment.step].driver.finger==='ring';
        if(!relevant)return false;
        if(segment.phase==='prepare'&&segment.to[owner.hand].tips[owner.finger].resting&&!segment.from[owner.hand].tips[owner.finger].resting)return true;
        if(segment.phase!=='release')return false;
        const drive=program.segments[index-1];
        return drive?.phase==='drive'&&drive.contacts.some(c=>c.hand===owner.hand&&c.finger===owner.finger&&c.role==='drive');
      });
      let last=first+1;while(last<intervals.length&&intervals[last]&&!waypoint(times[last]))last++;
      if(last-first<2||references.slice(first,last+1).every(ref=>isResting(ref.pose,owner.hand,owner.finger))){first=last;continue;}
      const begin=references[first],finish=references[last],startTime=times[first],endTime=times[last];
      const detailedFree=owner.finger==='ring'||(owner.finger==='middle'&&program.steps.some(s=>s.move.kind==='wide'||s.move.face==='D'));
      const ringSamples=detailedFree?Array.from({length:Math.ceil((endTime-startTime)/.01)+1},(_,i)=>Math.min(endTime,startTime+i*.01)):[];
      const sampleTimes=[...new Set([...times.slice(first,last+1).flatMap((time,j)=>j===last-first?[time]:[time,(time+times[first+j+1])*.5]),...ringSamples])].sort((a,b)=>a-b);
      const samples=sampleTimes.map(time=> {
        const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
        const beyond=times.findIndex(t=>t>time);
        const i=Math.min(last-1,Math.max(first,(beyond<0?times.length:beyond)-1));
        const others=interpolateBranch(frame.pose,references[i],references[i+1],(time-times[i])/(times[i+1]-times[i]),zero(),trajectoryConstraints(frame)).filter((_,j)=>j!==finger);
        return {time,index:i,blend:(time-times[i])/(times[i+1]-times[i]),frame,others,field:poseEnvelope(frame.pose,frame)};
      });
      const middleTime=(startTime+endTime)*.5,middleFrame=fitTeachingFrame(sampleTeachingMotion(program,middleTime));
      const middleSolution=interpolateBranch(middleFrame.pose,begin,finish,.5,zero(),[],finger)[0];
      const middleReference={pose:middleFrame.pose,solutions:begin.solutions.map((s,i)=>i===finger?middleSolution:s)};
      type FreeRoute={middle?:BranchReference};
      const candidates:FreeRoute[]=[{}];
      for(const bend of [-1.2,-.6,0,.6,1.2])for(const flex of [-.8,0,.8]) {
        if(!bend&&!flex)continue;
        const biases=zero();biases[finger]=[bend,flex,0];
        const solution=interpolateBranch(middleFrame.pose,middleReference,middleReference,.5,biases,[],finger)[0];
        candidates.push({middle:{pose:middleFrame.pose,solutions:begin.solutions.map((s,i)=>i===finger?solution:s)}});
      }
      // Keep the beginning/ending fold while turning its MCP toward the
      // opposite endpoint. This supplies a compact route around the palm
      // rather than extending all links during a direction interpolation.
      for(const [shape,target] of [[begin,finish],[finish,begin]]) {
        const source=shape.solutions[finger],targetFinger=target.solutions[finger];
        const sourceInverse=new Quaternion().fromArray(shape.pose[owner.hand].rotation).invert();
        const targetInverse=new Quaternion().fromArray(target.pose[owner.hand].rotation).invert();
        const sourceAxis=v(source.joints[1]).sub(v(source.joints[0])).normalize().applyQuaternion(sourceInverse);
        const targetAxis=v(targetFinger.joints[1]).sub(v(targetFinger.joints[0])).normalize().applyQuaternion(targetInverse);
        const turn=new Quaternion().setFromUnitVectors(sourceAxis,targetAxis),q=new Quaternion().fromArray(middleFrame.pose[owner.hand].rotation);
        for(const fraction of [.5,1])for(const roll of [-.6,0,.6]) {
          const rotation=new Quaternion().slerp(turn,fraction),axis=sourceAxis.clone().applyQuaternion(rotation);
          const origin=v(middleSolution.joints[0]),points=[origin];
          for(let link=0;link<3;link++) {
            const direction=v(source.joints[link+1]).sub(v(source.joints[link])).normalize().applyQuaternion(sourceInverse)
              .applyQuaternion(rotation).applyAxisAngle(axis,roll).applyQuaternion(q);
            points.push(points.at(-1)!.clone().addScaledVector(direction,FINGER_LENGTHS[link]));
          }
          const solution={...source,joints:points.map(a) as RigidFingerSolution['joints'],reachError:0};
          candidates.push({middle:{pose:middleFrame.pose,solutions:begin.solutions.map((s,i)=>i===finger?solution:s)}});
        }
      }
      // A compact departure can pass behind the palm before it unfolds.
      // Endpoint-to-endpoint MCP arcs alone have no such homotopy and can
      // sweep across the little finger or the fixed wrist coupler.
      if(detailedFree)for(const shape of [begin,finish]) {
        const source=shape.solutions[finger],inverse=new Quaternion().fromArray(shape.pose[owner.hand].rotation).invert();
        const first=v(source.joints[1]).sub(v(source.joints[0])).normalize().applyQuaternion(inverse);
        const q=new Quaternion().fromArray(middleFrame.pose[owner.hand].rotation),origin=v(middleSolution.joints[0]),sign=owner.hand==='right'?1:-1;
        for(const x of [0,sign*.6,-sign*.6])for(const y of [-.5,0,.5])for(const roll of [-.6,0,.6]) {
          const axis=new Vector3(x,y,-1).normalize(),rotation=new Quaternion().setFromUnitVectors(first,axis),points=[origin];
          for(let link=0;link<3;link++) {
            const direction=v(source.joints[link+1]).sub(v(source.joints[link])).normalize().applyQuaternion(inverse)
              .applyQuaternion(rotation).applyAxisAngle(axis,roll).applyQuaternion(q);
            points.push(points.at(-1)!.clone().addScaledVector(direction,FINGER_LENGTHS[link]));
          }
          const solution={...source,joints:points.map(a) as RigidFingerSolution['joints'],reachError:0};
          candidates.push({middle:{pose:middleFrame.pose,solutions:begin.solutions.map((s,i)=>i===finger?solution:s)}});
        }
      }
      const routeSample=(route:FreeRoute,time:number,pose:TeachingPose)=> {
        const blend=(time-startTime)/(endTime-startTime);
        return route.middle?(blend<.5?interpolateBranch(pose,begin,route.middle,blend*2,zero(),[],finger)[0]
          :interpolateBranch(pose,route.middle,finish,(blend-.5)*2,zero(),[],finger)[0])
          :interpolateBranch(pose,begin,finish,blend,zero(),[],finger)[0];
      };
      let bestRoute:FreeRoute|undefined,bestCost=Infinity,bestGap=-Infinity;
      const evaluateRoute=(route:FreeRoute)=> {
        let collision=0,travel=0,minimum=Infinity,prior:RigidFingerSolution|undefined;
        // A sampled relative-rotation path is not necessarily associative:
        // evaluate the exact piecewise representation that will be exported,
        // rather than the ideal end-to-end candidate before it is sampled.
        const actualNodes=detailedFree?new Map(Array.from({length:last-first+1},(_,j)=> {
          const index=first+j,solution=index===first?begin.solutions[finger]:index===last?finish.solutions[finger]:routeSample(route,times[index],references[index].pose);
          return [index,{pose:references[index].pose,solutions:references[index].solutions.map((s,k)=>k===finger?solution:s)}] as const;
        })):undefined;
        for(const sample of samples) {
          const solution=actualNodes?interpolateBranch(sample.frame.pose,actualNodes.get(sample.index)!,actualNodes.get(sample.index+1)!,sample.blend,zero(),[],finger)[0]
            :routeSample(route,sample.time,sample.frame.pose);
          const gap=trajectoryClearance(solution,sample.others,sample.field,false,sample.frame.pose);
          collision+=Math.max(0,.0008-gap)*1e5;minimum=Math.min(minimum,gap);
          if(prior)for(const joint of [1,2,3])travel+=v(solution.joints[joint]).distanceTo(v(prior.joints[joint]));
          prior=solution;
        }
        const cost=(detailedFree?Math.max(0,.0008-minimum)*1e6:collision)+travel*30;
        if(cost<bestCost){bestCost=cost;bestRoute=route;bestGap=minimum;}
      };
      for(const route of candidates)evaluateRoute(route);
      // Calibrate the whole travel's compact intermediate pose, rather than
      // inserting a fast corrective bend in a few-millisecond subinterval.
      if(detailedFree&&bestGap<-.0001)for(const magnitude of [.2,.07,.02]) {
        const reference=bestRoute!.middle??middleReference,source=reference.solutions[finger],origin=v(source.joints[0]);
        const q=new Quaternion().fromArray(reference.pose[owner.hand].rotation);
        for(const axis of [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)])for(const sign of [-1,1]) {
          const rotation=new Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(q),sign*magnitude);
          const solution={...source,joints:source.joints.map(point=>a(v(point).sub(origin).applyQuaternion(rotation).add(origin))) as RigidFingerSolution['joints']};
          evaluateRoute({middle:{pose:reference.pose,solutions:reference.solutions.map((item,index)=>index===finger?solution:item)}});
        }
      }
      for(let index=first+1;index<last;index++){references[index].solutions[finger]=routeSample(bestRoute!,times[index],references[index].pose);const planned=plannedFreeKeys.get(references[index])??new Set<number>();planned.add(finger);plannedFreeKeys.set(references[index],planned);}
      first=last;
    }
  }
  };
  planFreeTravel();
  const at=(index:number,time:number)=> {
    const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
    const left=references[index],right=references[index+1];
    return {frame,solutions:interpolateBranch(frame.pose,left,right,(time-times[index])/(times[index+1]-times[index]),zero(),trajectoryConstraints(frame))};
  };
  for(let round=0;round<10;round++) {
    for(const index of Array.from({length:times.length},(_,i)=>round%2?times.length-1-i:i)) {
      const current=references[index],frame=nodeFrame(times[index]);
      const neighbours=[index-1,index].filter(j=>j>=0&&j<times.length-1);
      const samples=neighbours.flatMap(j=>[.25,.5,.75].map(blend=> {
        const time=times[j]+(times[j+1]-times[j])*blend,data=at(j,time);
        return {...data,index:j,blend,field:poseEnvelope(data.frame.pose,data.frame)};
      }));
      samples.push({frame,solutions:current.solutions,index,blend:0,field:poseEnvelope(frame.pose,frame)});
      for(let finger=0;finger<10;finger++) {
        const owner=current.solutions[finger];
        if(!plannedFreeKeys.get(current)?.has(finger)&&!trajectoryConstraints(frame).some(c=>c.hand===owner.hand&&c.finger===owner.finger)&&isResting(current.pose,owner.hand,owner.finger))continue;
        let best=owner,bestCost=Infinity;
        const previous=index>0?references[index-1]:current,next=index<times.length-1?references[index+1]:current;
        let middle=owner;
        if(index>0&&index<times.length-1)try {middle=interpolateBranch(current.pose,previous,next,(times[index]-times[index-1])/(times[index+1]-times[index-1]),zero(),trajectoryConstraints(frame),finger)[0];}
        catch(error){if(!(error instanceof TrajectoryBendError))throw error;}
        const candidates=[owner,middle];
        for(const adjust of [[-.4,0,0],[.4,0,0],[-1.2,0,0],[1.2,0,0],[-2.4,0,0],[2.4,0,0],[0,-.6,0],[0,.6,0],[0,0,-.6],[0,0,.6]] as BranchBias[]) {
          const biases=zero();biases[finger]=adjust;
          candidates.push(interpolateBranch(current.pose,current,current,.5,biases,trajectoryConstraints(frame),finger)[0]);
        }
        const currentGap=Math.min(...samples.map(sample=>trajectoryClearance(sample.solutions[finger],sample.solutions.filter((_,i)=>i!==finger),sample.field,sample.frame.contacts.some(c=>c.hand===owner.hand&&c.finger===owner.finger),sample.frame.pose)));
        if(currentGap>.0008&&!trajectoryConstraints(frame).some(c=>c.hand===owner.hand&&c.finger===owner.finger))continue;
        if(currentGap<.0003&&!trajectoryConstraints(frame).some(c=>c.hand===owner.hand&&c.finger===owner.finger)) {
          const origin=v(owner.joints[0]),palmRotation=new Quaternion().fromArray(current.pose[owner.hand].rotation);
          for(const localAxis of [new Vector3(0,1,0),new Vector3(0,0,1)])for(const angle of [-.2,.2]) {
            const turn=new Quaternion().setFromAxisAngle(localAxis.clone().applyQuaternion(palmRotation),angle);
            candidates.push({...owner,joints:owner.joints.map(point=>a(v(point).sub(origin).applyQuaternion(turn).add(origin))) as RigidFingerSolution['joints']});
          }
        }
        if(currentGap<.0003)for(const bend of [-.8,0,.8])for(const flex of [-1.2,0,1.2])for(const distal of [-1.2,0,1.2]) {
          if(!bend&&!flex&&!distal)continue;
          const biases=zero();biases[finger]=[bend,flex,distal];
          candidates.push(interpolateBranch(current.pose,current,current,.5,biases,trajectoryConstraints(frame),finger)[0]);
        }
        for(const candidate of candidates) {
          const replacement={...current,solutions:current.solutions.map((solution,i)=>i===finger?candidate:solution)};
          let gap=Infinity,error=0;
          for(const sample of samples) {
            const solution=sample.frame.time===times[index]?candidate:interpolateBranch(sample.frame.pose,
              sample.index===index?replacement:references[sample.index],sample.index+1===index?replacement:references[sample.index+1],sample.blend,zero(),trajectoryConstraints(sample.frame),finger)[0];
            gap=Math.min(gap,trajectoryClearance(solution,sample.solutions.filter((_,i)=>i!==finger),sample.frame.contacts.some(c=>c.hand===solution.hand&&c.finger===solution.finger&&c.role==='support')?poseEnvelope(sample.frame.pose,sample.frame,true,solution):sample.field,sample.frame.contacts.some(c=>c.hand===solution.hand&&c.finger===solution.finger),sample.frame.pose));
            error=Math.max(error,solution.reachError);
          }
          let travel=0;
          for(const joint of [1,2,3])travel+=v(candidate.joints[joint]).distanceTo(v(previous.solutions[finger].joints[joint]))+v(candidate.joints[joint]).distanceTo(v(next.solutions[finger].joints[joint]));
          const cost=Math.max(0,.0008-gap)*1e5+error*1e6+travel*30;
          if(cost<bestCost){best=candidate;bestCost=cost;}
        }
        current.solutions[finger]=best;
        for(const sample of samples)sample.solutions[finger]=sample.frame.time===times[index]?best:interpolateBranch(sample.frame.pose,references[sample.index],references[sample.index+1],sample.blend,zero(),trajectoryConstraints(sample.frame),finger)[0];
      }
    }
    if(round===4)for(let index=times.length-2;index>=0;index--) {
      if(times[index+1]-times[index]<.08)continue;
      const samples=[.25,.5,.75].map(blend=>at(index,times[index]+(times[index+1]-times[index])*blend));
      const gap=Math.min(...samples.flatMap(sample=>sample.solutions.map((solution,i)=>trajectoryClearance(solution,sample.solutions.filter((_,j)=>j!==i),poseEnvelope(sample.frame.pose,sample.frame),sample.frame.contacts.some(c=>c.hand===solution.hand&&c.finger===solution.finger),sample.frame.pose))));
      if(gap<-.0001) {
        const sample=samples[1];times.splice(index+1,0,sample.frame.time!);references.splice(index+1,0,{pose:sample.frame.pose,solutions:sample.solutions});
      }
    }
  }
  // Final free-ring routing uses the already-fixed contact endpoints and the
  // actual surrounding fingers. Later local node edits must not undo it.
  planFreeTravel('ring');
  if(program.steps.some(step=>step.move.kind==='wide'||step.move.face==='D'))planFreeTravel('middle');
  // Whole-span routes settle the large motion first. Refine only existing
  // free keys with small rigid MCP rotations; never add a short pulse or pick
  // a new IK branch here. Check the actual exported interpolation on both
  // adjoining intervals, including their endpoints, at at most five ms.
  for(let index=1;index<times.length-1;index++) {
    const current=references[index],frame=nodeFrame(times[index]),constraints=trajectoryConstraints(frame);
    const free=current.solutions.map((owner,finger)=>({owner,finger})).filter(({owner})=>
      !constraints.some(c=>c.hand===owner.hand&&c.finger===owner.finger)&&!isResting(current.pose,owner.hand,owner.finger));
    if(!free.length)continue;
    const samples=[index-1,index].flatMap(j=> {
      const count=Math.ceil((times[j+1]-times[j])/.005);
      return Array.from({length:count+1},(_,n)=> {
        const blend=n/count,time=times[j]+(times[j+1]-times[j])*blend,data=at(j,time);
        return {...data,index:j,blend,field:poseEnvelope(data.frame.pose,data.frame)};
      });
    });
    for(const {owner,finger} of free) {
      const gapOf=(sample:typeof samples[number],solution:RigidFingerSolution)=>trajectoryClearance(solution,
        sample.solutions.filter((_,i)=>i!==finger),sample.field,false,sample.frame.pose);
      if(Math.min(...samples.map(sample=>gapOf(sample,sample.solutions[finger])))>.0008)continue;
      const origin=v(owner.joints[0]),q=new Quaternion().fromArray(current.pose[owner.hand].rotation),candidates=[owner];
      for(const axis of [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)])for(const angle of [-.1,-.05,.05,.1]) {
        const turn=new Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(q),angle);
        candidates.push({...owner,joints:owner.joints.map(point=>a(v(point).sub(origin).applyQuaternion(turn).add(origin))) as RigidFingerSolution['joints']});
      }
      let best=owner,bestCost=Infinity;
      for(const candidate of candidates) {
        const replacement={...current,solutions:current.solutions.map((item,j)=>j===finger?candidate:item)};
        let gap=Infinity,travel=0;
        for(const sample of samples) {
          const solution=interpolateBranch(sample.frame.pose,sample.index===index?replacement:references[sample.index],
            sample.index+1===index?replacement:references[sample.index+1],sample.blend,zero(),trajectoryConstraints(sample.frame),finger)[0];
          gap=Math.min(gap,gapOf(sample,solution));
        }
        for(const joint of [1,2,3])travel+=v(candidate.joints[joint]).distanceTo(v(references[index-1].solutions[finger].joints[joint]))
          +v(candidate.joints[joint]).distanceTo(v(references[index+1].solutions[finger].joints[joint]));
        const cost=Math.max(0,.0008-gap)*1e5+travel*30;
        if(cost<bestCost){best=candidate;bestCost=cost;}
      }
      current.solutions[finger]=best;
      for(const sample of samples)sample.solutions[finger]=interpolateBranch(sample.frame.pose,references[sample.index],references[sample.index+1],
        sample.blend,zero(),trajectoryConstraints(sample.frame),finger)[0];
    }
  }
  // An idle digit may wait for the active fingers to release before starting
  // its next authored approach. Preserve the already-authored boundary poses;
  // neither this waiting instruction nor its FK path supplies a contact.
  for(const wait of program.idleWaits??[]) {
    const first=times.findIndex(time=>Math.abs(time-wait.start)<1e-7);
    const last=times.findIndex(time=>Math.abs(time-wait.approachEnd)<1e-7);
    if(first<0||last<=first)throw new Error('闲置等待的动作边界不完整');
    const finger=references[first].solutions.findIndex(s=>s.hand===wait.hand&&s.finger===wait.finger);
    const begin=structuredClone(references[first]),finish=structuredClone(references[last]);
    const source=begin.solutions[finger],inverse=new Quaternion().fromArray(begin.pose[wait.hand].rotation).invert();
    for(let index=first+1;index<last;index++) {
      const time=times[index],pose=references[index].pose;
      if(time<=wait.end+1e-8) {
        const q=new Quaternion().fromArray(pose[wait.hand].rotation);
        references[index].solutions[finger]={...source,joints:source.joints.map(point=>a(v(point).sub(v(begin.pose[wait.hand].palm))
          .applyQuaternion(inverse).applyQuaternion(q).add(v(pose[wait.hand].palm)))) as RigidFingerSolution['joints']};
      } else {
        const t=(time-wait.end)/(wait.approachEnd-wait.end),blend=t*t*(3-2*t);
        references[index].solutions[finger]=interpolateBranch(pose,begin,finish,blend,zero(),[],finger)[0];
      }
    }
  }
  for(const reception of program.externalReceptions??[]) {
    const key=(time:number)=> {
      const index=times.findIndex(t=>Math.abs(t-time)<1e-7);
      if(index<0)throw new Error('外侧接收的动作边界不完整');
      return index;
    };
    const first=key(reception.waitStart),start=key(reception.start),last=key(reception.approachEnd);
    const waiting=structuredClone(references[first]),initial=structuredClone(references[start]),arrival=structuredClone(references[last]);
    const owner=initial.solutions.findIndex(f=>f.hand===reception.hand&&f.finger===reception.finger);
    const carry=(source:BranchReference,finger:number,pose:TeachingPose)=> {
      const original=source.solutions[finger],hand=original.hand;
      const inverse=new Quaternion().fromArray(source.pose[hand].rotation).invert(),q=new Quaternion().fromArray(pose[hand].rotation);
      return {...original,joints:original.joints.map(point=>a(v(point).sub(v(source.pose[hand].palm)).applyQuaternion(inverse)
        .applyQuaternion(q).add(v(pose[hand].palm)))) as RigidFingerSolution['joints'],reachError:0};
    };
    // First preserve the inactive index through the preceding wrist turn.
    // All other fingers still follow their own genuine drive/release phases.
    for(let index=first;index<=last;index++) {
      const time=times[index],reference=references[index],pose=reference.pose;
      if(time>=reception.start-1e-8&&time<=reception.returned+1e-8) {
        for(let digit=0;digit<10;digit++)if(reference.solutions[digit].hand===reception.hand)
          reference.solutions[digit]=carry(initial,digit,pose);
      }
      if(time<=reception.withdrawn+1e-8)reference.solutions[owner]=carry(waiting,owner,pose);
      else if(time<reception.unfolded-1e-8) {
        const t=(time-reception.withdrawn)/(reception.unfolded-reception.withdrawn),blend=t*t*(3-2*t);
        reference.solutions[owner]=interpolateBranch(pose,waiting,arrival,blend,zero(),[],owner)[0];
      } else reference.solutions[owner]=carry(arrival,owner,pose);
    }
  }
  for(const reception of program.cornerReceptions??[]) {
    const first=times.findIndex(t=>Math.abs(t-reception.start)<1e-7),last=times.findIndex(t=>Math.abs(t-reception.end)<1e-7);
    if(first<0||last<=first)throw new Error('外角接收的动作边界不完整');
    const begin=structuredClone(references[first]),finish=structuredClone(references[last]);
    const owner=begin.solutions.findIndex(s=>s.hand===reception.hand&&s.finger===reception.finger);
    for(let index=first+1;index<last;index++) {
      const frame=nodeFrame(times[index]),blend=(times[index]-reception.start)/(reception.end-reception.start);
      references[index].solutions[owner]=interpolateBranch(frame.pose,begin,finish,blend,zero(),trajectoryConstraints(frame),owner)[0];
    }
  }
  for(const path of program.relayYields??[]) {
    const key=(time:number)=> {const i=times.findIndex(t=>Math.abs(t-time)<1e-7);if(i<0)throw new Error('接力让位边界缺失');return i;};
    const first=key(path.start),arrival=key(path.arrived),last=key(path.end);
    const initial=structuredClone(references[first]),received=structuredClone(references[arrival]);
    const owner=initial.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.finger);
    const inverse=new Quaternion().fromArray(initial.pose[path.hand].rotation).invert();
    const local=initial.solutions[owner].joints.map(point=>v(point).sub(v(initial.pose[path.hand].palm)).applyQuaternion(inverse));
    const axis=local[1].clone().sub(local[0]).normalize(),offset=local[3].clone().sub(local[0]);
    const targetX=offset.clone().applyAxisAngle(new Vector3(0,1,0),path.sidePocketYaw).x;
    let lo=-Math.PI/2,hi=0;
    for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(offset.clone().applyAxisAngle(axis,mid).x<targetX)lo=mid;else hi=mid;}
    const sideAngle=(lo+hi)/2,distal=local[3].clone().sub(local[2]),liftAngle=Math.atan2(distal.z,distal.x);
    const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);};
    const carry=(source:BranchReference,pose:TeachingPose)=>source.solutions.map(solution=> {
      const old=source.pose[solution.hand],current=pose[solution.hand],inv=new Quaternion().fromArray(old.rotation).invert(),q=new Quaternion().fromArray(current.rotation);
      return {...solution,joints:solution.joints.map(point=>a(v(point).sub(v(old.palm)).applyQuaternion(inv).applyQuaternion(q).add(v(current.palm)))) as RigidFingerSolution['joints']};
    });
    for(let i=first;i<=last;i++) {
      const time=times[i],reference=references[i];
      // The inserted role phases hold every other digit, without claiming an
      // extra physical contact. Approach itself retains its authored path.
      if(time<=path.yielded+1e-8)reference.solutions=carry(initial,reference.pose);
      else if(time>=path.arrived-1e-8)reference.solutions=carry(received,reference.pose);
      const lift=time<path.lifted?liftAngle*smooth((time-path.start)/(path.lifted-path.start))
        :time<path.arrived?liftAngle:time<path.refolded?liftAngle*(1-smooth((time-path.arrived)/(path.refolded-path.arrived))):0;
      const angle=time<path.lifted?0:time<path.yielded?sideAngle*smooth((time-path.lifted)/(path.yielded-path.lifted))
        :time<path.refolded?sideAngle:sideAngle*(1-smooth((time-path.refolded)/(path.end-path.refolded)));
      const turn=new Quaternion().setFromAxisAngle(axis,angle),q=new Quaternion().fromArray(reference.pose[path.hand].rotation);
      const points=local.map(point=>point.clone().sub(local[0]).applyQuaternion(turn).add(local[0]));
      points[3]=points[2].clone().add(distal.clone().applyAxisAngle(new Vector3(0,1,0),lift).applyQuaternion(turn));
      reference.solutions[owner]={...initial.solutions[owner],joints:points.map(point=>a(point.applyQuaternion(q).add(v(reference.pose[path.hand].palm)))) as RigidFingerSolution['joints']};
    }
  }
  for(const path of program.supportClearances??[]) {
    const first=times.findIndex(t=>Math.abs(t-path.start)<1e-7),last=times.findIndex(t=>Math.abs(t-path.end)<1e-7);
    if(first<0||last<=first||path.face!=='F')throw new Error('承托净空边界不完整');
    const owner=references[first].solutions.findIndex(f=>f.hand===path.hand&&f.finger===path.finger);
    const initial=references[first].solutions[owner],pad=v(initial.joints[3]),offsetX=initial.joints[2][0]-pad.x,offsetY=path.distalHeight-pad.y;
    const square=FINGER_LENGTHS[2]**2-offsetX**2-offsetY**2;
    if(square<=0)throw new Error('承托远节方向不可达');
    const direction=new Vector3(offsetX,offsetY,Math.sqrt(square)).normalize();
    const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*u*(u*(u*6-15)+10);};
    for(let i=first;i<=last;i++) {
      const time=times[i],old=references[i].solutions[owner];
      const weight=time<path.ready?smooth((time-path.start)/(path.ready-path.start)):time<path.restore?1:1-smooth((time-path.restore)/(path.end-path.restore));
      const mcp=v(old.joints[0]),tip=v(old.joints[3]),oldAxis=v(old.joints[2]).sub(mcp).normalize(),oldDirection=v(old.joints[2]).sub(tip).normalize();
      const nextDirection=oldDirection.clone().applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(oldDirection,direction),weight));
      const dip=tip.clone().addScaledVector(nextDirection,FINGER_LENGTHS[2]),delta=dip.clone().sub(mcp),distance=delta.length();
      if(distance<=Math.abs(FINGER_LENGTHS[0]-FINGER_LENGTHS[1])||distance>=FINGER_LENGTHS[0]+FINGER_LENGTHS[1])throw new Error('承托避让不能拉伸指骨');
      const axis=delta.normalize(),radial=v(old.joints[1]).sub(mcp);
      radial.addScaledVector(oldAxis,-radial.dot(oldAxis)).normalize().applyQuaternion(new Quaternion().setFromUnitVectors(oldAxis,axis));
      const along=(FINGER_LENGTHS[0]**2-FINGER_LENGTHS[1]**2+distance**2)/(2*distance),radius=Math.sqrt(FINGER_LENGTHS[0]**2-along**2);
      const pip=mcp.clone().addScaledVector(axis,along).addScaledVector(radial,radius);
      references[i].solutions[owner]={...old,joints:[a(mcp),a(pip),a(dip),a(tip)],reachError:0};
    }
  }
  applyIdleParking(program,times,references);
  applyJointReceptions(program,times,references);
  const track={times,references,biases:Array.from({length:times.length-1},zero)};branchTracks.set(program,track);return track;
}
function applyIdleParking(program:TeachingMotion,times:number[],references:BranchReference[]) {
  for(const path of program.idleParking??[]) {
    const first=times.findIndex(t=>Math.abs(t-path.start)<1e-7);
    if(first<0)throw new Error('空闲暂置动作边界不完整');
    const initial=structuredClone(references[first]),owner=initial.solutions.findIndex(f=>f.hand===path.hand&&f.finger===path.finger);
    const inverse=new Quaternion().fromArray(initial.pose[path.hand].rotation).invert(),old=initial.solutions[owner];
    const from=old.joints.slice(0,3).map((point,j)=>a(v(old.joints[j+1]).sub(v(point)).normalize().applyQuaternion(inverse)));
    for(let i=first;i<times.length;i++) {
      const reference=references[i],u=Math.max(0,Math.min(1,(times[i]-path.start)/(path.end-path.start))),blend=u*u*(3-2*u);
      const directions=interpolateFingerDirections(from,path.directions,blend),h=reference.pose[path.hand],q=new Quaternion().fromArray(h.rotation),sign=path.hand==='right'?1:-1,base=FINGER_BASES[path.finger];
      const points=[new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(v(h.palm))];
      for(let j=0;j<3;j++)points.push(points[j].clone().addScaledVector(v(directions[j]).applyQuaternion(q),FINGER_LENGTHS[j]));
      reference.solutions[owner]={...old,joints:points.map(a) as RigidFingerSolution['joints'],reachError:0};
    }
  }
}
function applyJointReceptions(program:TeachingMotion,times:number[],references:BranchReference[]) {
  for(const path of program.jointReceptions??[]) {
    const first=times.findIndex(t=>Math.abs(t-path.start)<1e-7),last=times.findIndex(t=>Math.abs(t-path.end)<1e-7);
    if(first<0||last<=first)throw new Error('折形接收边界不完整');
    const begin=structuredClone(references[first]),finish=structuredClone(references[last]);
    const owner=begin.solutions.findIndex(s=>s.hand===path.hand&&s.finger===path.finger);
    const directions=(r:BranchReference)=> {
      const inverse=new Quaternion().fromArray(r.pose[path.hand].rotation).invert(),joints=r.solutions[owner].joints;
      return joints.slice(0,3).map((point,j)=>a(v(joints[j+1]).sub(v(point)).normalize().applyQuaternion(inverse)));
    };
    const from=directions(begin),to=directions(finish);
    for(let i=first+1;i<last;i++) {
      const u=(times[i]-path.start)/(path.end-path.start),ds=interpolateFingerDirections(from,to,u*u*(3-2*u)),q=new Quaternion().fromArray(references[i].pose[path.hand].rotation);
      const old=references[i].solutions[owner],points=[v(old.joints[0])];
      for(let j=0;j<3;j++)points.push(points[j].clone().addScaledVector(v(ds[j]).applyQuaternion(q),FINGER_LENGTHS[j]));
      references[i].solutions[owner]={...old,joints:points.map(a) as RigidFingerSolution['joints'],reachError:0};
    }
  }
}
interface TeachingTrajectoryData {version:number;signature:string;times:number[];directions:number[][];biases:BranchBias[][];arms:ArmTrajectoryData}
// Increase whenever playback interpretation or authoring parameters change.
const trajectoryRevision=95;
export function teachingTrajectorySignature(program:TeachingMotion) {
  // Identity is based on source moves and authored phase topology. Derived
  // trigonometric poses are deliberately excluded: Safari and V8 may differ
  // at floating-point tails without changing the choreography.
  const quantize=(value:number)=>Math.round(value*1e7)/1e7;
  const identity={revision:trajectoryRevision,formulaId:program.formulaId,initialState:program.initialState,
    steps:program.steps.map(step=>({move:step.move,group:step.group,driver:step.driver})),
    phases:program.segments.map(segment=>({step:segment.step,phase:segment.phase,duration:quantize(segment.duration),hand:segment.hand,finger:segment.finger,
      fromQuarter:Math.round(segment.angleFrom/(Math.PI/2)),toQuarter:Math.round(segment.angleTo/(Math.PI/2)),wristHands:segment.wristHands,regripHands:segment.regripHands,
      contacts:segment.contacts.map(contact=>({...contact,cubie:contact.cubie.map(Math.round),local:contact.local.map(quantize),normal:contact.normal.map(quantize)})),
      padGuides:segment.padGuides?.map(contact=>({...contact,cubie:contact.cubie.map(Math.round),local:contact.local.map(quantize),normal:contact.normal.map(quantize)}))})),
    finalContacts:program.finalContacts.map(contact=>({...contact,cubie:contact.cubie.map(Math.round),local:contact.local.map(quantize),normal:contact.normal.map(quantize)})),
    idleWaits:program.idleWaits?.map(wait=>({...wait,start:quantize(wait.start),end:quantize(wait.end),approachEnd:quantize(wait.approachEnd)})),
    externalReceptions:program.externalReceptions?.map(path=>({...path,distance:quantize(path.distance),waitStart:quantize(path.waitStart),start:quantize(path.start),
      withdrawn:quantize(path.withdrawn),unfolded:quantize(path.unfolded),returned:quantize(path.returned),approachEnd:quantize(path.approachEnd)})),
    flickTransitions:program.flickTransitions?.map(path=>({...path,departureClearance:quantize(path.departureClearance),releaseClearance:quantize(path.releaseClearance)})),
    cornerReceptions:program.cornerReceptions?.map(path=>({...path,clearance:quantize(path.clearance),start:quantize(path.start),corner:quantize(path.corner),outside:quantize(path.outside),end:quantize(path.end)})),
    relayYields:program.relayYields?.map(path=>({...path,referenceEnd:path.referenceEnd===undefined?undefined:quantize(path.referenceEnd),referencePath:path.referencePath?{...path.referencePath,cornerAmplitude:quantize(path.referencePath.cornerAmplitude),cornerDirection:path.referencePath.cornerDirection.map(quantize)}:undefined,sidePocketYaw:quantize(path.sidePocketYaw),start:quantize(path.start),lifted:quantize(path.lifted),yielded:quantize(path.yielded),arrived:quantize(path.arrived),refolded:quantize(path.refolded),end:quantize(path.end)})),
    supportClearances:program.supportClearances?.map(path=>({...path,distalHeight:quantize(path.distalHeight),start:quantize(path.start),ready:quantize(path.ready),restore:quantize(path.restore),end:quantize(path.end)})),
    idleParking:program.idleParking?.map(path=>({...path,referenceDuration:quantize(path.referenceDuration),directions:path.directions.map(direction=>direction.map(quantize)),duration:quantize(path.duration),start:quantize(path.start),end:quantize(path.end)})),
    jointReceptions:program.jointReceptions?.map(path=>({...path,start:quantize(path.start),end:quantize(path.end)})),
    preclearances:program.preclearances?.map(path=>({...path,duration:quantize(path.duration),start:quantize(path.start),cleared:quantize(path.cleared),end:quantize(path.end),referenceEnd:quantize(path.referenceEnd)})),
    underReceptions:program.underReceptions?.map(path=>({...path,points:path.points.map(p=>p.map(quantize)),normals:path.normals.map(p=>p.map(quantize)),breaks:path.breaks.map(quantize),start:quantize(path.start),routeStart:quantize(path.routeStart),landed:quantize(path.landed),end:quantize(path.end),referenceEnd:quantize(path.referenceEnd)})),
    quarterClearances:program.quarterClearances,
    retirementYields:program.retirementYields?.map(path=>({...path,sidePocketYaw:quantize(path.sidePocketYaw),distalReturnVia:path.distalReturnVia.map(quantize),start:quantize(path.start),lifted:quantize(path.lifted),yielded:quantize(path.yielded),retired:quantize(path.retired),unturned:quantize(path.unturned),via:quantize(path.via),end:quantize(path.end),referenceEnd:quantize(path.referenceEnd)})),
    gripRecoveries:program.gripRecoveries?.map(path=>({...path,supportDirection:path.supportDirection.map(quantize),supportPole:path.supportPole.map(quantize),
      returnStart:quantize(path.returnStart),returnEnd:quantize(path.returnEnd),start:quantize(path.start),ready:quantize(path.ready),finished:quantize(path.finished),end:quantize(path.end),referenceEnd:quantize(path.referenceEnd),originalStart:quantize(path.originalStart),originalEnd:quantize(path.originalEnd),supportStart:quantize(path.supportStart),supportRestore:quantize(path.supportRestore)})),
    supportedRelays:program.supportedRelays?.map(path=>({...path,supportDirection:path.supportDirection.map(quantize),supportPole:path.supportPole.map(quantize),
      cornerDirection:path.cornerDirection.map(quantize),sidePocketYaw:quantize(path.sidePocketYaw),cornerAmplitude:quantize(path.cornerAmplitude),
      start:quantize(path.start),ready:quantize(path.ready),yieldStart:quantize(path.yieldStart),lifted:quantize(path.lifted),yielded:quantize(path.yielded),arrived:quantize(path.arrived),refolded:quantize(path.refolded),restored:quantize(path.restored),restore:quantize(path.restore),end:quantize(path.end),
      referencePrepareStart:quantize(path.referencePrepareStart),referencePrepareEnd:quantize(path.referencePrepareEnd),referenceRestore:quantize(path.referenceRestore)})),
    gripTemplates:program.gripTemplates?.map(path=>({...path,entryDuration:quantize(path.entryDuration),exitDuration:quantize(path.exitDuration),
      start:quantize(path.start),ready:quantize(path.ready),finished:quantize(path.finished),end:quantize(path.end),referenceEnd:quantize(path.referenceEnd),templateStart:quantize(path.templateStart),templateEnd:quantize(path.templateEnd)})),
    externalPreforms:program.externalPreforms?.map(path=>({...path,distance:quantize(path.distance),start:quantize(path.start),withdrawn:quantize(path.withdrawn),preformed:quantize(path.preformed),replayed:quantize(path.replayed),end:quantize(path.end),referenceEnd:quantize(path.referenceEnd)})),
    rig:specification,arm:ARM_TRAJECTORY_PARAMETERS};
  const source=JSON.stringify(identity);
  let hash=2166136261;for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
  return (hash>>>0).toString(16);
}
function prepareAuthoredArms(program:TeachingMotion,track:BranchTrack) {
  if(track.arms)return track.arms;
  const times=[0,...program.segments.map(segment=>segment.start),program.duration].sort((a,b)=>a-b).filter((time,index,list)=>index===0||time-list[index-1]>1e-7);
  const arms=buildArmTrajectory({times,sample:time=> {
    const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
    return {pose:frame.pose,cubeShapes:frameCubeShapes(frame),fingers:solveTeachingPose(frame.pose,frame)};
  }});
  if(!arms.fingerObstacles)throw new Error('完整演示必须校验双手指节与机械臂');
  track.arms=arms;return arms;
}
/** Export cached offline stages for independent time-map verification. Never
 * computes a second authoring run, and never participates in browser playback. */
export function exportTeachingAuthoringReferences(program:TeachingMotion) {
  if(typeof window!=='undefined')throw new Error('浏览器不导出作者参考');
  const result=[];
  const pending=[program.authoringReference,program.authoringAlternate].filter((p):p is TeachingMotion=>!!p),seen=new Set<TeachingMotion>();
  for(const reference of pending) {
    if(seen.has(reference))continue;seen.add(reference);
    if(reference.authoringReference)pending.push(reference.authoringReference);
    if(reference.authoringAlternate)pending.push(reference.authoringAlternate);
    const track=branchTracks.get(reference);if(!track)throw new Error('参考轨迹必须由本次导出实际生成');
    const {authoringReference:_nested,authoringAlternate:_alternate,...source}=reference;
    const directions=track.references.map(r=>r.solutions.flatMap(solution=> {
      const inverse=new Quaternion().fromArray(r.pose[solution.hand].rotation).invert();
      return solution.joints.slice(0,3).flatMap((point,i)=>a(v(solution.joints[i+1]).sub(v(point)).normalize().applyQuaternion(inverse)));
    }));
    result.push({program:source,times:track.times,directions,biases:track.biases});
  }
  return result;
}
export function exportTeachingTrajectory(program:TeachingMotion):TeachingTrajectoryData {
  const track=branchTrack(program),arms=prepareAuthoredArms(program,track);
  const directions=track.references.map(reference=>reference.solutions.flatMap(solution=> {
    const inverse=new Quaternion().fromArray(reference.pose[solution.hand].rotation).invert();
    return solution.joints.slice(0,3).flatMap((point,i)=>a(v(solution.joints[i+1]).sub(v(point)).normalize().applyQuaternion(inverse)));
  }));
  return {version:trajectoryRevision,signature:teachingTrajectorySignature(program),times:track.times,directions,biases:track.biases,arms};
}
const trajectoryRequests=new Map<string,Promise<TeachingTrajectoryData>>();
export async function prepareTeachingTrajectory(program:TeachingMotion):Promise<void> {
  if(branchTracks.get(program)?.arms)return;
  const signature=teachingTrajectorySignature(program),key=`${program.formulaId}:${signature}`;
  let request=trajectoryRequests.get(key);
  if(!request) {
    request=(async()=> {
      const response=await fetch(`/motions/cfop/${encodeURIComponent(program.formulaId)}.json?v=${signature}`);
      if(!response.ok)throw new Error('本条指法轨迹未能加载，请刷新页面后重试');
      const data=await response.json() as TeachingTrajectoryData;
      if(data.version!==trajectoryRevision||data.signature!==signature||!Array.isArray(data.times)||data.times.length<2
        ||data.times[0]!==0||Math.abs(data.times.at(-1)!-program.duration)>1e-8||!Array.isArray(data.directions)||data.directions.length!==data.times.length
        ||!Array.isArray(data.biases)||data.biases.length!==data.times.length-1||data.times.some((t,i)=>!Number.isFinite(t)||(i>0&&t<=data.times[i-1]))
        ||data.directions.some(d=>!Array.isArray(d)||d.length!==90||d.some(x=>!Number.isFinite(x)))
        ||data.biases.some(b=>!Array.isArray(b)||b.length!==10||b.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)))))throw new Error('本条轨迹与公式版本不匹配，请重新加载');
      for(const directions of data.directions)for(let i=0;i<90;i+=3)
        if(Math.abs(Math.hypot(directions[i],directions[i+1],directions[i+2])-1)>1e-7)throw new Error('指法轨迹方向数据无效');
      validateArmTrajectory(data.arms,program.duration);
      if(!data.arms.fingerObstacles)throw new Error('本条手臂轨迹缺少实际手指校验');
      return data;
    })();
    trajectoryRequests.set(key,request);request.then(()=>trajectoryRequests.delete(key),()=>trajectoryRequests.delete(key));
  }
  const data=await request;
  if(branchTracks.get(program)?.arms)return;
  const references=data.times.map((time,k)=> {
    const frame=fitTeachingFrame(sampleTeachingMotion(program,time));
    const solutions=HANDS.flatMap(hand=>FINGER_NAMES.map(finger=> {
      const index=HANDS.indexOf(hand)*5+FINGER_NAMES.indexOf(finger),q=new Quaternion().fromArray(frame.pose[hand].rotation),base=FINGER_BASES[finger],sign=hand==='right'?1:-1;
      const points=[new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(v(frame.pose[hand].palm))];
      for(let link=0;link<3;link++) {
        const direction=new Vector3().fromArray(data.directions[k],index*9+link*3);
        points.push(points.at(-1)!.clone().addScaledVector(direction.applyQuaternion(q),FINGER_LENGTHS[link]));
      }
      return {hand,finger,joints:points.map(a) as RigidFingerSolution['joints'],reachError:0,minimumClearance:0};
    }));
    return {pose:frame.pose,solutions};
  });
  branchTracks.set(program,{times:data.times,references,biases:data.biases,arms:data.arms});
}
export function teachingTrajectoryCacheInfo() {
  const ids=getCompiledTeachingMotionIds();
  return {registeredPrograms:ids.length,decodedTracks:ids.filter(id=>branchTracks.has(getCompiledTeachingMotion(id)!)).length,inflightRequests:trajectoryRequests.size};
}
function trajectoryClearance(solution:RigidFingerSolution,others:RigidFingerSolution[],baseField:DistanceField,constrained=false,pose?:TeachingPose) {
  const field=pose?mountField(pose,solution,baseField):baseField;
  const points=solution.joints.map(v),obstacles=others.flatMap(s=>s.joints.slice(0,3).map((p,i)=> {
    const a=v(p),b=v(s.joints[i+1]);return {a,b,center:a.clone().add(b).multiplyScalar(.5),radius:a.distanceTo(b)*.5};
  }));
  return Math.min(constrained?Infinity:field(points[3])-.0032,field(points[0])-.0045,field(points[1])-.0037,field(points[2])-.0037,
    linkClearance(points[0],points[1],.0036,field),linkClearance(points[1],points[2],.0036,field),linkClearance(points[2],points[3],.0026,field),
    segmentDistance(points[0],points[1],points[2],points[3])-.0077,
    segmentDistance(points[1],points[2],points[3],points[3])-.0069,adjacentLinkClearance(points),otherClearance(points,obstacles));
}
/** A whole-formula deterministic branch reference, never previous render state.
 * Current targets are still solved with rigid lengths and exact contact pads. */
export function solveTeachingPose(pose:TeachingPose,frame?:PoseFrame):RigidFingerSolution[] {
  const program=frame?.motionId?getCompiledTeachingMotion(frame.motionId):undefined;
  if(!program||frame?.time===undefined)return solvePoseWithBranch(pose,frame);
  const track=branchTrack(program),time=frame.time;
  let lo=0,hi=track.times.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(track.times[mid]<=time)lo=mid;else hi=mid-1;}
  if(Math.abs(track.times[lo]-time)<1e-10)return track.references[lo].solutions;
  if(lo+1<track.times.length&&Math.abs(track.times[lo+1]-time)<1e-10)return track.references[lo+1].solutions;
  const next=Math.min(lo+1,track.times.length-1),from=track.references[lo],to=track.references[next];
  const blend=(time-track.times[lo])/(track.times[next]-track.times[lo]);
  return interpolateBranch(pose,from,to,blend,track.biases[lo],trajectoryConstraints(frame));
}
function interpolateBranch(pose:TeachingPose,from:BranchReference,to:BranchReference,blend:number,bias:BranchBias[],contacts:TeachingContact[],only?:number):RigidFingerSolution[] {
  return from.solutions.flatMap((left,i)=> {
    if(only!==undefined&&i!==only)return [];
    const right=to.solutions[i],hand=left.hand,finger=left.finger,h=pose[hand],sign=hand==='right'?1:-1;
    const q=new Quaternion().fromArray(h.rotation),fromInverse=new Quaternion().fromArray(from.pose[hand].rotation).invert(),toInverse=new Quaternion().fromArray(to.pose[hand].rotation).invert();
    const base=FINGER_BASES[finger],origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(v(h.palm));
    const points=[origin];
    const free=!contacts.some(c=>c.hand===hand&&c.finger===finger);
    const freeDirections=free?interpolateFingerDirections(left.joints.slice(0,3).map((p,i)=>a(v(left.joints[i+1]).sub(v(p)).normalize().applyQuaternion(fromInverse))),
      right.joints.slice(0,3).map((p,i)=>a(v(right.joints[i+1]).sub(v(p)).normalize().applyQuaternion(toInverse))),blend):undefined;
    for(let link=0;link<3;link++) {
      const start=v(left.joints[link+1]).sub(v(left.joints[link])).normalize().applyQuaternion(fromInverse);
      const end=v(right.joints[link+1]).sub(v(right.joints[link])).normalize().applyQuaternion(toInverse);
      const direction=freeDirections?v(freeDirections[link]):start.applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(start,end),blend));
      if(!contacts.some(c=>c.hand===hand&&c.finger===finger)) {
        const adjust=bias[i]??[0,0,0],weight=Math.sin(Math.PI*blend)**2;
        const first=v(left.joints[1]).sub(v(left.joints[0])).normalize().applyQuaternion(fromInverse);
        const second=v(left.joints[2]).sub(v(left.joints[1])).normalize().applyQuaternion(fromInverse);
        let hinge=first.clone().cross(second);
        if(hinge.lengthSq()<1e-8)hinge=first.clone().cross(new Vector3(1,0,0));
        if(hinge.lengthSq()<1e-8)hinge=first.clone().cross(new Vector3(0,1,0));
        hinge.normalize();
        if(link>=1)direction.applyAxisAngle(hinge,adjust[1]*weight);
        if(link>=2)direction.applyAxisAngle(hinge,adjust[2]*weight);
        direction.applyAxisAngle(new Vector3(1,0,0),adjust[0]*weight);
      }
      direction.applyQuaternion(q);
      points.push(points.at(-1)!.clone().addScaledVector(direction,FINGER_LENGTHS[link]));
    }
    if(!contacts.some(c=>c.hand===hand&&c.finger===finger))
      return {hand,finger,joints:points.map(a) as RigidFingerSolution['joints'],reachError:0,minimumClearance:0};
    {
      const end=v(h.tips[finger].point),normal=v(h.tips[finger].normal),direction=points[2].clone().sub(points[3]).normalize();
      // A fingertip passing an MCP normal line makes an instantaneous
      // origin-tip tangent flip. Transport a fixed interval tangent instead.
      const referenceNormal=v(from.pose[hand].tips[finger].normal).normalize();
      const referenceTangent=v(left.joints[0]).sub(v(left.joints[3]));
      referenceTangent.addScaledVector(referenceNormal,-referenceTangent.dot(referenceNormal));
      if(referenceTangent.lengthSq()<1e-6) {
        const basis=Math.abs(referenceNormal.x)<.8?new Vector3(1,0,0):new Vector3(0,1,0);
        referenceTangent.copy(basis).addScaledVector(referenceNormal,-basis.dot(referenceNormal));
      }
      if(referenceNormal.dot(normal)<-.9999)throw new TrajectoryBendError('指法法向需要增加转折关键帧');
      const tangent=referenceTangent.normalize().applyQuaternion(new Quaternion().setFromUnitVectors(referenceNormal,normal));
      const side=normal.clone().cross(tangent).normalize();
      const weight=Math.sin(Math.PI*blend)**2,adjust=bias[i]??[0,0,0];
      direction.addScaledVector(tangent,adjust[1]*weight).addScaledVector(side,adjust[2]*weight).normalize();
      const contact=contacts.find(c=>c.hand===hand&&c.finger===finger);
      if(!contact?.positionOnly&&direction.dot(normal)<.2)direction.addScaledVector(normal,.2-direction.dot(normal)).normalize();
      constrainDistalDirection(direction,contacts.find(c=>c.hand===hand&&c.finger===finger),normal);
      const distal=end.clone().addScaledVector(direction,FINGER_LENGTHS[2]);
      const fromAxis=v(left.joints[2]).sub(v(left.joints[0])).applyQuaternion(fromInverse).normalize();
      const toAxis=v(right.joints[2]).sub(v(right.joints[0])).applyQuaternion(toInverse).normalize();
      const fromRadial=v(left.joints[1]).sub(v(left.joints[0])).applyQuaternion(fromInverse);
      fromRadial.addScaledVector(fromAxis,-fromRadial.dot(fromAxis)).normalize();
      const toRadial=v(right.joints[1]).sub(v(right.joints[0])).applyQuaternion(toInverse);
      toRadial.addScaledVector(toAxis,-toRadial.dot(toAxis)).normalize();
      const transportedEnd=fromRadial.clone().applyQuaternion(new Quaternion().setFromUnitVectors(fromAxis,toAxis));
      const twist=Math.atan2(toAxis.dot(transportedEnd.clone().cross(toRadial)),transportedEnd.dot(toRadial));
      const delta=distal.clone().sub(origin),distance=Math.min(FINGER_LENGTHS[0]+FINGER_LENGTHS[1]-1e-8,Math.max(Math.abs(FINGER_LENGTHS[0]-FINGER_LENGTHS[1])+1e-8,delta.length()));
      const axis=delta.normalize(),localAxis=axis.clone().applyQuaternion(q.clone().invert());
      if(fromAxis.dot(localAxis)<-.9999)throw new TrajectoryBendError('指法分支需要增加转折关键帧');
      const radial=fromRadial.applyQuaternion(new Quaternion().setFromUnitVectors(fromAxis,localAxis))
        .applyAxisAngle(localAxis,twist*blend+adjust[0]*weight).applyQuaternion(q);
      const along=(FINGER_LENGTHS[0]**2-FINGER_LENGTHS[1]**2+distance**2)/(2*distance),radius=Math.sqrt(Math.max(0,FINGER_LENGTHS[0]**2-along**2));
      const elbow=origin.clone().addScaledVector(axis,along).addScaledVector(radial,radius),target=origin.clone().addScaledVector(axis,distance);
      const actual=target.clone().addScaledVector(direction,-FINGER_LENGTHS[2]);
      return {hand,finger,joints:[a(origin),a(elbow),a(target),a(actual)] as RigidFingerSolution['joints'],reachError:actual.distanceTo(end),minimumClearance:0};
    }
  });
}
/** Fit the palm to all simultaneously constrained digits before solving rigid
 * phalanges. Fingertip anchors remain exact; the wrist supplies a small access
 * adjustment. Unreachable results are retained as errors, never stretched. */
export function fitTeachingFrame(frame:TeachingFrame):TeachingFrame {
  const pose:TeachingPose=structuredClone(frame.pose);
  const resting=HANDS.flatMap(hand=>FINGER_NAMES.filter(finger=>!trajectoryConstraints(frame).some(c=>c.hand===hand&&c.finger===finger)&&isResting(frame.pose,hand,finger)).map(finger=>({hand,finger})));
  // Palm motion is authored against held/incoming contacts by the compiler.
  // Free fingertips must never move a supporting palm through a reach fit.
  // The palm still travels outside the cube during a wrist reorientation;
  // a straight chord between two safe grips can cross through the cube.
  for(const hand of HANDS) {
    const h=pose[hand],outward=new Vector3(hand==='right'?1:-1,0,0).applyQuaternion(new Quaternion().fromArray(h.rotation));
    const palm=v(h.palm),minimum=.045*(Math.abs(outward.x)+Math.abs(outward.y)+Math.abs(outward.z))+.038;
    if(palm.dot(outward)<minimum)h.palm=a(palm.addScaledVector(outward,minimum-palm.dot(outward)));
  }
  {
    const shapes=frameCubeShapes(frame),field=cubeEnvelope(frame);
    for(const hand of HANDS) {
      const h=pose[hand],q=new Quaternion().fromArray(h.rotation),sign=hand==='right'?1:-1;
      const original=v(h.palm),outward=new Vector3(sign,0,0).applyQuaternion(q);
      const blocked=(offset:number)=> {
        const center=original.clone().addScaledVector(outward,offset);
        const box:RoundedBox={center:a(center),rotation:h.rotation,half:specification.geometry.palmSize.map(x=>x/2+.0065) as Vec3,rounding:0};
        for(const shape of shapes) {
          if(center.distanceTo(v(shape.center))>shape.boundingRadius+.043)continue;
          if(obbPenetration(box,shape)>.00005)return true;
        }
        for(const finger of FINGER_NAMES) {
          const b=FINGER_BASES[finger],base=new Vector3(sign*b[0],b[1],b[2]).applyQuaternion(q).add(center);
          if(field(base)<.0047)return true;
        }
        return false;
      };
      if(blocked(0)) {
        let low=0,high=.035;
        for(let n=0;n<10;n++){const mid=(low+high)/2;if(blocked(mid))low=mid;else high=mid;}
        h.palm=a(original.addScaledVector(outward,high));
      }
    }
  }
  for(const {hand,finger} of resting)pose[hand].tips[finger].point=a(restLocal(hand,finger)
    .applyQuaternion(new Quaternion().fromArray(pose[hand].rotation)).add(v(pose[hand].palm)));
  for(const hand of HANDS)for(const finger of FINGER_NAMES) {
    // A declared contact is immutable. Access problems must be solved by the
    // palm/other digits and must remain an explicit reach/collision failure.
    if(trajectoryConstraints(frame).some(c=>c.hand===hand&&c.finger===finger))continue;
    const h=pose[hand],q=new Quaternion().fromArray(h.rotation),sign=hand==='right'?1:-1;
    const point=v(h.tips[finger].point),local=point.clone().sub(v(h.palm)).applyQuaternion(q.clone().invert());
    if(Math.abs(local.x)<.0112&&Math.abs(local.y)<.0337&&Math.abs(local.z)<.0247) {
      // Project continuously to the nearest radial shell. Forcing every point
      // to +X teleported a fingertip by 22 mm when it entered from the -X side.
      if(local.lengthSq()<1e-14)local.set(sign*.0113,0,0);
      else local.multiplyScalar(Math.min(.0113/Math.max(1e-9,Math.abs(local.x)),.0338/Math.max(1e-9,Math.abs(local.y)),.0248/Math.max(1e-9,Math.abs(local.z))));
      point.copy(local.applyQuaternion(q).add(v(h.palm)));
    }
    for(const other of FINGER_NAMES) {
      const base=FINGER_BASES[other],origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(v(h.palm));
      const delta=point.clone().sub(origin);
      if(delta.length()<.0079) {
        if(delta.lengthSq()<1e-14)delta.set(sign,0,0).applyQuaternion(q);
        point.copy(origin.add(delta.setLength(.0079)));
      }
    }
    h.tips[finger].point=a(point);
  }
  const digits=HANDS.flatMap(hand=>FINGER_NAMES.map(finger=>({hand,finger,
    fixed:trajectoryConstraints(frame).some(c=>c.hand===hand&&c.finger===finger)||isResting(pose,hand,finger)})));
  // Only free travel is adjusted. This supplies the small sideways avoidance
  // human fingers make while a different finger continues to hold the cube.
  for(let pass=0;pass<4;pass++)for(let i=0;i<digits.length;i++)for(let j=i+1;j<digits.length;j++) {
    const first=digits[i],second=digits[j];if(first.fixed&&second.fixed)continue;
    const p=v(pose[first.hand].tips[first.finger].point),r=v(pose[second.hand].tips[second.finger].point);
    const delta=r.clone().sub(p),distance=delta.length();if(distance>=.0084)continue;
    if(distance<1e-8)delta.set(0,1,0);else delta.divideScalar(distance);
    const correction=.0084-distance;
    if(!first.fixed)p.addScaledVector(delta,-correction*(second.fixed?1:.5));
    if(!second.fixed)r.addScaledVector(delta,correction*(first.fixed?1:.5));
    pose[first.hand].tips[first.finger].point=a(p);pose[second.hand].tips[second.finger].point=a(r);
  }
  return {...frame,pose};
}
function alignNode(node:Object3D,worldOrigin:Vector3,worldEnd:Vector3) {
  const worldQ=new Quaternion().setFromUnitVectors(UP,worldEnd.clone().sub(worldOrigin).normalize());
  const parentQ=node.parent?.getWorldQuaternion(new Quaternion())??new Quaternion();
  node.quaternion.copy(parentQ.invert().multiply(worldQ));
  node.updateMatrixWorld(true);
}
export function solveTeachingArms(pose:TeachingPose,frame?:Pick<TeachingFrame,'move'|'angle'|'motionId'|'time'>) {
  const program=frame?.motionId?getCompiledTeachingMotion(frame.motionId):undefined;
  if(program&&frame?.time!==undefined) {
    const track=branchTrack(program);
    if(!track.arms&&typeof window!=='undefined')throw new Error('本条手臂轨迹尚未准备完成');
    return sampleArmTrajectory(track.arms??prepareAuthoredArms(program,track),frame.time,pose);
  }
  return HANDS.map(hand=> {
    const sign=hand==='right'?1:-1,shoulder=new Vector3(sign*.215,-.23,.04);
    const target=v(specification.wristAttachment).applyQuaternion(new Quaternion().fromArray(pose[hand].rotation)).add(v(pose[hand].palm));
    const outward=new Vector3(sign,0,0);
    const pole=shoulder.clone().lerp(target,.5).addScaledVector(outward,.2);
    const solved=twoLink(shoulder,target,specification.armLengths[0],specification.armLengths[1],pole,false);
    return {hand,shoulder:a(shoulder),elbow:a(solved.elbow),wrist:a(solved.target),target:a(target),reachError:solved.target.distanceTo(target)};
  });
}
export class TeachingRig {
  readonly root:Group;
  private materials:MeshStandardMaterial[]=[];
  private fingerMaterials=new Map<string,MeshStandardMaterial[]>();
  private ghost=false;
  private nodes=new Map<string,Object3D>();
  private disposed=false;
  private constructor(root:Group) {
    this.root=root;
    const perDigit=new Map<string,MeshStandardMaterial>();
    root.traverse(node=> {
      this.nodes.set(node.name,node);
      if(node instanceof Mesh) {
        node.castShadow=true;node.receiveShadow=true;
        const finger=/^(left|right)_(thumb|index|middle|ring|little)_/.exec(node.name);
        if(finger) {
          const digit=`${finger[1]}-${finger[2]}`;
          const source=Array.isArray(node.material)?node.material:[node.material];
          const assigned=source.map(material=> {
            if(!(material instanceof MeshStandardMaterial))return material;
            const key=`${digit}:${material.uuid}`;
            if(!perDigit.has(key)) {
              const copy=material.clone();perDigit.set(key,copy);
              const list=this.fingerMaterials.get(digit)??[];list.push(copy);this.fingerMaterials.set(digit,list);
            }
            return perDigit.get(key)!;
          });
          node.material=Array.isArray(node.material)?assigned:assigned[0];
        }
        const materials=Array.isArray(node.material)?node.material:[node.material];
        materials.forEach(material=>{if(material instanceof MeshStandardMaterial&&!this.materials.includes(material))this.materials.push(material);});
      }
    });
    for(const hand of HANDS) for(const finger of FINGER_NAMES) for(const joint of ['mcp','pip','dip'])
      if(!this.nodes.has(`${hand}_${finger}_${joint}`)) throw new Error('教学机械手缺少关节层级');
  }
  static async load() {
    const gltf=await new GLTFLoader().loadAsync('/models/teaching-hand/axis-teaching-hand.glb');
    return new TeachingRig(gltf.scene);
  }
  setGhost(ghost:boolean) {
    this.ghost=ghost;
    for(const material of this.materials) {
      material.transparent=ghost;material.opacity=ghost?.23:1;material.depthWrite=!ghost;material.needsUpdate=true;
    }
  }
  update(frame:TeachingFrame) {
    if(this.disposed)return;
    const active=new Set(frame.contacts.filter(c=>c.role==='drive').map(c=>`${c.hand}-${c.finger}`));
    if(!active.size&&frame.activeHand&&frame.activeFinger)active.add(`${frame.activeHand}-${frame.activeFinger}`);
    for(const [digit,materials] of this.fingerMaterials)for(const material of materials) {
      const highlighted=active.has(digit);
      material.emissive.set(highlighted?'#5ca7bd':'#000000');material.emissiveIntensity=highlighted?.4:0;
      material.opacity=this.ghost?(highlighted?.78:.23):1;
    }
    frame=fitTeachingFrame(frame);
    for(const hand of HANDS) {
      const palm=this.nodes.get(`${hand}_palm`)!;
      palm.position.fromArray(frame.pose[hand].palm);
      palm.quaternion.fromArray(frame.pose[hand].rotation);
    }
    this.root.updateMatrixWorld(true);
    const solutions=solveTeachingPose(frame.pose,frame);
    for(const solution of solutions) {
      const prefix=`${solution.hand}_${solution.finger}`;
      for(const [i,name] of ['mcp','pip','dip'].entries()) {
        const node=this.nodes.get(`${prefix}_${name}`)!;
        alignNode(node,v(solution.joints[i]),v(solution.joints[i+1]));
      }
    }
    for(const arm of solveTeachingArms(frame.pose,frame)) {
      const shoulder=this.nodes.get(`${arm.hand}_shoulder`)!,elbow=this.nodes.get(`${arm.hand}_elbow`)!;
      shoulder.position.fromArray(arm.shoulder);
      alignNode(shoulder,v(arm.shoulder),v(arm.elbow));
      alignNode(elbow,v(arm.elbow),v(arm.wrist));
    }
    return solutions;
  }
  dispose() {
    this.disposed=true;
    const geometries=new Set<import('three').BufferGeometry>();
    this.root.traverse(node=>{if(node instanceof Mesh)geometries.add(node.geometry);});
    geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.root.removeFromParent();
  }
}
