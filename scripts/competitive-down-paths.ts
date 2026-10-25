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
const mode=arg("--mode","strokes");
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


const inputPaths={4:'evidence/competitive-down-calibrate-4-y-0.03-x0.08-z0.12-both-64.json',5:'evidence/competitive-down-calibrate-5-y-0.015-x0.08-z0.12-both-64.json'};
const records=Object.fromEntries(Object.entries(inputPaths).map(([finger,path])=>[finger,JSON.parse(readFileSync(path,'utf8')).results]));
const supportInput='evidence/finger-down-primitives.json',supportData=JSON.parse(readFileSync(supportInput,'utf8'));
const asContacts=(data:any[])=>data.map(c=>({...c,point:new Vector3().fromArray(c.point),normal:new Vector3().fromArray(c.normal),padOffset:new Vector3().fromArray(c.padOffset)})) as FingerContact[];
const supports=Object.fromEntries(sides.map(side=>[side,{pose:supportData.hands[side].support.pose as Pose,contacts:asContacts(supportData.hands[side].support.contacts)}])) as Record<Side,{pose:Pose,contacts:FingerContact[]}>;
const selfCache=new Map<string,ReturnType<typeof selfCheck>>();
function cachedSelf(side:Side){const key=side+JSON.stringify(current(side).joints);if(!selfCache.has(key))selfCache.set(key,selfCheck(side));return selfCache.get(key)!;}
function geometry(contacts:FingerContact[],angle=0,turning=false){
 const move=turning?parseMove(angle<=0?'D':"D'"):undefined,poses={left:handPose(current('left')),right:handPose(current('right'))};
 const cube={left:intoCube(meshes.left,Z,angle),right:intoCube(meshes.right,Z,angle)},mutual=mutualHands(),arm=armCheck(Z,angle),self={left:cachedSelf('left'),right:cachedSelf('right')};
 const maximum={cubeMM:Math.max(cube.left.depthMM,cube.right.depthMM),mutualMM:mutual.depthMM,selfMM:Math.max(self.left.depthMM,self.right.depthMM),handArmMM:arm.handDepthMM,crossArmMM:arm.crossArmDepthMM,armCubeMM:arm.armCube.depthMM,contactMM:Math.max(...contacts.map(c=>measureContact(poses[c.side],c,move,angle).error*1000)),reachMM:arm.reachErrorMM};
 const supportPassed=hasMeasuredSupport(poses,contacts,move,angle),badContact=contacts.some(c=>!measureContact(poses[c.side],c,move,angle).valid),limits=sides.flatMap(side=>limitFailures(current(side),side));
 return {passed:supportPassed&&!badContact&&!limits.length&&Object.values(maximum).every(v=>v<=.3),maximum,supportPassed,badContact,limits,cube,mutual,arm,self};
}
const setFinger=(pose:Pose,side:Side,finger:FingerIndex,angles:number[])=>{fingerJoints(side,finger).forEach((j,i)=>pose.joints[j.name]=angles[i]);return pose;};
const freed=(pose:Pose,side:Side,finger:FingerIndex)=>setFinger(structuredClone(pose),side,finger,fingerLibrary.hands[side].freeAngles[finger]);
const shifted=(pose:Pose,axis:number,amount:number)=>{const result=structuredClone(pose);result.position[axis]+=amount;return result;};
function sampleRecord(record:any,p:number){const x=p*(record.samples.length-1),a=Math.floor(x),b=Math.min(record.samples.length-1,a+1),t=x-a,A=record.samples[a],B=record.samples[b];return {pose:blend(A.pose,B.pose,t),angle:A.angle+(B.angle-A.angle)*t,padOffset:new Vector3().fromArray(A.padLocalOffset).lerp(new Vector3().fromArray(B.padLocalOffset),t)};}
function full(side:Side,double:boolean,strokesOnly=false){
 const other:Side=side==='left'?'right':'left',sign=side==='right'?1:-1,ring=records[4].find((r:any)=>r.side===side),little=records[5].find((r:any)=>r.side===side);
 const poses:Record<Side,Pose>={left:structuredClone(fingerLibrary.hands.left.support),right:structuredClone(fingerLibrary.hands.right.support)};
 const lowContacts=Object.fromEntries(sides.map(s=>[s,fingerContacts(s,fingerLibrary.hands[s].contacts)])) as Record<Side,FingerContact[]>;
 const segments:any[]=[],maximum:Record<string,number>={},boundaries:any[]=[];let angle=0;
 function part(id:string,active:Side,sampler:(p:number)=>Pose,contacts:FingerContact[],angleAt:(p:number)=>number=()=>angle,finger?:FingerIndex){
  const frames:any[]=[],before=structuredClone(poses),stage=finger?'TURN':'PREPARE';
  for(let i=0;i<=intervals;i++){
   const p=i/intervals;poses[active]=sampler(p);for(const s of sides)apply(s,poses[s]);
   const cubeAngle=angleAt(p),check=geometry(contacts,cubeAngle,!!finger);for(const[k,v]of Object.entries(check.maximum))maximum[k]=Math.max(maximum[k]??0,v);
   frames.push({progress:p,left:current('left'),right:current('right'),contacts:contacts.map(serialContact),cubeAngle});
   if(!check.passed)return {id,stage,active,finger,passed:false,frames,before,firstFailure:{progress:p,...check}};
  }
  const last=segments.at(-1)?.frames.at(-1);if(last){for(const s of sides){const now=frames[0],delta={positionMM:new Vector3().fromArray(last[s].position).distanceTo(new Vector3().fromArray(now[s].position))*1000,angle:new Quaternion().fromArray(last[s].quaternion).angleTo(new Quaternion().fromArray(now[s].quaternion)),joint:Math.max(...Object.keys(last[s].joints).map(k=>Math.abs(last[s].joints[k]-now[s].joints[k])))};boundaries.push({id,side:s,...delta});if(delta.positionMM>1e-6||delta.angle>1e-6||delta.joint>1e-7)throw new Error('discontinuous '+id+' '+s);}}
  for(let i=0;i<frames.length-1;i++){
   const a=frames[i],b=frames[i+1];for(const s of sides)apply(s,blend(a[s],b[s],.5));
   const cs=asContacts(a.contacts).map((c,j)=>({...c,padOffset:c.padOffset.lerp(new Vector3().fromArray(b.contacts[j].padOffset),.5)}));
   const check=geometry(cs,(a.cubeAngle+b.cubeAngle)/2,!!finger);for(const[k,v]of Object.entries(check.maximum))maximum[k]=Math.max(maximum[k]??0,v);
   if(!check.passed)return {id,stage,active,finger,passed:false,frames,before,firstFailure:{progress:(i+.5)/intervals,interpolation:true,...check}};
  }
  for(const s of sides)apply(s,poses[s]);return {id,stage,active,finger,passed:true,frames};
 }
 function push(...args:Parameters<typeof part>){const r=part(...args);segments.push(r);console.log(JSON.stringify({case:side+(double?'-double':'-single'),segment:r.id,passed:r.passed,failure:r.firstFailure?{progress:r.firstFailure.progress,maximum:r.firstFailure.maximum,cube:r.firstFailure.cube,self:r.firstFailure.self,mutual:r.firstFailure.mutual,arm:r.firstFailure.arm.handWitness}:null}));return r.passed;}
 const moveTo=(id:string,active:Side,target:Pose,cs:FingerContact[])=>{const before=structuredClone(poses[active]);return push(id,active,p=>blend(before,target,p),cs);};
 const held=supports[other].contacts;
 function turn(record:any,n:number,overlap=false){
  const offset=angle,initialPoint=new Vector3().fromArray(record.point).applyAxisAngle(Z,-offset),drive:FingerContact={side,finger:record.finger,role:'drive',point:initialPoint,normal:Z,padOffset:new Vector3().fromArray(record.samples[0].padLocalOffset)};
  const preLittle=fingerJoints(side,5).map(j=>little.samples[0].pose.joints[j.name]),freeLittle=fingerLibrary.hands[side].freeAngles[5];
  const result=push('finger-turn-'+n,side,p=>{const sampled=sampleRecord(record,p);drive.padOffset.copy(sampled.padOffset);if(overlap){const t=Math.max(0,Math.min(1,(p-.72)/.28)),a=.5*t*t*(3-2*t);setFinger(sampled.pose,side,5,freeLittle.map((v,i)=>v+(preLittle[i]-v)*a));}return sampled.pose;},[...held,drive],p=>offset+sampleRecord(record,p).angle,record.finger);
  if(result)angle=offset+record.angle;return result;
 }
 const execute=()=>{
  if(strokesOnly){poses[other]=structuredClone(supports[other].pose);poses[side]=structuredClone(ring.samples[0].pose);return turn(ring,0,double);}
  for(const group of supportData.hands[other].supportEntry){const nodes=group.poses as Pose[];if(!push(group.id,other,p=>{const x=p*(nodes.length-1),a=Math.floor(x),b=Math.min(nodes.length-1,a+1);return blend(nodes[a],nodes[b],x-a);},lowContacts[side]))return false;}
  const original=structuredClone(poses[side]),out=shifted(original,0,sign*retreat),outFree={...structuredClone(out),joints:{...fingerLibrary.hands[side].active.joints}},ringOut=shifted(ring.samples[0].pose,0,sign*retreat);
  if(!moveTo('active-withdraw',side,out,held)||!moveTo('active-open',side,outFree,held)||!moveTo('active-position-prepare',side,ringOut,held)||!moveTo('active-seat',side,ring.samples[0].pose,held))return false;
  if(!turn(ring,0,double))return false;
  if(double){
   if(!moveTo('handover-ring-lift',side,shifted(poses[side],1,-.006),held))return false;
   if(!moveTo('handover-ring-open',side,freed(poses[side],side,4),held))return false;
   const littleAngles=fingerJoints(side,5).map(j=>little.samples[0].pose.joints[j.name]);
   if(!moveTo('handover-little-prepare',side,setFinger(structuredClone(poses[side]),side,5,littleAngles),held))return false;
   if(!moveTo('handover-little-seat',side,little.samples[0].pose,held))return false;
   if(!turn(little,1))return false;
  }
  const lastFinger=(double?5:4) as FingerIndex,base=structuredClone(poses[side]);
  if(!moveTo('release-lift',side,shifted(base,1,-.006),held)||!moveTo('release-open',side,freed(poses[side],side,lastFinger),held))return false;
  const freeBase={...structuredClone(base),joints:{...fingerLibrary.hands[side].active.joints}};
  if(!moveTo('release-raise',side,freeBase,held))return false;
  if(!moveTo('exit-withdraw',side,shifted(poses[side],0,sign*retreat),held)||!moveTo('exit-relocate',side,outFree,held)||!moveTo('exit-grip',side,out,held)||!moveTo('exit-seat',side,original,held))return false;
  for(const group of [...supportData.hands[other].supportEntry].reverse()){const nodes=[...group.poses].reverse() as Pose[];if(!push(group.id+'-return',other,p=>{const x=p*(nodes.length-1),a=Math.floor(x),b=Math.min(nodes.length-1,a+1);return blend(nodes[a],nodes[b],x-a);},lowContacts[side]))return false;}
  return true;
 };
 const passed=execute(),pathMM={left:0,right:0};for(const s of segments)for(let i=1;i<s.frames.length;i++)for(const side of sides)pathMM[side]+=new Vector3().fromArray(s.frames[i][side].position).distanceTo(new Vector3().fromArray(s.frames[i-1][side].position))*1000;
 return {id:side+(double?'-double':'-single'),notation:side==='left'?(double?'D2':'D'):(double?"D2'":"D'"),active:side,passed,maximum,pathMM,boundaries,segments,final:poses,finalAngle:angle};
}
const chosen=arg('--side','both'),double=process.argv.includes('--double'),sources=['scripts/competitive-down-paths.ts',...Object.values(inputPaths),supportInput,'src/scene/finger-rig.ts','src/scene/finger-rig.json','src/scene/finger-data.ts','src/scene/finger-library.json','src/scene/finger-contact.ts','src/scene/motion.ts','src/scene/hand.ts','src/scene/arm.ts','src/core/cube.ts',...assetFiles].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
for(const side of sides.filter(s=>chosen==='both'||s===chosen)){
 const result=full(side,double,mode==='strokes'),output=`evidence/competitive-down-${mode}-${result.id}-${intervals}.json`;
 writeFileSync(output,JSON.stringify({date:new Date().toISOString(),scope:'Actual ring/little D geometry; full mode includes original low entry/exit, all 65 nodes and 64 exported interpolation midpoints per segment.',thresholdMM:.3,sourceHashes:sources,...result},null,2)+'\n');
 console.log(JSON.stringify({output,passed:result.passed,maximum:result.maximum,pathMM:result.pathMM}));
}
