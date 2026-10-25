/** Fixed-cube, one-hand-at-a-time access to measured F/B/D entry grasps. */
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
function contacts(side: Side, worldXAngle: number) {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), worldXAngle), pose = current(side);
  return grip[side].contacts.map((c) => {
    const target = new Vector3().fromArray(c.target).sub(CENTER).applyQuaternion(q).add(CENTER);
    const angles = [1, 2, 3, 4].map((j) => pose.joints[`${side}_finger${c.finger}_joint${j}`]);
    const actual = forwardFinger(side, c.finger, angles, { position: new Vector3().fromArray(pose.position), quaternion: new Quaternion().fromArray(pose.quaternion) }, new Vector3().fromArray(c.padOffset)).position;
    return { side, finger: c.finger, target: serialize(target), point: serialize(actual), cubeLocalPoint: serialize(target.clone().sub(CENTER)), normal: serialize(new Vector3().fromArray(c.normal).applyQuaternion(q)), padOffset: c.padOffset, residualMM: target.distanceTo(actual) * 1000, inULayer: actual.y - CENTER.y > 0.015 };
  });
}


const lowSource = "evidence/finger-role-strokes.json", targetSource = "evidence/finger-face-primitives.json";
const lowData = JSON.parse(readFileSync(lowSource, "utf8")), targetData = JSON.parse(readFileSync(targetSource, "utf8"));
const low = Object.fromEntries(sides.map((side) => [side, lowData.hands.find((h: any) => h.side === side).supportPose])) as Record<Side, Pose & { contacts: any[] }>;
const lowContacts = Object.fromEntries(sides.map((side) => [side, low[side].contacts.map((c) => ({ side, finger: c.finger, role: "support", cubeLocalPoint: new Vector3().fromArray(c.target).sub(CENTER).toArray(), normal: c.normal, padOffset: c.padLocalOffset }))])) as Record<Side, any[]>;
const threshold = .3;
function asFingerContact(c: any): FingerContact { return { side: c.side, finger: c.finger, role: "support", point: new Vector3().fromArray(c.cubeLocalPoint), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) }; }
function gatePoses() { return Object.fromEntries(sides.map((side) => { const p = current(side); return [side, { position: new Vector3().fromArray(p.position), quaternion: new Quaternion().fromArray(p.quaternion), joints: p.joints, closed: 1 }]; })) as any; }
function alignedCube(nodes: Mesh[]) {
  let depthMM = 0, link = "", witness = [0, 0, 0];
  for (const mesh of nodes) { const p = mesh.geometry.getAttribute("position"); for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).sub(CENTER);
    const d = Math.min(.045 - Math.abs(point.x), .045 - Math.abs(point.y), .045 - Math.abs(point.z)) * 1000;
    if (d > depthMM) { depthMM = d; link = mesh.parent?.parent?.name ?? ""; witness = point.toArray(); }
  } }
  return { depthMM, link, witness };
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
function checkFrame(moving: Side, supportContacts: any[]) {
  const poses = gatePoses(), contacts = supportContacts.map(asFingerContact);
  const supported = hasMeasuredSupport(poses, contacts);
  const errorMM = Math.max(...contacts.map((c) => measureContact(poses[c.side], c).error * 1000));
  const cube = { left: alignedCube(meshes.left), right: alignedCube(meshes.right) }, mutual = mutualHands(), self = selfCheck(moving), arm = armCheck(new Vector3(0, 1, 0), 0), armCube = alignedCube(armMeshes);
  const violations = sides.flatMap((side) => limitFailures(current(side), side));
  const value = { cubeDepthMM: Math.max(cube.left.depthMM, cube.right.depthMM), mutualDepthMM: mutual.depthMM, selfDepthMM: self.depthMM, handArmDepthMM: arm.handDepthMM, armCubeDepthMM: armCube.depthMM, crossArmDepthMM: arm.crossArmDepthMM, reachErrorMM: arm.reachErrorMM, supportErrorMM: errorMM };
  const passed = supported && !violations.length && value.reachErrorMM < 1 && Math.max(value.cubeDepthMM, value.mutualDepthMM, value.selfDepthMM, value.handArmDepthMM, value.armCubeDepthMM, value.crossArmDepthMM, value.supportErrorMM) <= threshold;
  return { passed, supported, value, cube, mutual, self, arm, armCube, violations };
}

