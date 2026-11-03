import { Quaternion, Vector3 } from 'three';
import { moveAngle, NORMALS, type Vec3 } from '../core/cube';
import { contactPoint, sampleTeachingMotion, TIP_RADIUS, type TeachingFrame, type TeachingMotion, type TeachingPose } from './motion';
import { FINGER_LENGTHS, fitTeachingFrame, solveTeachingArms, solveTeachingPose } from './rig';
import type { TeachingFinger, TeachingHand } from './types';
import rigMetadata from '../../art/teaching-hand/rig.json';

const vector = (point: readonly number[]) => new Vector3().fromArray(point);
const EPS = 1e-12;
import { capsuleBoxClearance, frameCubeShapes, inscribedBoxSlabs, obbPenetration, segmentSegmentDistance, type RoundedBox, type Segment } from './geometry-shapes';
export { capsuleBoxClearance, frameCubeShapes, obbPenetration, segmentBoxDistance, segmentSegmentDistance, type RoundedBox } from './geometry-shapes';
function sub(a: Vec3,b: Vec3): Vec3 { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function addScaled(a: Vec3,b: Vec3,t: number): Vec3 { return [a[0]+b[0]*t,a[1]+b[1]*t,a[2]+b[2]*t]; }
function norm(a: Vec3) { return Math.hypot(...a); }
const dimensions=rigMetadata.geometry;

interface CapsulePrimitive extends Segment {
  hand:TeachingHand;label:string;
  /** Outer capsule encloses the mesh. Inner capsule lies inside the mesh. */
  radius:number;innerA:Vec3;innerB:Vec3;innerRadius:number;
}
interface FingerPrimitive extends CapsulePrimitive {
  finger:TeachingFinger;span:[number,number];
}
interface ArmPrimitive extends CapsulePrimitive {span:[number,number]}
function fingerPrimitives(solutions:ReturnType<typeof solveTeachingPose>):FingerPrimitive[] {
  const result:FingerPrimitive[]=[];
  for(const solution of solutions) {
    for(let i=0;i<3;i++) {
      const a=solution.joints[i],b=solution.joints[i+1],length=norm(sub(b,a)),unit=length>EPS?sub(b,a).map(value=>value/length) as Vec3:[0,1,0] as Vec3;
      const halfWidth=dimensions.linkWidths[i]/2,halfDepth=dimensions.linkDepths[i]/2;
      // Envelope from rig.json, matching the original shaft boxes that ended
      // 2 mm before each joint. The visible skin is a separate rounded shell
      // and is not remeasured from the GLB. An inscribed capsule is positive
      // evidence; the diagonal-radius outer capsule only flags possible overlap.
      const radius=Math.hypot(halfWidth,Math.max(halfDepth,i<2?dimensions.inlayDepthOffset+dimensions.inlayDepth/2:0)),innerRadius=Math.max(0,Math.min(halfWidth,halfDepth)-dimensions.linkBevel),inset=dimensions.linkEndInset;
      result.push({hand:solution.hand,finger:solution.finger,label:`link-${i}`,a:addScaled(a,unit,inset),b:addScaled(b,unit,-inset),radius,
        innerA:addScaled(a,unit,inset+innerRadius),innerB:addScaled(b,unit,-inset-innerRadius),innerRadius,span:[i,i+1]});
    }
    solution.joints.forEach((joint,i)=> {
      const radius=i===3?dimensions.padRadius:dimensions.jointRadii[i];
      // Confirmed interiors use the authored radius and the 12-by-8 inradius
      // factor in rig.json. The visible knuckle is a narrower band. 94% of the
      // authored radius stays inside that tessellation, rather than an ideal sphere.
      const inscribedFactor=Math.cos(Math.PI/dimensions.uvSphereSegments)*Math.cos(Math.PI/(2*dimensions.uvSphereRings))*.99;
      result.push({hand:solution.hand,finger:solution.finger,label:i===3?'pad':`joint-${i}`,a:joint,b:joint,radius,innerA:joint,innerB:joint,innerRadius:radius*inscribedFactor,span:[i,i]});
    });
  }
  return result;
}

export type GeometryIssueKind='nonfinite'|'unreachable'|'non-rigid'|'cube-penetration'|'finger-penetration'|'finger-palm-penetration'|'palm-cube-penetration'|'palm-palm-penetration'|'contact-slip'|'normal-direction'|'push-direction'|'contact-ownership'|'grip-constraint'|'pose-jump'|'arm-connection'|'arm-unreachable'|'arm-non-rigid'|'arm-cube-penetration'|'arm-arm-penetration'|'arm-palm-penetration'|'arm-finger-penetration';
export interface GeometryIssue {
  kind:GeometryIssueKind;depthMetres:number;hand:TeachingHand;finger?:TeachingFinger;part?:'palm'|'finger'|'arm';
  detail:string;otherHand?:TeachingHand;otherFinger?:TeachingFinger;cubie?:Vec3;
  activity?:'drive'|'support'|'moving'|'free';
}
export interface GeometryFrameAudit {
  confirmed:GeometryIssue[];
  possibleCubeContacts:number;
  possibleFingerContacts:number;
  possibleFingerPalmContacts:number;
  possiblePalmContacts:number;
  possibleArmContacts:number;
  possibleArmArmContacts:number;
  possibleArmHandContacts:number;
  maximumReachErrorMetres:number;
  maximumLengthErrorMetres:number;
  maximumContactSlipMetres:number;
  maximumArmAttachmentErrorMetres:number;
  maximumArmLengthErrorMetres:number;
  minimumInwardWork:number;
}

export interface GeometryObservedPose {
  time:number;
  kind:'phase'|'boundary-before'|'boundary-after'|'key-before'|'key-at'|'key-after';
  frame:TeachingFrame;
  fingers:ReturnType<typeof solveTeachingPose>;
  arms:ReturnType<typeof solveTeachingArms>;
}

type PalmTransforms=Record<TeachingHand,Pick<TeachingPose['left'],'palm'|'rotation'>>;
interface PalmShape extends RoundedBox {hand:TeachingHand;label:string;mountFinger?:TeachingFinger;interiorBoxes?:RoundedBox[]}
const palmInteriors=(shape:RoundedBox&{interiorBoxes?:RoundedBox[]})=>shape.interiorBoxes??inscribedBoxSlabs(shape);
function palmShapes(pose:PalmTransforms):PalmShape[] {
  return (['left','right'] as const).flatMap(hand=> {
    const palm=pose[hand],q=new Quaternion().fromArray(palm.rotation),sign=hand==='right'?1:-1;
    const shell={hand,label:'palm shell',center:palm.palm,rotation:palm.rotation,half:dimensions.palmSize.map(value=>value/2) as Vec3,rounding:dimensions.palmBevel};
    const innerCenter=vector(palm.palm).add(new Vector3(-sign*dimensions.palmInnerOffset,0,0).applyQuaternion(q)).toArray() as Vec3;
    const inner={hand,label:'palm inner plate',center:innerCenter,rotation:palm.rotation,half:dimensions.palmInnerSize.map(value=>value/2) as Vec3,rounding:dimensions.palmInnerBevel};
    const inlayOffset=dimensions.palmInlayOffsetRight;
    const inlayCenter=vector(palm.palm).add(new Vector3(sign*inlayOffset[0],inlayOffset[1],inlayOffset[2]).applyQuaternion(q)).toArray() as Vec3;
    const inlay={hand,label:'palm decorative inlay',center:inlayCenter,rotation:palm.rotation,half:dimensions.palmInlaySize.map(value=>value/2) as Vec3,rounding:dimensions.palmInlayBevel};
    const mounts=Object.entries(rigMetadata.baseOffsetsRight).map(([name,base])=> {
      const finger=name as TeachingFinger,radius=dimensions.mcpMountRadius,length=dimensions.mcpMountLength;
      const center=vector(palm.palm).add(new Vector3(sign*(base[0]+length/2),base[1],base[2]).applyQuaternion(q)).toArray() as Vec3;
      // A 16-sided cylinder's radial incircle contains this square. It is a
      // genuine subset of the mesh; the enclosing box is only a broad warning.
      const inside=radius*Math.cos(Math.PI/dimensions.mcpMountRadialSegments)/Math.SQRT2-.00012;
      const interior:RoundedBox={center,rotation:palm.rotation,half:[length/2-.00012,inside,inside],rounding:0};
      return {hand,label:`${finger} MCP mount`,mountFinger:finger,center,rotation:palm.rotation,half:[length/2,radius,radius] as Vec3,rounding:0,interiorBoxes:[interior]};
    });
    return [shell,inner,inlay,...mounts];
  });
}
function checkFingerPalms(primitives:FingerPrimitive[],solutions:ReturnType<typeof solveTeachingPose>,palms:ReturnType<typeof palmShapes>,tolerance:number) {
  const confirmed:GeometryIssue[]=[];let possibleFingerPalmContacts=0;
  for(const primitive of primitives)for(const palm of palms) {
    const sameHand=primitive.hand===palm.hand,connectedMcp=sameHand&&(!palm.mountFinger||palm.mountFinger===primitive.finger);
    if(connectedMcp&&primitive.label==='joint-0')continue;
    let outer:Segment=primitive,inner:Segment={a:primitive.innerA,b:primitive.innerB};
    if(connectedMcp&&primitive.label==='link-0') {
      const origin=solutions.find(solution=>solution.hand===primitive.hand&&solution.finger===primitive.finger)!.joints[0];
      const delta=sub(primitive.b,primitive.a),length=norm(delta),direction=length>EPS?delta.map(value=>value/length) as Vec3:[0,1,0] as Vec3;
      // Only the local MCP connection ball is exempt. A proximal shaft that
      // points backwards through the opposite palm wall remains a collision.
      outer={a:addScaled(origin,direction,dimensions.jointRadii[0]+primitive.radius+tolerance),b:primitive.b};
      inner={a:addScaled(origin,direction,dimensions.jointRadii[0]+primitive.innerRadius+tolerance),b:primitive.innerB};
    }
    if(segmentSegmentDistance(outer.a,outer.b,palm.center,palm.center)>norm(palm.half)+primitive.radius+tolerance)continue;
    if(capsuleBoxClearance(outer,primitive.radius,palm)>=-tolerance)continue;
    possibleFingerPalmContacts++;
    const depth=Math.max(...palmInteriors(palm).map(slab=>-capsuleBoxClearance(inner,primitive.innerRadius,slab)));
    if(depth>tolerance)confirmed.push({kind:'finger-palm-penetration',depthMetres:depth,hand:primitive.hand,finger:primitive.finger,part:'finger',otherHand:palm.hand,
      detail:`${primitive.label} interior intersects ${sameHand?'same':'opposite'} ${palm.label}; only the same-hand MCP connection ball is exempt.`});
  }
  return {confirmed,possibleFingerPalmContacts};
}
export function auditFingerPalmVolumes(pose:PalmTransforms,solutions:ReturnType<typeof solveTeachingPose>,tolerance=.0003) {
  return checkFingerPalms(fingerPrimitives(solutions),solutions,palmShapes(pose),tolerance);
}
export function auditArmConnections(pose:PalmTransforms,arms:ReturnType<typeof solveTeachingArms>,tolerance=.0003) {
  const confirmed:GeometryIssue[]=[];
  let maximumArmAttachmentErrorMetres=0,maximumArmLengthErrorMetres=0;
  for(const arm of arms) {
    if(![...arm.shoulder,...arm.elbow,...arm.wrist,...arm.target,arm.reachError].every(Number.isFinite)) {
      confirmed.push({kind:'nonfinite',hand:arm.hand,part:'arm',depthMetres:0,detail:'The arm solver produced a non-finite joint.'});continue;
    }
    const palm=pose[arm.hand],expected=vector(rigMetadata.wristAttachment).applyQuaternion(new Quaternion().fromArray(palm.rotation)).add(vector(palm.palm));
    const targetError=vector(arm.target).distanceTo(expected),attachmentError=vector(arm.wrist).distanceTo(expected),reachError=vector(arm.wrist).distanceTo(vector(arm.target));
    maximumArmAttachmentErrorMetres=Math.max(maximumArmAttachmentErrorMetres,attachmentError);
    if(targetError>tolerance)confirmed.push({kind:'arm-connection',hand:arm.hand,part:'arm',depthMetres:targetError,detail:'Arm target does not match the GLB wrist coupler transformed by the palm rotation.'});
    if(attachmentError>tolerance)confirmed.push({kind:'arm-connection',hand:arm.hand,part:'arm',depthMetres:attachmentError,detail:'Actual rigid arm endpoint is detached from the palm-local wrist coupler.'});
    if(reachError>tolerance)confirmed.push({kind:'arm-unreachable',hand:arm.hand,part:'arm',depthMetres:reachError,detail:'The two authored arm links cannot reach the wrist target.'});
    const points=[arm.shoulder,arm.elbow,arm.wrist];
    for(let i=0;i<2;i++) {
      const error=Math.abs(norm(sub(points[i+1],points[i]))-rigMetadata.armLengths[i]);
      maximumArmLengthErrorMetres=Math.max(maximumArmLengthErrorMetres,error);
      if(error>1e-7)confirmed.push({kind:'arm-non-rigid',hand:arm.hand,part:'arm',depthMetres:error,detail:`Arm link ${i} differs from its authored rigid length.`});
    }
  }
  return {confirmed,maximumArmAttachmentErrorMetres,maximumArmLengthErrorMetres};
}

function armPrimitives(arms:ReturnType<typeof solveTeachingArms>):ArmPrimitive[] {
  const primitives:ArmPrimitive[]=[];
  const sphereFactor=Math.cos(Math.PI/dimensions.uvSphereSegments)*Math.cos(Math.PI/(2*dimensions.uvSphereRings))*.99;
  for(const arm of arms) {
    const points=[arm.shoulder,arm.elbow,arm.wrist],halfWidth=dimensions.armHousingWidth/2,halfDepth=dimensions.armHousingDepth/2;
    const radius=Math.hypot(halfWidth,halfDepth),innerRadius=Math.max(0,Math.min(halfWidth,halfDepth)-dimensions.armHousingBevel),inset=dimensions.armEndInset;
    for(let i=0;i<2;i++) {
      const a=points[i],b=points[i+1],length=norm(sub(b,a)),unit=length>EPS?sub(b,a).map(value=>value/length) as Vec3:[0,1,0] as Vec3;
      primitives.push({hand:arm.hand,label:i===0?'upper housing':'forearm housing',a:addScaled(a,unit,inset),b:addScaled(b,unit,-inset),radius,
        innerA:addScaled(a,unit,inset+innerRadius),innerB:addScaled(b,unit,-inset-innerRadius),innerRadius,span:[i,i+1]});
    }
    points.forEach((point,i)=> {
      const radius=i===2?dimensions.wristCouplerRadius:dimensions.armBearingRadius;
      primitives.push({hand:arm.hand,label:i===0?'shoulder bearing':i===1?'elbow bearing':'wrist coupler',a:point,b:point,radius,innerA:point,innerB:point,innerRadius:radius*sphereFactor,span:[i,i]});
    });
  }
  return primitives;
}
/** Uses authored housing interiors and UV-sphere inradii, not IK clearance. */
export function auditArmVolumes(frame:Pick<TeachingFrame,'move'|'angle'>,arms:ReturnType<typeof solveTeachingArms>,tolerance=.0003,shapes=frameCubeShapes(frame),primitives=armPrimitives(arms)) {
  const confirmed:GeometryIssue[]=[];
  let possibleArmContacts=0;
  for(const primitive of primitives)for(const shape of shapes) {
    if(segmentSegmentDistance(primitive.a,primitive.b,shape.center,shape.center)>shape.boundingRadius+primitive.radius+tolerance)continue;
    if(capsuleBoxClearance(primitive,primitive.radius,shape)>=-tolerance)continue;
    possibleArmContacts++;
    const innerHalf=shape.half.map(value=>Math.max(0,value-.00012)) as Vec3;
    const innerShape={...shape,half:innerHalf,rounding:Math.min(shape.rounding,...innerHalf)};
    const inner=capsuleBoxClearance({a:primitive.innerA,b:primitive.innerB},primitive.innerRadius,innerShape);
    if(inner < -tolerance)confirmed.push({kind:'arm-cube-penetration',depthMetres:-inner,hand:primitive.hand,part:'arm',cubie:shape.cubie,detail:`${primitive.label} interior intersects ${shape.label}.`});
  }
  return {confirmed,possibleArmContacts};
}

/** Exact line/sphere clipping; returned capsule cores lie outside the allowed
 * assembly ball. The outer warning is retained for the unclassified fringe. */
function exteriorCapsuleSegments(segment:Segment,radius:number,center:Vec3,connectionRadius:number,tolerance:number):Segment[] {
  const d=sub(segment.b,segment.a),offset=sub(segment.a,center),a=d.reduce((sum,value)=>sum+value*value,0);
  const safeRadius=connectionRadius+radius+tolerance;
  if(a<EPS)return norm(offset)>safeRadius?[segment]:[];
  const b=2*d.reduce((sum,value,index)=>sum+value*offset[index],0),c=offset.reduce((sum,value)=>sum+value*value,0)-safeRadius*safeRadius;
  const discriminant=b*b-4*a*c;
  if(discriminant<=0)return [segment];
  const near=(-b-Math.sqrt(discriminant))/(2*a),far=(-b+Math.sqrt(discriminant))/(2*a);
  if(far<=0||near>=1)return [segment];
  const result:Segment[]=[];
  if(near>0)result.push({a:segment.a,b:addScaled(segment.a,d,Math.min(1,near))});
  if(far<1)result.push({a:addScaled(segment.a,d,Math.max(0,far)),b:segment.b});
  return result;
}
function checkFingerVolumes(primitives:FingerPrimitive[],solutions:ReturnType<typeof solveTeachingPose>,tolerance:number) {
  const confirmed:GeometryIssue[]=[];let possibleFingerContacts=0;
  for(let i=0;i<primitives.length;i++)for(let j=i+1;j<primitives.length;j++) {
    const a=primitives[i],b=primitives[j],shared=a.hand===b.hand&&a.finger===b.finger?Math.max(a.span[0],b.span[0]):-1;
    const connected=shared>=0&&shared<=Math.min(a.span[1],b.span[1]);
    if(connected&&(a.span[0]===a.span[1]||b.span[0]===b.span[1]))continue;
    if(segmentSegmentDistance(a.a,a.b,b.a,b.b)-a.radius-b.radius>=-tolerance)continue;
    possibleFingerContacts++;
    let innerA:Segment[]=[{a:a.innerA,b:a.innerB}],innerB:Segment[]=[{a:b.innerA,b:b.innerB}];
    if(connected) {
      const joint=solutions.find(solution=>solution.hand===a.hand&&solution.finger===a.finger)!.joints[shared];
      innerA=exteriorCapsuleSegments(innerA[0],a.innerRadius,joint,dimensions.jointRadii[shared],tolerance);
      innerB=exteriorCapsuleSegments(innerB[0],b.innerRadius,joint,dimensions.jointRadii[shared],tolerance);
    }
    const depth=Math.max(0,...innerA.flatMap(x=>innerB.map(y=>a.innerRadius+b.innerRadius-segmentSegmentDistance(x.a,x.b,y.a,y.b))));
    if(depth>tolerance)confirmed.push({kind:'finger-penetration',depthMetres:depth,hand:a.hand,finger:a.finger,otherHand:b.hand,otherFinger:b.finger,detail:`${a.label} intersects ${b.label}${connected?' outside the common finger joint assembly ball':''}.`});
  }
  return {confirmed,possibleFingerContacts};
}
export function auditFingerSelfVolumes(solutions:ReturnType<typeof solveTeachingPose>,tolerance=.0003) {
  return checkFingerVolumes(fingerPrimitives(solutions),solutions,tolerance);
}
function checkArmHandVolumes(pose:PalmTransforms,arms:ReturnType<typeof solveTeachingArms>,armParts:ArmPrimitive[],fingers:FingerPrimitive[],palms:ReturnType<typeof palmShapes>,tolerance:number) {
  const confirmed:GeometryIssue[]=[];let possibleArmArmContacts=0,possibleArmHandContacts=0;
  for(let i=0;i<armParts.length;i++)for(let j=i+1;j<armParts.length;j++) {
    const a=armParts[i],b=armParts[j],shared=a.hand===b.hand?Math.max(a.span[0],b.span[0]):-1;
    const connected=shared>=0&&shared<=Math.min(a.span[1],b.span[1]);
    // The bearing and its incident housing are one intended joint assembly.
    if(connected&&(a.span[0]===a.span[1]||b.span[0]===b.span[1]))continue;
    if(segmentSegmentDistance(a.a,a.b,b.a,b.b)-a.radius-b.radius>=-tolerance)continue;
    possibleArmArmContacts++;
    let innerA:Segment[]=[{a:a.innerA,b:a.innerB}],innerB:Segment[]=[{a:b.innerA,b:b.innerB}];
    if(connected) {
      const arm=arms.find(arm=>arm.hand===a.hand)!,joint=[arm.shoulder,arm.elbow,arm.wrist][shared];
      const radius=shared===2?dimensions.wristCouplerRadius:dimensions.armBearingRadius;
      innerA=exteriorCapsuleSegments(innerA[0],a.innerRadius,joint,radius,tolerance);
      innerB=exteriorCapsuleSegments(innerB[0],b.innerRadius,joint,radius,tolerance);
    }
    const depth=Math.max(0,...innerA.flatMap(x=>innerB.map(y=>a.innerRadius+b.innerRadius-segmentSegmentDistance(x.a,x.b,y.a,y.b))));
    if(depth>tolerance)confirmed.push({kind:'arm-arm-penetration',depthMetres:depth,hand:a.hand,otherHand:b.hand,part:'arm',detail:`${a.label} interior intersects ${b.label}${connected?' outside the common elbow assembly ball':''}.`});
  }
  for(const arm of armParts)for(const finger of fingers) {
    if(segmentSegmentDistance(arm.a,arm.b,finger.a,finger.b)-arm.radius-finger.radius>=-tolerance)continue;
    possibleArmHandContacts++;
    const depth=arm.innerRadius+finger.innerRadius-segmentSegmentDistance(arm.innerA,arm.innerB,finger.innerA,finger.innerB);
    if(depth>tolerance)confirmed.push({kind:'arm-finger-penetration',depthMetres:depth,hand:arm.hand,otherHand:finger.hand,otherFinger:finger.finger,part:'arm',detail:`${arm.label} interior intersects ${finger.label}; fingers have no arm-assembly exemption.`});
  }
  for(const arm of armParts)for(const palm of palms) {
    const sameHand=arm.hand===palm.hand;
    if(sameHand&&!palm.mountFinger&&arm.label==='wrist coupler')continue;
    if(segmentSegmentDistance(arm.a,arm.b,palm.center,palm.center)>norm(palm.half)+arm.radius+tolerance)continue;
    if(capsuleBoxClearance(arm,arm.radius,palm)>=-tolerance)continue;
    possibleArmHandContacts++;
    let interiors:Segment[]=[{a:arm.innerA,b:arm.innerB}];
    if(sameHand&&!palm.mountFinger&&arm.label==='forearm housing') {
      const wrist=vector(rigMetadata.wristAttachment).applyQuaternion(new Quaternion().fromArray(pose[arm.hand].rotation)).add(vector(pose[arm.hand].palm)).toArray() as Vec3;
      interiors=exteriorCapsuleSegments(interiors[0],arm.innerRadius,wrist,dimensions.wristCouplerRadius,tolerance);
    }
    const depth=Math.max(0,...interiors.flatMap(inner=>palmInteriors(palm).map(slab=>-capsuleBoxClearance(inner,arm.innerRadius,slab))));
    if(depth>tolerance)confirmed.push({kind:'arm-palm-penetration',depthMetres:depth,hand:arm.hand,otherHand:palm.hand,part:'arm',detail:`${arm.label} interior intersects ${palm.label}${sameHand?' outside its wrist assembly ball':''}.`});
  }
  return {confirmed,possibleArmArmContacts,possibleArmHandContacts};
}
export function auditArmHandVolumes(pose:PalmTransforms,arms:ReturnType<typeof solveTeachingArms>,solutions:ReturnType<typeof solveTeachingPose>,tolerance=.0003) {
  return checkArmHandVolumes(pose,arms,armPrimitives(arms),fingerPrimitives(solutions),palmShapes(pose),tolerance);
}

interface FrameAuditOptions {toleranceMetres?:number;gripHands?:readonly TeachingHand[];observePose?:(frame:TeachingFrame,fingers:ReturnType<typeof solveTeachingPose>,arms:ReturnType<typeof solveTeachingArms>)=>void}
export function auditTeachingFrame(input:TeachingFrame,options:FrameAuditOptions={}):GeometryFrameAudit {
  if(!Number.isFinite(input.angle))throw new Error('Cannot audit a non-finite cube angle.');
  const frame=fitTeachingFrame(input);
  return auditEvaluatedFrame(frame,solveTeachingPose(frame.pose,frame),solveTeachingArms(frame.pose,frame),options);
}
/** Reuses already evaluated authoring output when arm authoring itself fails.
 * `frame` must already be fitted and fingers must be the actual rigid chain.
 * This deliberately labelled diagnostic never substitutes for published-data
 * acceptance, even when all included bodies have no confirmed overlap. */
export function auditEvaluatedTeachingFrame(frame:TeachingFrame,solutions:ReturnType<typeof solveTeachingPose>,arms:ReturnType<typeof solveTeachingArms>,options:FrameAuditOptions&{scope:'hands-only'|'complete'}) {
  if(new Set(solutions.map(solution=>`${solution.hand}/${solution.finger}`)).size!==10)throw new Error('Authoring diagnostics require all ten actual finger chains.');
  if(options.scope==='hands-only'&&arms.length!==0)throw new Error('Hands-only diagnostics must explicitly omit arms.');
  if(options.scope==='complete'&&(arms.length!==2||new Set(arms.map(arm=>arm.hand)).size!==2))throw new Error('Complete diagnostics require both actual arm chains.');
  return {...auditEvaluatedFrame(frame,solutions,arms,options),scope:options.scope,evidenceMode:'authoring-diagnostic' as const,releaseEligible:false as const};
}
function auditEvaluatedFrame(frame:TeachingFrame,solutions:ReturnType<typeof solveTeachingPose>,arms:ReturnType<typeof solveTeachingArms>,options:FrameAuditOptions):GeometryFrameAudit {
  const tolerance=options.toleranceMetres??.0003;
  const finiteSolutions=solutions.filter(solution=>solution.joints.flat().every(Number.isFinite)&&Number.isFinite(solution.reachError)),primitives=fingerPrimitives(finiteSolutions),shapes=frameCubeShapes(frame),palms=palmShapes(frame.pose),armParts=armPrimitives(arms);
  const armAudit=auditArmConnections(frame.pose,arms,tolerance),armVolumes=auditArmVolumes(frame,arms,tolerance,shapes,armParts),armHand=checkArmHandVolumes(frame.pose,arms,armParts,primitives,palms,tolerance);
  options.observePose?.(frame,solutions,arms);
  const report:GeometryFrameAudit={...armAudit,possibleArmContacts:armVolumes.possibleArmContacts,possibleArmArmContacts:armHand.possibleArmArmContacts,possibleArmHandContacts:armHand.possibleArmHandContacts,confirmed:[...armAudit.confirmed,...armVolumes.confirmed,...armHand.confirmed],possibleCubeContacts:0,possibleFingerContacts:0,possibleFingerPalmContacts:0,possiblePalmContacts:0,maximumReachErrorMetres:0,maximumLengthErrorMetres:0,maximumContactSlipMetres:0,minimumInwardWork:1};
  const validGripHands=new Set<TeachingHand>();
  for(const hand of options.gripHands??[]) {
    const contacts=frame.contacts.filter(contact=>contact.hand===hand&&contact.rotating);
    const opposed=contacts.some((contact,index)=>contacts.slice(index+1).some(other=>vector(contact.normal).normalize().dot(vector(other.normal).normalize())<-.8));
    if(contacts.length>=2&&opposed)validGripHands.add(hand);
    else report.confirmed.push({kind:'grip-constraint',depthMetres:0,hand,finger:contacts[0]?.finger??'thumb',detail:'A declared wrist grip lacks two opposing rotating contacts.'});
  }
  for(const solution of solutions) {
    if(!finiteSolutions.includes(solution)) {
      report.confirmed.push({kind:'nonfinite',depthMetres:0,hand:solution.hand,finger:solution.finger,detail:'The rigid solver produced a non-finite joint or reach error.'});
      continue;
    }
    report.maximumReachErrorMetres=Math.max(report.maximumReachErrorMetres,solution.reachError);
    if(solution.reachError>tolerance)report.confirmed.push({kind:'unreachable',depthMetres:solution.reachError,hand:solution.hand,finger:solution.finger,detail:'Rigid fingertip cannot reach its requested target.'});
    for(let i=0;i<3;i++) {
      const error=Math.abs(norm(sub(solution.joints[i+1],solution.joints[i]))-FINGER_LENGTHS[i]);
      report.maximumLengthErrorMetres=Math.max(report.maximumLengthErrorMetres,error);
      if(error>1e-7)report.confirmed.push({kind:'non-rigid',depthMetres:error,hand:solution.hand,finger:solution.finger,detail:`Link ${i} differs from authored length.`});
    }
  }
  for(const primitive of primitives)for(const shape of shapes) {
    if(segmentSegmentDistance(primitive.a,primitive.b,shape.center,shape.center)>shape.boundingRadius+primitive.radius+tolerance)continue;
    const outer=capsuleBoxClearance(primitive,primitive.radius,shape);
    if(outer>=-tolerance)continue;
    report.possibleCubeContacts++;
    // Shrink the analytic rounded box slightly to remain inside its rounded
    // triangle tessellation. Broad-phase warnings retain the original bounds.
    const innerHalf=shape.half.map(value=>Math.max(0,value-.00012)) as Vec3;
    const innerShape={...shape,half:innerHalf,rounding:Math.min(shape.rounding,...innerHalf)};
    const inner=capsuleBoxClearance({a:primitive.innerA,b:primitive.innerB},primitive.innerRadius,innerShape);
    if(inner < -tolerance)report.confirmed.push({kind:'cube-penetration',depthMetres:-inner,hand:primitive.hand,finger:primitive.finger,cubie:shape.cubie,
      detail:`${primitive.label} intersects ${shape.label}; contact permits surface tangency, not penetration.`});
  }
  const fingerCollisions=checkFingerVolumes(primitives,finiteSolutions,tolerance);
  report.possibleFingerContacts=fingerCollisions.possibleFingerContacts;report.confirmed.push(...fingerCollisions.confirmed);
  const fingerPalms=checkFingerPalms(primitives,finiteSolutions,palms,tolerance);
  report.possibleFingerPalmContacts=fingerPalms.possibleFingerPalmContacts;report.confirmed.push(...fingerPalms.confirmed);
  const interiorDepth=(a:PalmShape,b:RoundedBox&{interiorBoxes?:RoundedBox[]})=>Math.max(...palmInteriors(a).flatMap(x=>palmInteriors(b).map(y=>obbPenetration(x,y))));
  for(const palm of palms)for(const shape of shapes) {
    if(norm(sub(palm.center,shape.center))>norm(palm.half)+shape.boundingRadius)continue;
    if(obbPenetration(palm,shape)<=tolerance)continue;
    report.possiblePalmContacts++;
    const depth=interiorDepth(palm,shape);
    if(depth>tolerance)report.confirmed.push({kind:'palm-cube-penetration',depthMetres:depth,hand:palm.hand,part:'palm',cubie:shape.cubie,detail:`${palm.label} interior intersects ${shape.label}.`});
  }
  for(const a of palms.filter(p=>p.hand==='left'))for(const b of palms.filter(p=>p.hand==='right')) {
    if(obbPenetration(a,b)<=tolerance)continue;
    report.possiblePalmContacts++;
    const depth=interiorDepth(a,b);
    if(depth>tolerance)report.confirmed.push({kind:'palm-palm-penetration',depthMetres:depth,hand:a.hand,otherHand:b.hand,part:'palm',detail:`${a.label} interior intersects opposite ${b.label}.`});
  }
  const owners=new Set<string>();
  for(const contact of frame.contacts) {
    const owner=`${contact.hand}-${contact.finger}`;
    if(owners.has(owner))report.confirmed.push({kind:'contact-ownership',depthMetres:0,hand:contact.hand,finger:contact.finger,detail:'A finger owns multiple simultaneous contact targets.'});
    owners.add(owner);
    const solution=finiteSolutions.find(solution=>solution.hand===contact.hand&&solution.finger===contact.finger);
    if(!solution)continue;
    const surface=contactPoint(contact,frame.move,frame.angle),normal=vector(surface.normal).normalize();
    const expected=vector(surface.point).addScaledVector(normal,TIP_RADIUS),actual=vector(solution.joints[3]);
    const error=actual.distanceTo(expected);report.maximumContactSlipMetres=Math.max(report.maximumContactSlipMetres,error);
    if(error>tolerance)report.confirmed.push({kind:'contact-slip',depthMetres:error,hand:contact.hand,finger:contact.finger,cubie:contact.cubie,detail:'Actual rigid fingertip misses the declared cubie-local contact.'});
    const direction=vector(solution.joints[2]).sub(actual).normalize().dot(normal);
    // A spherical pad may touch obliquely. Only entering the inward half-space
    // is invalid; requiring the bone axis to equal the surface normal would
    // incorrectly reject ordinary angled fingertip contact.
    if(direction<-.01)report.confirmed.push({kind:'normal-direction',depthMetres:0,hand:contact.hand,finger:contact.finger,detail:`Distal segment enters the inward surface half-space (${direction}).`});
    if(frame.move&&contact.rotating&&frame.move.kind!=='rotation'&&frame.phase==='拨动'&&!validGripHands.has(contact.hand)) {
      const velocity=vector(NORMALS[frame.move.face]).cross(vector(surface.point)).multiplyScalar(Math.sign(moveAngle(frame.move))).normalize();
      const work=-normal.dot(velocity);report.minimumInwardWork=Math.min(report.minimumInwardWork,work);
      if(work<.35-1e-8)report.confirmed.push({kind:'push-direction',depthMetres:0,hand:contact.hand,finger:contact.finger,cubie:contact.cubie,detail:`Contact normal opposes the intended push (${work}).`});
    }
  }
  for(const issue of report.confirmed) {
    if(issue.part==='palm'||issue.part==='arm') {
      issue.activity=options.gripHands?.includes(issue.hand)?'drive':frame.contacts.some(contact=>contact.hand===issue.hand)?'support':'free';
      continue;
    }
    const contact=frame.contacts.find(contact=>contact.hand===issue.hand&&contact.finger===issue.finger);
    issue.activity=contact?(contact.rotating?'drive':'support'):frame.activeHand===issue.hand&&frame.activeFinger===issue.finger?'moving':'free';
  }
  return report;
}

export interface GeometryMotionAudit {
  formulaId:string;sourceSteps:number;samples:number;samplesPerSegment:number;
  passed:boolean;confirmedCounts:Partial<Record<GeometryIssueKind,number>>;
  possibleCubeContacts:number;possibleFingerContacts:number;possibleFingerPalmContacts:number;possiblePalmContacts:number;possibleArmContacts:number;possibleArmArmContacts:number;possibleArmHandContacts:number;
  maximumReachErrorMetres:number;maximumLengthErrorMetres:number;maximumContactSlipMetres:number;maximumArmAttachmentErrorMetres:number;maximumArmLengthErrorMetres:number;minimumInwardWork:number;
  firstFailure?:{time:number;step:number;phase:string;issue:GeometryIssue};
  worst:Partial<Record<GeometryIssueKind,{time:number;step:number;phase:string;issue:GeometryIssue}>>;
  worstByActivity:Record<string,{time:number;step:number;phase:string;issue:GeometryIssue}>;
  boundaryContinuityChecks:number;
  trajectoryKeyContinuityChecks:number;
  limits:string[];
}
export function segmentSampleTimes(start:number,duration:number,count:number):number[] {
  if(!(duration>0))throw new Error('A motion phase needs a positive duration.');
  const samples=Math.max(3,Math.floor(count)),endInset=Math.min(1e-7,duration*1e-6);
  return Array.from({length:samples},(_,i)=>start+Math.min(duration-endInset,duration*i/(samples-1)));
}
export function auditTeachingMotion(program:TeachingMotion,options:{samplesPerSegment?:number;toleranceMetres?:number;trajectoryKeyTimes?:readonly number[];observeSample?:(sample:GeometryObservedPose)=>void}={}):GeometryMotionAudit {
  const samplesPerSegment=Math.max(3,Math.floor(options.samplesPerSegment??5));
  const report:GeometryMotionAudit={formulaId:program.formulaId,sourceSteps:program.steps.length,samples:0,samplesPerSegment,passed:true,confirmedCounts:{},possibleCubeContacts:0,possibleFingerContacts:0,possibleFingerPalmContacts:0,possiblePalmContacts:0,possibleArmContacts:0,possibleArmArmContacts:0,possibleArmHandContacts:0,maximumReachErrorMetres:0,maximumLengthErrorMetres:0,maximumContactSlipMetres:0,maximumArmAttachmentErrorMetres:0,maximumArmLengthErrorMetres:0,minimumInwardWork:1,worst:{},worstByActivity:{},boundaryContinuityChecks:0,trajectoryKeyContinuityChecks:0,limits:[
    'Discrete samples, not continuous collision detection. Between-sample collision and motion naturalness require separate visual checks.',
    'Outer shaft capsules are conservative warnings. Confirmed overlap uses inscribed joint/pad spheres or capsules contained in the shaft mesh and slightly inset cubie bounds.',
    'Capsule/box penetration depth is a positive overlap lower bound, not exact mesh penetration depth; a centerline inside a box can report its capsule radius.',
    'Palm shells, inner plates and decorative inlays use oriented-box SAT and inscribed slabs. Fixed MCP cylinders use enclosing boxes and polygon-inscribed square interiors; only their own finger connection is exempt. Arm housings, bearings and wrist couplers are checked against cubes, other arm parts, palms and fingers. Finger/arm inlays are contained in outer warnings, not separately confirmed by their thin interiors. Exact triangle-mesh self-collision is not covered.',
    'Only incident joint-sphere/shaft assemblies and the own wrist-coupler/palm assembly are exempt. Adjacent finger shafts, adjacent arm housings and own forearm/palm are confirmed using capsule cores wholly outside the shared joint ball; the remaining connection-boundary fringe is retained as a possible contact, not certified collision-free.',
    'Finger/palm checks exempt only the same-hand MCP connection ball and proximal-shaft volume within that ball. Other palm penetration remains a failure.',
    'All dimensions are metres. A 0.3 mm numerical/contact allowance does not certify real hardware execution.',
  ]};
  const recordIssue=(time:number,step:number,phase:string,issue:GeometryIssue)=> {
    report.passed=false;report.confirmedCounts[issue.kind]=(report.confirmedCounts[issue.kind]??0)+1;
    const record={time,step,phase,issue};
    if(!report.firstFailure||time<report.firstFailure.time)report.firstFailure=record;
    if(!report.worst[issue.kind]||issue.depthMetres>report.worst[issue.kind]!.issue.depthMetres)report.worst[issue.kind]=record;
    const key=`${issue.activity??'unspecified'}/${issue.kind}`;
    if(!report.worstByActivity[key]||issue.depthMetres>report.worstByActivity[key].issue.depthMetres)report.worstByActivity[key]=record;
  };
  const samples=program.segments.flatMap(segment=>segmentSampleTimes(segment.start,segment.duration,samplesPerSegment).map(time=>({time,segment})));
  const times:[number,typeof program.segments[number]|undefined][]=[...samples.map(sample=>[sample.time,sample.segment] as [number,typeof program.segments[number]]),[program.duration,undefined]];
  for(const key of options.trajectoryKeyTimes??[])for(const offset of [-1e-6,0,1e-6]) {
    const time=Math.max(0,Math.min(program.duration,key+offset));
    let lo=0,hi=program.segments.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(program.segments[mid].start<=time)lo=mid;else hi=mid-1;}
    times.push([time,time===program.duration?undefined:program.segments[lo]]);
  }
  for(const [time,segment] of times) {
    const frame=sampleTeachingMotion(program,time),audit=auditTeachingFrame(frame,{...options,gripHands:segment?.wristHands,observePose:(fitted,fingers,arms)=>options.observeSample?.({time,kind:'phase',frame:fitted,fingers,arms})});
    if(segment?.wristHands&&frame.move) {
      const fitted=fitTeachingFrame(frame),turn=new Quaternion().setFromAxisAngle(vector(NORMALS[frame.move.face]),frame.angle-segment.angleFrom);
      for(const hand of segment.wristHands) {
        const expected=turn.clone().multiply(new Quaternion().fromArray(segment.from[hand].rotation));
        const actual=new Quaternion().fromArray(fitted.pose[hand].rotation),error=expected.angleTo(actual);
        if(error>.01)audit.confirmed.push({kind:'grip-constraint',depthMetres:0,hand,finger:'thumb',detail:`Wrist rotation does not follow the selected layer (${error} radians).`});
      }
    }
    report.samples++;report.possibleCubeContacts+=audit.possibleCubeContacts;report.possibleFingerContacts+=audit.possibleFingerContacts;report.possibleFingerPalmContacts+=audit.possibleFingerPalmContacts;report.possiblePalmContacts+=audit.possiblePalmContacts;report.possibleArmContacts+=audit.possibleArmContacts;report.possibleArmArmContacts+=audit.possibleArmArmContacts;report.possibleArmHandContacts+=audit.possibleArmHandContacts;
    for(const key of ['maximumReachErrorMetres','maximumLengthErrorMetres','maximumContactSlipMetres','maximumArmAttachmentErrorMetres','maximumArmLengthErrorMetres'] as const)report[key]=Math.max(report[key],audit[key]);
    report.minimumInwardWork=Math.min(report.minimumInwardWork,audit.minimumInwardWork);
    for(const issue of audit.confirmed)recordIssue(time,frame.step,frame.phase,issue);
  }
  for(const segment of program.segments.slice(1)) {
    const before=sampleTeachingMotion(program,segment.start-1e-6),after=sampleTeachingMotion(program,segment.start+1e-6);
    const beforeFit=fitTeachingFrame(before),afterFit=fitTeachingFrame(after);
    const left=solveTeachingPose(beforeFit.pose,beforeFit),right=solveTeachingPose(afterFit.pose,afterFit);
    const beforeArms=solveTeachingArms(beforeFit.pose,beforeFit),afterArms=solveTeachingArms(afterFit.pose,afterFit);
    options.observeSample?.({time:segment.start-1e-6,kind:'boundary-before',frame:beforeFit,fingers:left,arms:beforeArms});
    options.observeSample?.({time:segment.start+1e-6,kind:'boundary-after',frame:afterFit,fingers:right,arms:afterArms});
    report.boundaryContinuityChecks++;
    for(let finger=0;finger<left.length;finger++) {
      const jump=Math.max(...left[finger].joints.map((joint,index)=>norm(sub(joint,right[finger].joints[index]))));
      if(jump>.0005)recordIssue(segment.start,after.step,after.phase,{kind:'pose-jump',depthMetres:jump,hand:left[finger].hand,finger:left[finger].finger,detail:'Actual rigid joint positions jump across a 2-microsecond phase boundary.'});
    }
    for(let i=0;i<beforeArms.length;i++) {
      const jump=Math.max(...(['shoulder','elbow','wrist'] as const).map(joint=>norm(sub(beforeArms[i][joint],afterArms[i][joint]))));
      if(jump>.0005)recordIssue(segment.start,after.step,after.phase,{kind:'pose-jump',depthMetres:jump,hand:beforeArms[i].hand,part:'arm',detail:'Actual rigid arm joints jump across a 2-microsecond phase boundary.'});
    }
  }
  for(const key of options.trajectoryKeyTimes??[]) {
    const frames=[-1e-6,0,1e-6].map((offset,index)=> {
      const time=Math.max(0,Math.min(program.duration,key+offset)),frame=fitTeachingFrame(sampleTeachingMotion(program,time));
      const sample:GeometryObservedPose={time,kind:(['key-before','key-at','key-after'] as const)[index],frame,fingers:solveTeachingPose(frame.pose,frame),arms:solveTeachingArms(frame.pose,frame)};
      options.observeSample?.(sample);return sample;
    });
    report.trajectoryKeyContinuityChecks++;
    for(const [before,after] of [[frames[0],frames[1]],[frames[1],frames[2]]]) {
      for(let i=0;i<before.fingers.length;i++) {
        const finger=before.fingers[i],jump=Math.max(...finger.joints.map((point,j)=>norm(sub(point,after.fingers[i].joints[j]))));
        if(jump>.0005)recordIssue(key,after.frame.step,after.frame.phase,{kind:'pose-jump',depthMetres:jump,hand:finger.hand,finger:finger.finger,
          detail:`Published trajectory key abrupt displacement (${before.kind} to ${after.kind}, <=1 microsecond); exact reference output differs from an adjacent sample. Finite samples alone do not prove mathematical discontinuity.`});
      }
      for(let i=0;i<before.arms.length;i++) {
        const arm=before.arms[i],jump=Math.max(...(['shoulder','elbow','wrist'] as const).map(joint=>norm(sub(arm[joint],after.arms[i][joint]))));
        if(jump>.0005)recordIssue(key,after.frame.step,after.frame.phase,{kind:'pose-jump',depthMetres:jump,hand:arm.hand,part:'arm',detail:'Published trajectory key has an abrupt rigid arm displacement within 1 microsecond.'});
      }
    }
  }
  return report;
}

