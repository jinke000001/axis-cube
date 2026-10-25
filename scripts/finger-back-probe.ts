/** Bounded fixed-cube B single-finger probe. All accepted libraries remain read-only. */
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

const Z=new Vector3(0,0,-1), X=new Vector3(1,0,0), identity=new Quaternion();
const mode=arg("--mode","turns"), supportZ=Number(arg("--support-z","0.005"));
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
function support(side:Side){
  const h=fingerLibrary.hands[side],pose=structuredClone(h.support),sign=side==='right'?1:-1;
  for(const finger of [2,3,4,5] as FingerIndex[])fingerJoints(side,finger).forEach((joint,j)=>pose.joints[joint.name]=h.freeAngles[finger][j]);
  apply(side,pose);
  const cs=fingerContacts(side,h.contacts.filter(c=>c.finger===1));
  const fits=[] as {finger:FingerIndex;target:number[];angles:number[];errorMM:number;padOffset:Vector3}[];
  for(const [finger,y] of [[2,Number(arg('--index-y','0.026'))],[3,Number(arg('--middle-y','0.005'))]] as [FingerIndex,number][]){
    const seed=h.gripContacts.find(c=>c.finger===finger)!,target=new Vector3(sign*.0452,CENTER.y+y,supportZ);
    const fit=fitPad(side,finger,target,new Vector3(sign,0,0),fingerJoints(side,finger).map(j=>h.grip.joints[j.name]),new Vector3().fromArray(seed.padOffset));
    fits.push({finger,target:target.toArray(),...fit});
    cs.push({side,finger,role:'support',point:target.clone().sub(CENTER),normal:new Vector3(sign,0,0),padOffset:fit.padOffset});
  }
  const area=cs[1].point.clone().sub(cs[0].point).cross(cs[2].point.clone().sub(cs[0].point)).length()/2;
  const maxFitErrorMM=Math.max(...fits.map(f=>f.errorMM));
  const result={side,pose:current(side),contacts:cs,fits,maxFitErrorMM,areaM2:area,sweep:{depthMM:0,phase:0,link:''}};
  for(let i=0;i<=64;i++){const depth=intoCube(meshes[side],Z,-Math.PI/2*i/64);if(depth.depthMM>result.sweep.depthMM)result.sweep={depthMM:depth.depthMM,phase:i/64,link:depth.link};}
  return {...result,passed:maxFitErrorMM<=.3&&area>.00015&&result.sweep.depthMM<=.3};
}
const supports=Object.fromEntries(sides.map(side=>[side,support(side)])) as Record<Side,ReturnType<typeof support>>;
for(const side of sides)console.log(JSON.stringify({support:side,passed:supports[side].passed,areaM2:supports[side].areaM2,errorMM:supports[side].maxFitErrorMM,sweep:supports[side].sweep}));
const selfCache=new Map<string,ReturnType<typeof selfCheck>>();
function cachedSelf(side:Side){const key=side+JSON.stringify(current(side).joints);if(!selfCache.has(key))selfCache.set(key,selfCheck(side));return selfCache.get(key)!;}
function geometry(contacts:FingerContact[],angle=0,turning=true){
  const move=turning?parseMove(angle<=0?'B':"B'"):undefined,poses={left:handPose(current('left')),right:handPose(current('right'))};
  const cube={left:intoCube(meshes.left,Z,angle),right:intoCube(meshes.right,Z,angle)},mutual=mutualHands(),arm=armCheck(Z,angle),self={left:cachedSelf('left'),right:cachedSelf('right')};
  const max={cubeMM:Math.max(cube.left.depthMM,cube.right.depthMM),mutualMM:mutual.depthMM,selfMM:Math.max(self.left.depthMM,self.right.depthMM),handArmMM:arm.handDepthMM,crossArmMM:arm.crossArmDepthMM,armCubeMM:arm.armCube.depthMM,contactMM:Math.max(...contacts.map(c=>measureContact(poses[c.side],c,move,angle).error*1000)),reachMM:arm.reachErrorMM};
  const supportPassed=hasMeasuredSupport(poses,contacts,move,angle),badContact=contacts.some(c=>!measureContact(poses[c.side],c,move,angle).valid),limits=sides.flatMap(side=>limitFailures(current(side),side));
  return {passed:supportPassed&&!badContact&&!limits.length&&Object.values(max).every(v=>v<=.3),max,supportPassed,badContact,limits,cube,mutual,arm,self};
}
function run(side:Side,roll:number){
  const other:Side=side==='right'?'left':'right',stroke=fingerLibrary.strokes[`${side}-index`],h=fingerLibrary.hands[side],q=new Quaternion().setFromAxisAngle(Z,roll*Math.PI/180).multiply(new Quaternion().setFromAxisAngle(X,-Math.PI/2));
  const initial=rotatedFingerPose(handPose(h.active),q),drivePoint=new Vector3().fromArray(stroke.samples[0].target).sub(CENTER).applyQuaternion(q);
  const frames:any[]=[],maximum:Record<string,number>={},firstFailure:any[]=[];
  for(let i=0;i<=intervals;i++){
    const p=i/intervals,sample=strokeSample(stroke,p),active=withFinger(initial,side,2,sample.angles);
    apply(side,serialPose(active));apply(other,supports[other].pose);
    const drive:FingerContact={side,finger:2,role:'drive',point:drivePoint,normal:Z,padOffset:sample.padOffset};
    const cs=[...supports[other].contacts,drive],check=geometry(cs,sample.angle);
    for(const [key,value]of Object.entries(check.max))maximum[key]=Math.max(maximum[key]??0,value);
    if(!check.passed&&!firstFailure.length)firstFailure.push({p,angle:sample.angle,...check});
    frames.push({progress:p,cubeAngle:sample.angle,cubeOrientation:[0,0,0,1],left:current('left'),right:current('right'),contacts:cs.map(serialContact)});
  }
  const result={id:`${side}-B-roll${roll}`,side,roll,notation:stroke.samples.at(-1)!.angle<0?'B':"B'",passed:!firstFailure.length,maximum,firstFailure:firstFailure[0]??null,wrist:initial.position.toArray(),q:q.toArray(),frames};
  console.log(JSON.stringify({id:result.id,passed:result.passed,maximum,firstFailure:result.firstFailure?{progress:result.firstFailure.p,mutual:result.firstFailure.mutual,arm:result.firstFailure.arm.handWitness}:null}));return result;
}

