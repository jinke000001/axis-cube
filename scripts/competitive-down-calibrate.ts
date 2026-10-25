/** Bounded competitive ring/little D calibration. Accepted source libraries remain read-only. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Box3, Group, Matrix4, Mesh, Quaternion, Ray, Triangle, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { DexterousHand } from "../src/scene/hand";
import { MechanicalArm, ARM_LENGTHS, WRIST_LENGTH } from "../src/scene/arm";
import { CENTER, type Side } from "../src/scene/motion";
import { fitFinger, forwardFinger, fingerJoints, type FingerIndex } from "../src/scene/finger-rig";
import { hasMeasuredSupport, measureContact, type FingerContact } from "../src/scene/finger-contact";
import { parseMove } from "../src/core/cube";
import { fingerLibrary, handPose, rotatedFingerPose, strokeSample, withFinger, fingerContacts, type PoseData } from "../src/scene/finger-data";

Object.assign(globalThis, { DOMParser, Document, Element });
type Contact = { finger: FingerIndex; target: number[]; normal: number[]; padOffset: number[] };
type Pose = { position: number[]; quaternion: number[]; joints: Record<string, number> };
type Grip = { pose: Pose; contacts: Contact[] };
const arg = (name: string, fallback: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const input = arg("--grips", "src/scene/finger-grips.json");
const label = arg("--label", input.includes("fixed") ? "fixed" : "base");
const intervals = Number(arg("--samples", "64"));
const source = JSON.parse(readFileSync(input, "utf8"));
const sides: Side[] = ["left", "right"];
const grip = {} as Record<Side, Grip>;
for (const side of sides) {
  const data = Array.isArray(source.hands) ? source.hands.find((h: any) => h.side === side) : source.hands[side];
  grip[side] = {
    pose: {
      position: data.position ?? data.wrist.position,
      quaternion: data.quaternion ?? data.wrist.quaternion,
      joints: data.joints ?? Object.fromEntries(data.fingers.flatMap((f: any) => f.angles.map((a: number, j: number) => [`${side}_finger${f.finger}_joint${j + 1}`, a]))),
    },
    contacts: data.fingers ? data.fingers.map((f: any) => ({ finger: f.finger, target: f.target, normal: f.normal, padOffset: f.padOffset })) : data.contacts.map((c: any) => ({ finger: c.finger, target: c.target, normal: c.normal, padOffset: c.padLocalOffset ?? c.padOffset })),
  };
}
const hands = {} as Record<Side, DexterousHand>, arms = {} as Record<Side, MechanicalArm>;
const meshes = {} as Record<Side, Mesh[]>, fingers = {} as Record<Side, Mesh[][]>;
const serialize = (v: Vector3) => v.toArray();
const point = new Vector3(), temp = new Vector3();
const assetFiles = new Set<string>();
for (const side of sides) {
  const directory = resolve("public/models/wuji/hand/body/urdf");
  const loader = new URDFLoader(); loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, done) => {
    assetFiles.add(url);
    const bytes = readFileSync(url), geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.deleteAttribute("normal");
    const merged = mergeVertices(geometry, 1e-6); geometry.dispose();
    merged.computeBoundingBox(); done(new Mesh(merged, material));
  };
  assetFiles.add(`${directory}/${side}.urdf`);
  hands[side] = new DexterousHand(loader.parse(readFileSync(`${directory}/${side}.urdf`, "utf8"), directory + "/"), side);
  arms[side] = new MechanicalArm(side);
  meshes[side] = []; hands[side].robot.traverse((node) => { if (node instanceof Mesh) meshes[side].push(node); });
  fingers[side] = Array.from({ length: 5 }, (_, i) => {
    const nodes: Mesh[] = []; hands[side].robot.links[`${side}_finger${i + 1}_link1`].traverse((node) => { if (node instanceof Mesh) nodes.push(node); }); return nodes;
  });
}
function apply(side: Side, pose: Pose) {
  hands[side].root.position.fromArray(pose.position); hands[side].root.quaternion.fromArray(pose.quaternion);
  hands[side].robot.setJointValues(pose.joints); hands[side].root.updateMatrixWorld(true);
  arms[side].update(hands[side].root.position, hands[side].root.quaternion); arms[side].root.updateMatrixWorld(true);
}
function current(side: Side): Pose {
  return { position: serialize(hands[side].root.position), quaternion: hands[side].root.quaternion.toArray(), joints: Object.fromEntries(Object.entries(hands[side].robot.joints).filter(([, j]) => j.jointType !== "fixed").map(([name, j]) => [name, j.angle])) };
}
function wristTurn(side: Side, angle: number): Pose {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle), base = grip[side].pose;
  return { position: serialize(new Vector3().fromArray(base.position).sub(CENTER).applyQuaternion(q).add(CENTER)), quaternion: q.clone().multiply(new Quaternion().fromArray(base.quaternion)).toArray(), joints: { ...base.joints } };
}
function cubeDepth(p: Vector3, normal: Vector3, angle: number) {
  const box = (p: Vector3) => Math.min(0.045 - Math.abs(p.x), 0.045 - Math.abs(p.y), 0.045 - Math.abs(p.z));
  const fixed = Math.min(box(p), 0.015 - p.dot(normal));
  temp.copy(p).applyAxisAngle(normal, -angle);
  return Math.max(fixed, Math.min(box(temp), temp.dot(normal) - 0.015));
}
function intoCube(nodes: Mesh[], normal: Vector3, angle: number) {
  let depthMM = 0, vertices = 0, link = "";
  for (const mesh of nodes) {
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(CENTER);
      const depth = cubeDepth(point, normal, angle) * 1000;
      if (depth > 0.3) vertices++;
      if (depth > depthMM) { depthMM = depth; link = mesh.parent?.parent?.name ?? ""; }
    }
  }
  return { depthMM, vertices, link };
}
function uSweep(nodes: Mesh[]) {
  let depthMM = 0, link = "", witness = [0, 0, 0];
  for (const mesh of nodes) {
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(CENTER);
      const lower = Math.min(0.045 - Math.abs(point.x), 0.045 - Math.abs(point.z), point.y + 0.045, 0.015 - point.y);
      const upper = Math.min(0.045 - Math.hypot(point.x, point.z) / Math.sqrt(2), point.y - 0.015, 0.045 - point.y);
      const depth = Math.max(lower, upper) * 1000;
      if (depth > depthMM) { depthMM = depth; link = mesh.parent?.parent?.name ?? ""; witness = serialize(point); }
    }
  }
  return { depthMM, link, witness };
}
const armLinks = sides.flatMap((side) => (["upper", "fore"] as const).map((part) => {
  const root = arms[side].root.getObjectByName(`${side}-${part === "upper" ? "upper-arm" : "forearm"}`) as Group;
  const nodes: Mesh[] = []; root.traverse((node) => { if (node instanceof Mesh) nodes.push(node); });
  return { side, part, root, length: ARM_LENGTHS[part], nodes, box: new OBB(), inverse: new Matrix4() };
}));
const armMeshes = sides.flatMap((side) => { const nodes: Mesh[] = []; arms[side].root.traverse((node) => { if (node instanceof Mesh) nodes.push(node); }); return nodes; });
const meshOBB = new OBB(), matrix = new Matrix4(), local = new Vector3();
function bodyDepth(p: Vector3, length: number) {
  const radius = 0.008;
  local.set(Math.abs(p.x) - (0.047 / 2 - radius), Math.abs(p.y) - (length * 0.77 / 2 - radius), Math.abs(p.z) - (0.041 / 2 - radius));
  const shell = radius - (Math.hypot(Math.max(local.x, 0), Math.max(local.y, 0), Math.max(local.z, 0)) + Math.min(Math.max(local.x, local.y, local.z), 0));
  const half = (length - 0.028) / 2, taper = 0.025 - 0.004 * (p.y + half) / (2 * half);
  return Math.max(shell, Math.min(half - Math.abs(p.y), taper - Math.hypot(p.x, p.z)));
}
function meshIntoLink(mesh: Mesh, link: typeof armLinks[number]) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  meshOBB.fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  if (!meshOBB.intersectsOBB(link.box)) return 0;
  matrix.copy(link.inverse).multiply(mesh.matrixWorld);
  const positions = mesh.geometry.getAttribute("position"); let depthMM = 0;
  for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i).applyMatrix4(matrix); depthMM = Math.max(depthMM, bodyDepth(point, link.length) * 1000); }
  return depthMM;
}
function armCheck(normal: Vector3, angle: number) {
  let handDepthMM = 0, handWitness = "", crossArmDepthMM = 0, reachErrorMM = 0;
  for (const link of armLinks) {
    link.box.fromBox3(new Box3(new Vector3(-0.03, -link.length / 2, -0.035), new Vector3(0.03, link.length / 2, 0.035))).applyMatrix4(link.root.matrixWorld);
    link.inverse.copy(link.root.matrixWorld).invert();
  }
  for (const link of armLinks) {
    for (const side of sides) for (const mesh of meshes[side]) {
      const depth = meshIntoLink(mesh, link);
      if (depth > handDepthMM) { handDepthMM = depth; handWitness = `${mesh.parent?.parent?.name} into ${link.side}-${link.part}`; }
    }
    for (const other of armLinks.filter((other) => other.side !== link.side)) for (const mesh of other.nodes) crossArmDepthMM = Math.max(crossArmDepthMM, meshIntoLink(mesh, link));
  }
  for (const side of sides) {
    const origin = new Vector3(side === "left" ? -0.355 : 0.355, 0.155, -0.09);
    reachErrorMM = Math.max(reachErrorMM, Math.abs(arms[side].elbowPosition.distanceTo(origin) - ARM_LENGTHS.upper) * 1000, Math.abs(arms[side].elbowPosition.distanceTo(arms[side].wristPosition) - ARM_LENGTHS.fore) * 1000);
  }
  return { handDepthMM, handWitness, crossArmDepthMM, reachErrorMM, armCube: intoCube(armMeshes, normal, angle) };
}
const ray = new Ray(), triangle = new Triangle(), closest = new Vector3(), hit = new Vector3(), direction = new Vector3(1, 0.371, 0.219).normalize();
function mutualHands(first = meshes.left, second = meshes.right) {
  let depthMM = 0, overlaps = 0, witness: string[] = [];
  const bounds = new Map<Mesh, Box3>();
  for (const mesh of [...first, ...second]) bounds.set(mesh, mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
  function contained(a: Mesh, b: Mesh) {
    const matrix = b.matrixWorld.clone().invert().multiply(a.matrixWorld), src = a.geometry.getAttribute("position"), dst = b.geometry.getAttribute("position"), index = b.geometry.index, count = index?.count ?? dst.count;
    let max = 0;
    for (let i = 0; i < src.count; i++) {
      const p = new Vector3().fromBufferAttribute(src, i).applyMatrix4(matrix);
      if (!b.geometry.boundingBox!.containsPoint(p)) continue;
      ray.set(p, direction); const hits: number[] = [];
      for (let j = 0; j < count; j += 3) {
        triangle.a.fromBufferAttribute(dst, index ? index.getX(j) : j); triangle.b.fromBufferAttribute(dst, index ? index.getX(j + 1) : j + 1); triangle.c.fromBufferAttribute(dst, index ? index.getX(j + 2) : j + 2);
        if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) hits.push(hit.distanceToSquared(p));
      }
      hits.sort((a, b) => a - b);
      if (hits.filter((d, j) => !j || Math.abs(d - hits[j - 1]) > 1e-11).length % 2 === 0) continue;
      let d = Infinity;
      for (let j = 0; j < count; j += 3) {
        triangle.a.fromBufferAttribute(dst, index ? index.getX(j) : j); triangle.b.fromBufferAttribute(dst, index ? index.getX(j + 1) : j + 1); triangle.c.fromBufferAttribute(dst, index ? index.getX(j + 2) : j + 2);
        triangle.closestPointToPoint(p, closest); d = Math.min(d, p.distanceToSquared(closest));
      }
      max = Math.max(max, Math.sqrt(d) * 1000);
    }
    return max;
  }
  for (const a of first) for (const b of second) if (bounds.get(a)!.intersectsBox(bounds.get(b)!)) {
    overlaps++; const depth = Math.max(contained(a, b), contained(b, a));
    if (depth > depthMM) { depthMM = depth; witness = [a.parent?.parent?.name ?? "", b.parent?.parent?.name ?? ""]; }
  }
  return { depthMM, overlaps, witness };
}
function selfCheck(side: Side) {
  let depthMM = 0, witness: string[] = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    const check = mutualHands(fingers[side][a], fingers[side][b]);
    if (check.depthMM > depthMM) { depthMM = check.depthMM; witness = check.witness; }
  }
  return { depthMM, witness };
}
function limitFailures(pose: Pose, side: Side) {
  return ([1, 2, 3, 4, 5] as FingerIndex[]).flatMap((finger) => fingerJoints(side, finger).filter((j) => pose.joints[j.name] < j.lower - 1e-8 || pose.joints[j.name] > j.upper + 1e-8).map((j) => j.name));
}
function blend(a: Pose, b: Pose, t: number): Pose {
  return { position: new Vector3().fromArray(a.position).lerp(new Vector3().fromArray(b.position), t).toArray(), quaternion: new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion), t).toArray(), joints: Object.fromEntries(Object.keys(a.joints).map((k) => [k, a.joints[k] + (b.joints[k] - a.joints[k]) * t])) };
}

const Z=new Vector3(0,-1,0), X=new Vector3(1,0,0), identity=new Quaternion();
const mode=arg("--mode","reach");
const pathData=JSON.parse(readFileSync("src/scene/finger-paths.json","utf8"));
const retreat=Number(arg("--retreat","0.04"));
const pads={} as Record<Side,Triangle[][]>;
for(const side of sides){
  hands[side].root.updateMatrixWorld(true);
  pads[side]=Array.from({length:5},(_,f)=>{
    const tip=hands[side].robot.links[`${side}_finger${f+1}_tip_link`],triangles:Triangle[]=[];
    tip.traverse(node=>{if(!(node instanceof Mesh))return;
      const transform=tip.matrixWorld.clone().invert().multiply(node.matrixWorld),vertices=node.geometry.getAttribute('position'),indices=node.geometry.index,count=indices?.count??vertices.count;
      for(let i=0;i<count;i+=3)triangles.push(new Triangle(...[0,1,2].map(j=>new Vector3().fromBufferAttribute(vertices,indices?indices.getX(i+j):i+j).applyMatrix4(transform)) as [Vector3,Vector3,Vector3]));
    });return triangles;
  });
}
function surfacePad(side:Side,finger:FingerIndex,target:Vector3,normal:Vector3){
  let extreme=Infinity,distance=Infinity;const best=new Vector3(),point=new Vector3();
  for(const triangle of pads[side][finger-1])for(const vertex of [triangle.a,triangle.b,triangle.c])if(vertex.dot(normal)<extreme){extreme=vertex.dot(normal);best.copy(vertex);}
  for(const triangle of pads[side][finger-1]){triangle.closestPointToPoint(target,point);if(point.dot(normal)>extreme+.00005)continue;const d=point.distanceToSquared(target);if(d<distance){distance=d;best.copy(point);}}
  return best;
}
function fitPad(side:Side,finger:FingerIndex,target:Vector3,normal:Vector3,initial:number[],seed:Vector3){
  const wrist={position:hands[side].root.position.clone(),quaternion:hands[side].root.quaternion.clone()};let angles=initial.slice(),offset=seed.clone();
  for(let i=0;i<8;i++){
    const fit=fitFinger({side,finger,position:target,initial:angles,wrist,padOffset:offset,tolerance:.000015,iterations:100});angles=fit.angles;
    const fk=forwardFinger(side,finger,angles,wrist),inverse=fk.quaternion.clone().invert();
    offset=surfacePad(side,finger,target.clone().sub(fk.position).applyQuaternion(inverse),normal.clone().applyQuaternion(inverse));
  }
  const fit=fitFinger({side,finger,position:target,initial:angles,wrist,padOffset:offset,tolerance:.000015,iterations:100});
  fingerJoints(side,finger).forEach((j,k)=>hands[side].robot.setJointValue(j.name,fit.angles[k]));hands[side].root.updateMatrixWorld(true);
  return {angles:fit.angles,errorMM:fit.error*1000,padOffset:offset};
}
function serialPose(p:ReturnType<typeof handPose>):Pose{return {position:p.position.toArray(),quaternion:p.quaternion.toArray(),joints:{...p.joints}};}
function serialContact(c:FingerContact){return {...c,point:c.point.toArray(),normal:c.normal.toArray(),padOffset:c.padOffset.toArray()};}

const supportData=JSON.parse(readFileSync('evidence/finger-down-primitives.json','utf8'));
const supportPoses={left:supportData.hands.left.support.pose,right:supportData.hands.right.support.pose} as Record<Side,Pose>;
const supportContacts=Object.fromEntries(sides.map(side=>[side,supportData.hands[side].support.contacts.map((c:any)=>({...c,point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)}))])) as Record<Side,FingerContact[]>;
const wristX=Number(arg('--x','0.08')),wristZ=Number(arg('--z','0.12'));
const poseData=(side:Side,dy:number):Pose=>({...structuredClone(fingerLibrary.hands[side].support),position:[side==='left'?-wristX:wristX,CENTER.y+dy,wristZ],joints:{...fingerLibrary.hands[side].active.joints}});
const setFinger=(pose:Pose,side:Side,finger:FingerIndex,angles:number[])=>{fingerJoints(side,finger).forEach((j,i)=>pose.joints[j.name]=angles[i]);return pose;};
function candidate(side:Side,finger:FingerIndex,dy:number,steps:number,backwards=false){
 const sign=side==='right'?1:-1,other:Side=side==='right'?'left':'right',pose=poseData(side,dy),entry=fingerLibrary.hands[side].gripContacts.find(c=>c.finger===finger)!;
 const initialPoint=new Vector3(sign*(finger===4?.032:.035),-.0452,-.020),direction=sign*(backwards?-1:1),endAngle=direction*Math.PI/2;
 if(backwards)initialPoint.applyAxisAngle(Z,sign*Math.PI/2);
 let angles=fingerJoints(side,finger).map(j=>fingerLibrary.hands[side].grip.joints[j.name]),offset=new Vector3().fromArray(entry.padOffset);
 const samples:any[]=[],maximum={errorMM:0,cubeMM:0},firstFailure:any[]=[];
 for(let i=0;i<=steps;i++){
  const phase=i/steps,angle=endAngle*phase,target=initialPoint.clone().applyAxisAngle(Z,angle).add(CENTER);
  apply(side,setFinger(pose,side,finger,angles));apply(other,supportPoses[other]);
  let fit=fitPad(side,finger,target,Z,angles,offset);
  if(fit.errorMM>.3){for(const seed of [[.35,sign*-.09,.75,.8],[.8,0,.8,.8]]){const trial=fitPad(side,finger,target,Z,seed,offset);if(trial.errorMM<fit.errorMM)fit=trial;}}
  angles=fit.angles;offset=fit.padOffset;apply(side,setFinger(pose,side,finger,angles));
  const cube=intoCube(meshes[side],Z,angle);
  maximum.errorMM=Math.max(maximum.errorMM,fit.errorMM);maximum.cubeMM=Math.max(maximum.cubeMM,cube.depthMM);
  if((fit.errorMM>.3||cube.depthMM>.3)&&!firstFailure.length)firstFailure.push({phase,angle,errorMM:fit.errorMM,cube,angles});
  samples.push({phase,angle,target:target.toArray(),normal:Z.toArray(),padLocalOffset:offset.toArray(),pose:current(side),errorMM:fit.errorMM,cubeMM:cube.depthMM});
 }
 const result={id:`${side}-${finger}-${dy}${backwards?'-reverse':''}`,side,finger,dy,backwards,angle:endAngle,point:initialPoint.toArray(),normal:Z.toArray(),maximum,reachable:maximum.errorMM<=.3,clear:maximum.cubeMM<=.3,firstFailure:firstFailure[0]??null,samples};
 console.log(JSON.stringify({...result,samples:undefined}));return result;
}
const requested=arg('--side','both'),chosenFinger=Number(arg('--finger','4')),chosenDY=Number(arg('--dy','-0.03')),chosenSteps=Number(arg('--steps','16')),chosenReverse=process.argv.includes('--reverse'),chosenSides=sides.filter(side=>requested==='both'||side===requested),results:any[]=[];
for(const side of chosenSides)results.push(candidate(side,chosenFinger as FingerIndex,chosenDY,chosenSteps,chosenReverse));
const sources=['scripts/competitive-down-calibrate.ts','src/scene/finger-rig.ts','src/scene/finger-rig.json','src/scene/finger-data.ts','src/scene/finger-library.json','src/scene/finger-contact.ts','src/scene/motion.ts','src/scene/hand.ts','src/scene/arm.ts','src/core/cube.ts','evidence/finger-down-primitives.json',...assetFiles].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const output=`evidence/competitive-down-calibrate-${chosenFinger}-y${chosenDY}-x${wristX}-z${wristZ}-${requested}${chosenReverse?'-reverse':''}-${chosenSteps}.json`;
writeFileSync(output,JSON.stringify({date:new Date().toISOString(),scope:'Bounded ring/little bottom-face FK/IK and active STL/cube contact probe; reachability does not imply self/interhand/arm or full entry/exit clearance.',thresholdMM:.3,sources,results},null,2)+'\n');
console.log(JSON.stringify({output,candidates:results.length,reachable:results.filter(r=>r.reachable).length,reachableAndCubeClear:results.filter(r=>r.reachable&&r.clear).length}));