/**
 * Narrow geometry probe; all frozen inputs remain read-only.
 * Initial candidates make the rigid hand follow the actual target frame rotation,
 * so the wrist and fingers cannot acquire the inward relative sweep of separately
 * interpolated wrist position/orientation. 40 mm clearance is chosen from the
 * cube circumradius; 30 mm is a targeted shorter bound, not a large parameter grid.
 */
type Route = { id:string; retreat:number; kind:"rigid"|"sphere"|"poly"; pregrip:boolean; via?:number[][]; orientationStart?:number; orientationEnd?:number; endRetreat?:number };
const routes:Route[]=[
  {id:"rigid40",retreat:.04,kind:"rigid",pregrip:true},
  {id:"rigid30",retreat:.03,kind:"rigid",pregrip:true},
  {id:"sphere30",retreat:.03,kind:"sphere",pregrip:true},
  {id:"rigid30-end20",retreat:.03,endRetreat:.02,kind:"rigid",pregrip:true},
  {id:"rigid40-end20",retreat:.04,endRetreat:.02,kind:"rigid",pregrip:true},
];
const groups=[
  {id:"fb-right-front",primitive:"F-right-roll270--90",order:["left","right"] as Side[]},
  {id:"fb-left-front",primitive:"F-left-roll90-90",order:["right","left"] as Side[]},
  {id:"d-left",primitive:"D-left-roll90--90",order:["left","right"] as Side[]},
];
function movePose(a:Pose,b:Pose,moving:Side,rotation:Quaternion,route:Route,phase:number):Pose {
  const fromNormal=new Vector3(moving==="right"?1:-1,0,0), toNormal=fromNormal.clone().applyQuaternion(rotation);
  const pre:Pose={...a,joints:route.pregrip?b.joints:a.joints};
  const p0=new Vector3().fromArray(a.position).addScaledVector(fromNormal,route.retreat),p1=new Vector3().fromArray(b.position).addScaledVector(toNormal,route.endRetreat??route.retreat);
  const aOut:Pose={...pre,position:p0.toArray()}, bOut:Pose={...b,position:p1.toArray()};
  const split=.125;
  if(phase<=split)return blend(a,pre,phase/split);
  if(phase<=.25)return blend(pre,aOut,(phase-split)/(.25-split));
  if(phase>=.875)return blend(bOut,b,(phase-.875)/.125);
  const t=(phase-.25)/.625;
  const q=new Quaternion().slerp(rotation,t);
  if(route.kind==="rigid") {
    const position=p0.clone().sub(CENTER).applyQuaternion(q).add(CENTER);
    if(route.endRetreat!==undefined)position.addScaledVector(fromNormal.clone().applyQuaternion(q), (route.endRetreat-route.retreat)*t);
    return {position:position.toArray(),quaternion:q.multiply(new Quaternion().fromArray(a.quaternion)).toArray(),joints:blend(pre,b,t).joints};
  }
  const r0=p0.clone().sub(CENTER),r1=p1.clone().sub(CENTER),u0=r0.clone().normalize(),u1=r1.clone().normalize();
  const direction=u0.clone().applyQuaternion(new Quaternion().setFromUnitVectors(u0,u1).slerp(new Quaternion(),1-t));
  const pose=blend(aOut,bOut,t);pose.position=direction.multiplyScalar(r0.length()+(r1.length()-r0.length())*t).add(CENTER).toArray();return pose;
}
function pathLength(frames:any[]) {
  return Object.fromEntries(sides.map(side=>[side,frames.reduce((n,f,i)=>i?n+new Vector3().fromArray(f[side].position).distanceTo(new Vector3().fromArray(frames[i-1][side].position))*1000:n,0)]));
}
const selfCache=new Map<string,ReturnType<typeof selfCheck>>();
function quickFrame(moving:Side,supportContacts:any[]) {
  const cube={left:alignedCube(meshes.left),right:alignedCube(meshes.right)};
  if(Math.max(cube.left.depthMM,cube.right.depthMM)>threshold)return {passed:false,value:{cubeDepthMM:Math.max(cube.left.depthMM,cube.right.depthMM)},cube,early:"cube"};
  // Only compute expensive actual triangle containment after cheap cube/arm tests.
  const arm=armCheck(new Vector3(0,1,0),0),armCube=alignedCube(armMeshes);
  if(Math.max(arm.handDepthMM,arm.crossArmDepthMM,armCube.depthMM)>.3||arm.reachErrorMM>1)return {passed:false,value:{handArmDepthMM:arm.handDepthMM,crossArmDepthMM:arm.crossArmDepthMM,armCubeDepthMM:armCube.depthMM,reachErrorMM:arm.reachErrorMM},arm,armCube,early:"arms"};
  const poses=gatePoses(), cs=supportContacts.map(asFingerContact), supported=hasMeasuredSupport(poses,cs);
  const errorMM=Math.max(...cs.map(c=>measureContact(poses[c.side],c).error*1000));
  const mutual=mutualHands();
  const key=moving+JSON.stringify(current(moving).joints);let self=selfCache.get(key);
  if(!self){self=selfCheck(moving);selfCache.set(key,self);}
  const violations=sides.flatMap(side=>limitFailures(current(side),side));
  const value={cubeDepthMM:Math.max(cube.left.depthMM,cube.right.depthMM),mutualDepthMM:mutual.depthMM,selfDepthMM:self.depthMM,handArmDepthMM:arm.handDepthMM,crossArmDepthMM:arm.crossArmDepthMM,armCubeDepthMM:armCube.depthMM,reachErrorMM:arm.reachErrorMM,supportErrorMM:errorMM};
  const passed=supported&&!violations.length&&Math.max(...Object.entries(value).filter(([k])=>k!=="reachErrorMM").map(([,v])=>v))<=.3&&value.reachErrorMM<1;
  return {passed,value,supported,cube,arm,armCube,mutual,self,violations};
}
function evaluate(group:typeof groups[number],route:Route,divisions:number,full:boolean) {
 const goal=targetData.primitives.find((p:any)=>p.id===group.primitive),rotation=new Quaternion().fromArray(goal.templateRotation),target=goal.initial as Record<Side,Pose>;
 const targetContacts=Object.fromEntries(sides.map(side=>[side,goal.contacts.filter((c:any)=>c.side===side).map((c:any)=>({...c,role:"support"}))]));
 const state={left:low.left,right:low.right} as Record<Side,Pose>, records={left:lowContacts.left,right:lowContacts.right};
 const frames:any[]=[],segments:any[]=[],maximum:Record<string,number>={};let firstFailure:any=null,maxElbowJumpMM=0;
 const planned:any[]=[];
 for(const moving of group.order){
  const support:Side=moving==="left"?"right":"left",frameStart=frames.length;let previous:Record<Side,Vector3>|null=null;
  for(let i=0;i<=divisions;i++){
   const phase=i/divisions,pose=movePose(low[moving],target[moving],moving,rotation,route,phase);
   apply(support,state[support]);apply(moving,pose);
   const check=quickFrame(moving,records[support]);
   const elbow=Object.fromEntries(sides.map(s=>[s,arms[s].elbowPosition.clone()])) as Record<Side,Vector3>;
   if(previous)for(const s of sides)maxElbowJumpMM=Math.max(maxElbowJumpMM,elbow[s].distanceTo(previous[s])*1000);previous=elbow;
   for(const [k,v]of Object.entries(check.value))maximum[k]=Math.max(maximum[k]??0,v as number);
   frames.push({progress:(group.order.indexOf(moving)+phase)/2,phase,moving,support,left:current("left"),right:current("right"),supportContacts:records[support],supported:check.supported??false,...check.value});
   if(!check.passed){firstFailure={moving,support,phase,...check};break;}
  }
  if(firstFailure)break;
  state[moving]=target[moving];records[moving]=targetContacts[moving];segments.push({moving,support,frameStart,frameEnd:frames.length,supportContacts:records[support]});
 }
 // Path length is calculated from the entire proposed route even if validation exits early.
 for(let hand=0;hand<2;hand++){const moving=group.order[hand],support:Side=moving==="left"?"right":"left";for(let i=0;i<=128;i++){const f:any={};f[moving]=movePose(low[moving],target[moving],moving,rotation,route,i/128);f[support]=hand?target[support]:low[support];planned.push(f);}}
 return {id:group.id,primitive:group.primitive,order:group.order,route,divisions,passed:!firstFailure&&(divisions<64||maxElbowJumpMM<40),firstFailure,maximum,maxElbowJumpMM,pathMM:pathLength(planned),storedPathMM:full?pathLength(frames):undefined,checkedFrames:frames.length,segments,frames:full?frames:undefined};
}
function inspectInterpolation(trace:any){
 const maximum:Record<string,number>={};let firstFailure:any=null,checked=0;
 for(let i=0;i<trace.frames.length-1;i++){
  const a=trace.frames[i],b=trace.frames[i+1];for(const side of sides)apply(side,blend(a[side],b[side],.5));
  const check=quickFrame(a.moving,a.supportContacts);checked++;
  for(const[k,v]of Object.entries(check.value))maximum[k]=Math.max(maximum[k]??0,v as number);
  if(!check.passed){firstFailure={frame:i,progress:(a.progress+b.progress)/2,...check};break;}
 }
 return {passed:!firstFailure,checked,firstFailure,maximum};
}
const groupArg=arg("--group","fb-right-front"),candidateArg=arg("--candidate","rigid40"),divisions=Number(arg("--divisions","16")),dense=process.argv.includes("--dense");
const group=groups.find(g=>g.id===groupArg),route=routes.find(r=>r.id===candidateArg);if(!group||!route)throw new Error("unknown group/candidate");
const started=Date.now(),result=evaluate(group,route,dense?64:divisions,dense);
if(result.passed&&dense){(result as any).interpolation=inspectInterpolation(result);result.passed=(result as any).interpolation.passed;}
const frozen=JSON.parse(readFileSync("evidence/finger-face-transitions.json","utf8")).results.find((r:any)=>r.id===group.id);
const baselineMM=pathLength(frozen.selected.frames);
const output=`evidence/finger-face-compact-${group.id}-${route.id}-${dense?"dense":`coarse${divisions}`}.json`;
const inputs=[lowSource,targetSource,input,"scripts/finger-face-transitions.ts","scripts/finger-face-compact.ts","src/scene/hand.ts","src/scene/arm.ts","src/scene/motion.ts","src/scene/finger-rig.ts","src/scene/finger-rig.json","src/scene/finger-contact.ts",...assetFiles].map(path=>({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")}));
writeFileSync(output,JSON.stringify({date:new Date().toISOString(),inputs,thresholdMM:.3,scope:"Fixed-cube one-hand-at-a-time low to frozen face target. The stationary hand self-collision is inherited from frozen poses; the moving hand has independent cached joint-shape checks. Vertex containment uses actual STL meshes; all arm mesh vertices vs cube; stationary real contact support and URDF limits. No physical dynamic stability claimed.",elapsedMS:Date.now()-started,baselineMM,result},null,2)+"\n");
console.log(JSON.stringify({output,elapsedMS:Date.now()-started,baselineMM,...result,frames:undefined,segments:undefined},null,2));