export interface ActualJointSample {
  time:number;step:number;phase:string;
  fingers:ReturnType<typeof solveTeachingPose>;
  arms:ReturnType<typeof solveTeachingArms>;
}
export interface JointMotionDiagnostic {
  time:number;previousTime:number;step:number;phase:string;hand:TeachingHand;finger?:TeachingFinger;
  part:'finger'|'arm';joint:number;displacementMetres:number;speedMetresPerSecond:number;from:Vec3;to:Vec3;
}
/** These are motion-rate diagnostics, not claims of physically impossible speed. */
export function jointMotionDiagnostics(previous:ActualJointSample,current:ActualJointSample):JointMotionDiagnostic[] {
  const dt=current.time-previous.time;
  if(!(dt>0))throw new Error('Joint motion diagnostics require increasing sample times.');
  const result:JointMotionDiagnostic[]=[];
  const record=(from:Vec3,to:Vec3,hand:TeachingHand,part:'finger'|'arm',joint:number,finger?:TeachingFinger)=> {
    const displacementMetres=norm(sub(to,from));
    result.push({time:current.time,previousTime:previous.time,step:current.step,phase:current.phase,hand,part,joint,...(finger?{finger}:{}),displacementMetres,speedMetresPerSecond:displacementMetres/dt,from,to});
  };
  for(const finger of current.fingers) {
    const before=previous.fingers.find(value=>value.hand===finger.hand&&value.finger===finger.finger);
    if(!before)throw new Error('Finger ownership changed between dense samples.');
    finger.joints.forEach((point,index)=>record(before.joints[index],point,finger.hand,'finger',index,finger.finger));
  }
  for(const arm of current.arms) {
    const before=previous.arms.find(value=>value.hand===arm.hand);
    if(!before)throw new Error('Arm ownership changed between dense samples.');
    (['shoulder','elbow','wrist'] as const).forEach((key,index)=>record(before[key],arm[key],arm.hand,'arm',index));
  }
  return result;
}
export function refineJointMotionDiagnostic(diagnostic:JointMotionDiagnostic,pointAt:(time:number)=>Vec3) {
  let start=diagnostic.previousTime,end=diagnostic.time,from=diagnostic.from,to=diagnostic.to,refinementSamples=0;
  const originalInterval=[start,end];
  while(end-start>1e-5&&refinementSamples<20) {
    const mid=(start+end)/2,point=pointAt(mid);refinementSamples++;
    if(norm(sub(point,from))>=norm(sub(to,point))) {end=mid;to=point;}
    else {start=mid;from=point;}
  }
  const displacementMetres=norm(sub(to,from)),intervalSeconds=end-start;
  return {...diagnostic,originalInterval,previousTime:start,time:end,from,to,displacementMetres,intervalSeconds,
    speedMetresPerSecond:displacementMetres/intervalSeconds,refinementSamples,
    abruptAtTenMicroseconds:intervalSeconds<=1e-5&&displacementMetres>.0005};
}
/** Sample an endpoint once even when duration differs from its grid point by floating-point noise. */
export function auditSampleTimes(start:number,end:number,interval:number):number[] {
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||!(interval>0))throw new Error('Invalid audit sampling interval.');
  const times=[start];
  for(let index=1;start+index*interval<end-1e-10;index++)times.push(start+index*interval);
  if(end-start>1e-10)times.push(end);
  return times;
}
export interface GeometryRefinementWindow {start:number;end:number;reason?:string}
/** Merge overlapping/adjacent trigger windows; a speed trigger requests evidence, never fails a case. */
export function planGeometryRefinement(windows:GeometryRefinementWindow[],duration:number,interval=.001) {
  if(!(interval>0&&interval<=.001))throw new Error('Targeted geometry interval must be positive and at most 1 ms.');
  const sorted=windows.map(window=> {
    if(!Number.isFinite(window.start)||!Number.isFinite(window.end)||window.end<window.start)throw new Error('Invalid targeted geometry window.');
    return {start:Math.max(0,Math.min(duration,window.start)),end:Math.max(0,Math.min(duration,window.end)),reasons:[window.reason??'speed-trigger']};
  }).sort((a,b)=>a.start-b.start);
  const merged:typeof sorted=[];
  for(const window of sorted) {
    const previous=merged.at(-1);
    if(previous&&window.start<=previous.end+1e-10) {
      previous.end=Math.max(previous.end,window.end);previous.reasons=[...new Set([...previous.reasons,...window.reasons])];
    } else merged.push({...window});
  }
  return {windows:merged,times:merged.flatMap(window=>auditSampleTimes(window.start,window.end,interval)),
    durationSeconds:merged.reduce((sum,window)=>sum+window.end-window.start,0)};
}
export interface DenseGeometryObservation {
  time:number;origin:'base'|'window'|'micro';raw:TeachingFrame;frame:TeachingFrame;
  sample:ActualJointSample;audit:GeometryFrameAudit;
}
export function auditDenseTeachingMotion(program:TeachingMotion,options:{intervalSeconds?:number;diagnosticSpeedMetresPerSecond?:number;checkGeometry?:boolean;geometryRefinementIntervalSeconds?:number;geometryRefinementWindows?:GeometryRefinementWindow[];observeSample?:(sample:ActualJointSample)=>void;observeGeometry?:(observation:DenseGeometryObservation)=>void}={}) {
  const started=performance.now(),interval=options.intervalSeconds??.01,speedThreshold=options.diagnosticSpeedMetresPerSecond??1;
  if(!(interval>0&&interval<=.05))throw new Error('Use a positive dense interval at most 50 ms.');
  const worstByJoint:Record<string,JointMotionDiagnostic>={},worstByPhase:Record<string,JointMotionDiagnostic>={},topVelocityEvents:JointMotionDiagnostic[]=[];
  const geometry={samples:0,passed:true,confirmedCounts:{} as Partial<Record<GeometryIssueKind,number>>,
    possibleCubeContacts:0,possibleFingerContacts:0,possibleFingerPalmContacts:0,possiblePalmContacts:0,possibleArmContacts:0,possibleArmArmContacts:0,possibleArmHandContacts:0,
    firstFailure:undefined as {time:number;step:number;phase:string;issue:GeometryIssue}|undefined,
    worst:{} as Partial<Record<GeometryIssueKind,{time:number;step:number;phase:string;issue:GeometryIssue}>>};
  const targetedCounts:{}&Partial<Record<GeometryIssueKind,number>>={},checkedTimes=new Set<string>();
  const speedWindows:GeometryRefinementWindow[]=[];
  let geometryMilliseconds=0,windowGeometrySamples=0,microGeometrySamples=0;
  const evaluate=(time:number)=> {
    const raw=sampleTeachingMotion(program,time),frame=fitTeachingFrame(raw);
    const sample:ActualJointSample={time,step:frame.step,phase:frame.phase,fingers:solveTeachingPose(frame.pose,frame),arms:solveTeachingArms(frame.pose,frame)};
    options.observeSample?.(sample);return {raw,frame,sample};
  };
  const checkGeometry=(value:ReturnType<typeof evaluate>,origin:'base'|'window'|'micro')=> {
    if(!options.checkGeometry)return;
    const {raw,frame,sample}=value,time=sample.time,key=time.toFixed(10);
    if(checkedTimes.has(key))return;
    checkedTimes.add(key);const started=performance.now();
    let lo=0,hi=program.segments.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(program.segments[mid].start<=time)lo=mid;else hi=mid-1;}
    const audit=auditEvaluatedFrame(frame,sample.fingers,sample.arms,{gripHands:raw.complete?undefined:program.segments[lo]?.wristHands});
    geometryMilliseconds+=performance.now()-started;geometry.samples++;
    options.observeGeometry?.({time,origin,raw,frame,sample,audit});
    if(origin==='window')windowGeometrySamples++;
    if(origin==='micro')microGeometrySamples++;
    for(const kind of ['possibleCubeContacts','possibleFingerContacts','possibleFingerPalmContacts','possiblePalmContacts','possibleArmContacts','possibleArmArmContacts','possibleArmHandContacts'] as const)geometry[kind]+=audit[kind];
    for(const issue of audit.confirmed) {
      geometry.passed=false;geometry.confirmedCounts[issue.kind]=(geometry.confirmedCounts[issue.kind]??0)+1;
      if(origin!=='base')targetedCounts[issue.kind]=(targetedCounts[issue.kind]??0)+1;
      const observation={time,step:raw.step,phase:raw.phase,issue};
      if(!geometry.firstFailure||time<geometry.firstFailure.time)geometry.firstFailure=observation;
      if(!geometry.worst[issue.kind]||issue.depthMetres>geometry.worst[issue.kind]!.issue.depthMetres)geometry.worst[issue.kind]=observation;
    }
  };
  let previous:ActualJointSample|undefined,samples=0,candidateCount=0,firstCandidate:JointMotionDiagnostic|undefined;
  for(const time of auditSampleTimes(0,program.duration,interval)) {
    const value=evaluate(time),current=value.sample;samples++;checkGeometry(value,'base');
    let speedTriggered=false;
    if(previous)for(const diagnostic of jointMotionDiagnostics(previous,current)) {
      const key=`${diagnostic.hand}/${diagnostic.part}/${diagnostic.finger??'arm'}/${diagnostic.joint}`;
      if(!worstByJoint[key]||diagnostic.speedMetresPerSecond>worstByJoint[key].speedMetresPerSecond)worstByJoint[key]=diagnostic;
      if(!worstByPhase[diagnostic.phase]||diagnostic.speedMetresPerSecond>worstByPhase[diagnostic.phase].speedMetresPerSecond)worstByPhase[diagnostic.phase]=diagnostic;
      if(topVelocityEvents.length<5||diagnostic.speedMetresPerSecond>topVelocityEvents.at(-1)!.speedMetresPerSecond) {
        topVelocityEvents.push(diagnostic);topVelocityEvents.sort((a,b)=>b.speedMetresPerSecond-a.speedMetresPerSecond);topVelocityEvents.length=Math.min(5,topVelocityEvents.length);
      }
      if(diagnostic.speedMetresPerSecond>speedThreshold) {candidateCount++;firstCandidate??=diagnostic;speedTriggered=true;}
    }
    if(previous&&speedTriggered)speedWindows.push({start:previous.time,end:time,reason:'speed-trigger'});
    previous=current;
  }
  const baseGeometry={samples:geometry.samples,passed:geometry.passed,confirmedCounts:{...geometry.confirmedCounts}};
  const baseElapsedMilliseconds=performance.now()-started,refinementStarted=performance.now();
  const plan=planGeometryRefinement([...speedWindows,...(options.geometryRefinementWindows??[])],program.duration,options.geometryRefinementIntervalSeconds??.001);
  // Existing 10 ms endpoints have already been checked. Only the short triggered
  // windows add 1 ms geometry; the rest of each formula retains the base cadence.
  if(options.checkGeometry)for(const time of plan.times)if(!checkedTimes.has(time.toFixed(10)))checkGeometry(evaluate(time),'window');
  const refinements=new Map<number,ActualJointSample>();
  const refinedCandidates=Object.values(worstByJoint).filter(diagnostic=>diagnostic.speedMetresPerSecond>speedThreshold).map(diagnostic=>refineJointMotionDiagnostic(diagnostic,time=> {
    let sample=refinements.get(time);
    if(!sample) {
      const value=evaluate(time);sample=value.sample;refinements.set(time,sample);
      // These joint samples already exist for continuity diagnosis: check their
      // actual rigid bodies as well, rather than silently ignoring collisions.
      checkGeometry(value,'micro');
    }
    return diagnostic.part==='finger'
      ?sample.fingers.find(value=>value.hand===diagnostic.hand&&value.finger===diagnostic.finger)!.joints[diagnostic.joint]
      :sample.arms.find(value=>value.hand===diagnostic.hand)![(['shoulder','elbow','wrist'] as const)[diagnostic.joint]];
  }));
  return {formulaId:program.formulaId,samples,intervalSeconds:interval,diagnosticSpeedMetresPerSecond:speedThreshold,candidateCount,firstCandidate,
    worstByJoint,worstByPhase,topVelocityEvents,maximumSpeedMetresPerSecond:Math.max(0,...Object.values(worstByJoint).map(value=>value.speedMetresPerSecond)),refinedCandidates,refinementSamples:refinements.size,
    abruptAtTenMicrosecondsCount:refinedCandidates.filter(value=>value.abruptAtTenMicroseconds).length,
    geometry:options.checkGeometry?geometry:undefined,
    targetedGeometry:options.checkGeometry?{intervalSeconds:options.geometryRefinementIntervalSeconds??.001,speedTriggerMetresPerSecond:speedThreshold,
      speedTriggerIntervals:speedWindows.length,explicitWindows:options.geometryRefinementWindows??[],windows:plan.windows,windowDurationSeconds:plan.durationSeconds,
      windowGeometrySamples,microGeometrySamples,additionalGeometrySamples:windowGeometrySamples+microGeometrySamples,confirmedCounts:targetedCounts,baseGeometry,
      baseElapsedMilliseconds,refinementElapsedMilliseconds:performance.now()-refinementStarted,totalGeometryMilliseconds:geometryMilliseconds}:undefined,
    elapsedMilliseconds:performance.now()-started,
    limits:['A speed over 1 m/s only triggers targeted evidence collection; it is not itself a collision, hardware feasibility, or teaching-naturalness failure.','Every base interval containing a speed candidate is merged with adjacent intervals and checked at at most 1 ms spacing. Explicit known counterexample windows can also be requested.','Each worst joint candidate is bisected toward its largest displacement until its interval is at most 10 microseconds; these evaluated points also receive complete geometry checks. A remaining displacement over 0.5 mm is reported separately from smooth fast movement.','Dense and targeted discrete sampling can still miss motion between samples; low-speed intervals and sub-millisecond events are not continuously proved clear.']};
}