function roundTrip(side:Side,double=false){
  const other:Side=side==='right'?'left':'right',q=new Quaternion().setFromAxisAngle(X,-Math.PI/2);
  const poses:Record<Side,Pose>={left:structuredClone(fingerLibrary.hands.left.support),right:structuredClone(fingerLibrary.hands.right.support)};
  const lowContacts=Object.fromEntries(sides.map(side=>[side,fingerContacts(side,fingerLibrary.hands[side].contacts)])) as Record<Side,FingerContact[]>;
  let heldContacts=lowContacts[side],angle=0;
  const segments:any[]=[],maximum:Record<string,number>={},boundaries:any[]=[];
  const poseAt=(data:PoseData)=>serialPose(rotatedFingerPose(handPose(data),q));
  const record=pathData.strokes[`${side}-index`];
  function part(id:string,moving:Side,sampler:(p:number)=>Pose,contacts:FingerContact[],angleAt:(p:number)=>number=()=>angle,turning=false){
    const frames:any[]=[],before=structuredClone(poses),last=segments.at(-1)?.frames.at(-1);
    for(let i=0;i<=intervals;i++){
      const progress=i/intervals;poses[moving]=sampler(progress);for(const s of sides)apply(s,poses[s]);
      const cubeAngle=angleAt(progress),check=geometry(contacts,cubeAngle,turning);
      for(const [k,v]of Object.entries(check.max))maximum[k]=Math.max(maximum[k]??0,v);
      frames.push({progress,cubeAngle,turning,left:current('left'),right:current('right'),contacts:contacts.map(serialContact)});
      if(!check.passed)return {id,moving,passed:false,maximum:check.max,firstFailure:{progress,...check},frames,before};
    }
    if(last){const now=frames[0];for(const s of sides){const delta={positionMM:new Vector3().fromArray(last[s].position).distanceTo(new Vector3().fromArray(now[s].position))*1000,angle:new Quaternion().fromArray(last[s].quaternion).angleTo(new Quaternion().fromArray(now[s].quaternion)),joint:Math.max(...Object.keys(last[s].joints).map(k=>Math.abs(last[s].joints[k]-now[s].joints[k])))};boundaries.push({id,side:s,...delta});if(delta.positionMM>1e-6||delta.angle>1e-6||delta.joint>1e-7)throw new Error('discontinuous '+id+' '+s);}}
    // Re-check exact exported linear/slerp interpolation, not merely analytic midpoint.
    for(let i=0;i<frames.length-1;i++){
      const a=frames[i],b=frames[i+1];for(const s of sides)apply(s,blend(a[s],b[s],.5));
      const cs=contacts.map((c,j)=>({...c,padOffset:new Vector3().fromArray(a.contacts[j].padOffset).lerp(new Vector3().fromArray(b.contacts[j].padOffset),.5)}));
      const check=geometry(cs,(a.cubeAngle+b.cubeAngle)/2,turning);
      for(const[k,v]of Object.entries(check.max))maximum[k]=Math.max(maximum[k]??0,v);
      if(!check.passed)return {id,moving,passed:false,maximum:check.max,firstFailure:{progress:(i+.5)/intervals,interpolation:true,...check},frames,before};
    }
    for(const s of sides)apply(s,poses[s]);return {id,moving,passed:true,frames};
  }
  function push(...args:Parameters<typeof part>){const result=part(...args);segments.push(result);console.log(JSON.stringify({case:side+(double?'-double':'-single'),segment:result.id,passed:result.passed,failure:result.firstFailure?{progress:result.firstFailure.progress,max:result.firstFailure.max,cube:result.firstFailure.cube,arm:result.firstFailure.arm.handWitness,mutual:result.firstFailure.mutual}:null}));return result.passed;}
  const supportStart=structuredClone(poses[other]),supportTarget=structuredClone(supports[other].pose),supportOut=structuredClone(supportStart),supportReady=structuredClone(supportTarget);
  supportOut.position[0]+=(other==='right'?1:-1)*retreat;supportReady.position[0]=supportOut.position[0];
  const supportRoutes=[{id:'support-withdraw',a:supportStart,b:supportOut},{id:'support-shape',a:supportOut,b:supportReady},{id:'support-seat',a:supportReady,b:supportTarget}];
  const execute=()=>{
    for(const r of supportRoutes)if(!push(r.id,other,p=>blend(r.a,r.b,p),lowContacts[side]))return false;
    heldContacts=supports[other].contacts;
    const start=structuredClone(poses[side]),out=structuredClone(start);out.position[0]+=(side==='right'?1:-1)*retreat;
    const free={...structuredClone(out),joints:{...fingerLibrary.hands[side].active.joints}},target=poseAt(fingerLibrary.hands[side].active),targetOut=structuredClone(target);targetOut.position[0]+=(side==='right'?1:-1)*retreat;
    const unrotatedTarget=structuredClone(fingerLibrary.hands[side].active);unrotatedTarget.position[0]+=(side==='right'?1:-1)*retreat;
    const rotation=(p:number)=>{const partly=blend(free,unrotatedTarget,p),rotation=new Quaternion().slerp(q,p);return serialPose(rotatedFingerPose(handPose(partly),rotation));};
    const activeRoutes=[{id:'active-withdraw',sample:(p:number)=>blend(start,out,p)},{id:'active-free',sample:(p:number)=>blend(out,free,p)},{id:'active-rotate',sample:rotation},{id:'active-seat',sample:(p:number)=>blend(targetOut,target,p)}];
    for(const r of activeRoutes)if(!push(r.id,side,r.sample,heldContacts))return false;
    function measuredPath(id:string,groups:PoseData[][]){for(let j=0;j<groups.length;j++){const nodes=groups[j];if(!push(id+'-'+j,side,p=>{const a=p*(nodes.length-1),i=Math.floor(a),k=Math.min(nodes.length-1,i+1);return poseAt(blend(nodes[i],nodes[k],a-i));},heldContacts))return false;}return true;}
    const count=double?2:1;
    for(let n=0;n<count;n++){
      const finger=(n?3:2) as FingerIndex,id=`${side}-${n?'middle':'index'}`,stroke=fingerLibrary.strokes[id],paths=pathData.strokes[id];
      if(!measuredPath('finger-prepare-'+n,double&&n?paths.prepare.slice(-1):paths.prepare))return false;
      const offset=angle,point=new Vector3().fromArray(stroke.samples[0].target).sub(CENTER).applyQuaternion(q).applyAxisAngle(Z,-offset),base=handPose(poses[side]);
      const drive:FingerContact={side,finger,role:'drive',point,normal:Z,padOffset:new Vector3().fromArray(stroke.samples[0].padLocalOffset)};
      const cs=[...heldContacts,drive];
      // Stroke tables carry actual surface pad locations that vary along the distal mesh.
      const sampler=(p:number)=>{
        const sample=strokeSample(stroke,p);drive.padOffset.copy(sample.padOffset);
        if(double&&n===0){const nodes=paths.overlapTurn as PoseData[],x=p*(nodes.length-1),a=Math.floor(x),b=Math.min(nodes.length-1,a+1);return poseAt(blend(nodes[a],nodes[b],x-a));}
        return serialPose(withFinger(base,side,finger,sample.angles));
      };
      if(!push('finger-turn-'+n,side,sampler,cs,p=>offset+strokeSample(stroke,p).angle,true))return false;
      angle=offset+stroke.samples.at(-1)!.angle;
      if(!measuredPath('finger-release-'+n,double&&n===0?paths.overlapRelease:paths.release))return false;
    }
    for(const r of [...activeRoutes].reverse())if(!push(r.id+'-return',side,p=>r.sample(1-p),heldContacts))return false;
    for(const r of [...supportRoutes].reverse())if(!push(r.id+'-return',other,p=>blend(r.b,r.a,p),lowContacts[side]))return false;
    return true;
  };
  const passed=execute();
  const pathMM={left:0,right:0};for(const segment of segments)for(let i=1;i<segment.frames.length;i++)for(const side of sides)pathMM[side]+=new Vector3().fromArray(segment.frames[i][side].position).distanceTo(new Vector3().fromArray(segment.frames[i-1][side].position))*1000;
  return {id:side+(double?'-double':'-single'),active:side,notation:side==='right'?(double?'B2':'B'):(double?"B2'":"B'"),rotation:q.toArray(),passed,maximum,pathMM,boundaries,segments,final:structuredClone(poses),finalAngle:angle};
}
const adaptedFrom={path:'scripts/finger-front-probe.ts',sha256:'025f45c4940d559ab293c60153b64562dfe75e043dcbaad45284faa5f160e20c'};
const sources=['src/scene/finger-library.json','src/scene/finger-paths.json','src/scene/finger-rig.json','src/scene/finger-contact.ts','scripts/finger-back-probe.ts',...assetFiles];
const hashes=sources.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const serialSupports=Object.fromEntries(sides.map(side=>[side,{...supports[side],contacts:supports[side].contacts.map(serialContact),fits:supports[side].fits.map(f=>({...f,padOffset:f.padOffset.toArray()}))}]));
let results:any[]=[];
if(mode==='turns'){const requested=arg('--roll','0');for(const side of sides)for(const roll of requested==='all'?[0,90,180,270]:[Number(requested)])results.push(run(side,roll));}
if(mode==='entry'){
  const sideArg=arg('--side','both'),double=process.argv.includes('--double');
  for(const side of sides.filter(s=>sideArg==='both'||s===sideArg)){
    const result=roundTrip(side,double);results.push(result);
    const output=`evidence/finger-back-${result.id}-entry-${retreat}-${intervals}.json`;
    writeFileSync(output,JSON.stringify({date:new Date().toISOString(),scope:'Exact low -> back-safe support -> B-free -> transformed source prepare/turn/release -> low; 65 table nodes and 64 exported interpolation midpoints per segment.',thresholdMM:.3,sources:hashes,adaptedFrom,supports:serialSupports,...result},null,2)+'\n');
    console.log(JSON.stringify({output,passed:result.passed,maximum:result.maximum,pathMM:result.pathMM}));
  }
}else{
  const output=`evidence/finger-back-${mode}-z${supportZ}-${intervals}.json`;
  writeFileSync(output,JSON.stringify({date:new Date().toISOString(),scope:'Actual fixed-cube B/B-prime sampled stroke candidates only; no entry/release guarantee.',thresholdMM:.3,intervals,sources:hashes,adaptedFrom,supports:serialSupports,results,limitations:['Sampled geometry is not continuous collision proof.','Direct stroke checks do not prove entry/release or physical force closure.']},null,2)+'\n');
  console.log(JSON.stringify({output,passed:results.filter(r=>r.passed).length,total:results.length}));
}
