/** Competitive thumb F calibration. Original business code, rigs and meshes remain read-only. */
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

const Z = new Vector3(0, 0, 1), DEG = Math.PI / 180;
const direct = JSON.parse(readFileSync("src/scene/finger-direct.json", "utf8"));
const mode = arg("--mode", "reach"), sideArg = arg("--side", "both");
const directionArg = arg("--direction", "both");
const divisions = Number(arg("--divisions", "32"));
const follow = Number(arg("--follow", "0")), rollDegrees = Number(arg("--roll", "0"));
const releaseOffset = Number(arg("--release-offset", "0.008"));
const startY = Number(arg("--start-y", "-0.013")), startX = Number(arg("--start-x", "0.029"));
const poseFor = (p: Pose) => ({ position: new Vector3().fromArray(p.position), quaternion: new Quaternion().fromArray(p.quaternion), joints: { ...p.joints }, closed: 1 });
const serializeContact = (c: FingerContact) => ({ ...c, point: c.point.toArray(), normal: c.normal.toArray(), padOffset: c.padOffset.toArray() });
const pads = {} as Record<Side, Triangle[]>;
for (const side of sides) {
  const tip = hands[side].robot.links[`${side}_finger1_tip_link`], triangles: Triangle[] = [];
  hands[side].root.updateMatrixWorld(true);
  tip.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const transform = tip.matrixWorld.clone().invert().multiply(node.matrixWorld), vertices = node.geometry.getAttribute("position"), index = node.geometry.index, count = index?.count ?? vertices.count;
    for (let i = 0; i < count; i += 3) triangles.push(new Triangle(...[0, 1, 2].map(j => new Vector3().fromBufferAttribute(vertices, index ? index.getX(i + j) : i + j).applyMatrix4(transform)) as [Vector3, Vector3, Vector3]));
  });
  pads[side] = triangles;
}
function surfacePad(side: Side, target: Vector3, normal: Vector3) {
  let extreme = Infinity, distance = Infinity; const best = new Vector3(), point = new Vector3();
  for (const tri of pads[side]) for (const v of [tri.a, tri.b, tri.c]) if (v.dot(normal) < extreme) { extreme = v.dot(normal); best.copy(v); }
  for (const tri of pads[side]) {
    tri.closestPointToPoint(target, point); if (point.dot(normal) > extreme + .00005) continue;
    const d = point.distanceToSquared(target); if (d < distance) { distance = d; best.copy(point); }
  }
  return best;
}
function fitPad(side: Side, target: Vector3, wrist: ReturnType<typeof poseFor>, seed: number[], pad: Vector3) {
  let angles = seed.slice(), offset = pad.clone();
  for (let i = 0; i < 8; i++) {
    const fit = fitFinger({ side, finger: 1, position: target, initial: angles, wrist, padOffset: offset, tolerance: .000015, iterations: 100 });
    angles = fit.angles;
    const fk = forwardFinger(side, 1, angles, wrist), inverse = fk.quaternion.clone().invert();
    offset = surfacePad(side, target.clone().sub(fk.position).applyQuaternion(inverse), Z.clone().applyQuaternion(inverse));
  }
  const fit = fitFinger({ side, finger: 1, position: target, initial: angles, wrist, padOffset: offset, tolerance: .000015, iterations: 150 });
  return { angles: fit.angles, errorMM: fit.error * 1000, padOffset: offset };
}
function activeFree(side: Side) {
  const h = fingerLibrary.hands[side], p = structuredClone(h.support);
  for (const finger of [2, 3, 4, 5] as FingerIndex[]) fingerJoints(side, finger).forEach((j, k) => p.joints[j.name] = h.freeAngles[finger][k]);
  return p;
}
const selfCache = new Map<string, ReturnType<typeof selfCheck>>();
function cachedSelf(side: Side) {
  const key = side + JSON.stringify(current(side).joints);
  if (!selfCache.has(key)) selfCache.set(key, selfCheck(side));
  return selfCache.get(key)!;
}
function fullGeometry(contacts: FingerContact[], angle: number, turning = true) {
  const poses = { left: poseFor(current("left")), right: poseFor(current("right")) }, move = turning ? parseMove(angle < 0 ? "F" : "F'") : undefined;
  const cube = { left: intoCube(meshes.left, Z, angle), right: intoCube(meshes.right, Z, angle) }, mutual = mutualHands(), self = { left: cachedSelf("left"), right: cachedSelf("right") }, arm = armCheck(Z, angle);
  const maximum = { cubeMM: Math.max(cube.left.depthMM, cube.right.depthMM), mutualMM: mutual.depthMM, selfMM: Math.max(self.left.depthMM, self.right.depthMM), handArmMM: arm.handDepthMM, crossArmMM: arm.crossArmDepthMM, armCubeMM: arm.armCube.depthMM, reachMM: arm.reachErrorMM,
    contactMM: Math.max(...contacts.map(c => measureContact(poses[c.side], c, move, angle).error * 1000)) };
  const supportPassed = hasMeasuredSupport(poses, contacts, move, angle), limits = sides.flatMap(s => limitFailures(current(s), s));
  return { passed: supportPassed && !limits.length && Object.values(maximum).every(v => v <= .3), maximum, supportPassed, limits, cube, mutual, self, arm };
}
function candidate(side: Side, direction: number) {
  const other: Side = side === "right" ? "left" : "right", base = activeFree(side), original = fingerLibrary.hands[side].support;
  const support = direct.faces.F.hands[other].support, supportContacts = fingerContacts(other, support.contacts);
  const start = new Vector3((side === "right" ? 1 : -1) * startX, startY, .0452);
  const initial = fingerJoints(side, 1).map(j => original.joints[j.name]), pad = new Vector3().fromArray(fingerLibrary.hands[side].contacts.find(c => c.finger === 1)!.padOffset);
  let seed = initial, offset = pad; const frames: any[] = [], maxima: Record<string, number> = { contactMM: 0, wristMM: 0, wristAngleDegrees: 0, jointStepRAD: 0, cubeMM: 0 }, failures: any[] = [];
  for (let i = 0; i <= divisions; i++) {
    const progress = i / divisions, angle = direction * Math.PI / 2 * progress, target = start.clone().applyAxisAngle(Z, angle), pose = structuredClone(base);
    const wristOffset = target.clone().sub(start).multiplyScalar(follow);
    pose.position = new Vector3().fromArray(base.position).add(wristOffset).toArray();
    pose.quaternion = new Quaternion().setFromAxisAngle(Z, direction * rollDegrees * DEG * progress).multiply(new Quaternion().fromArray(base.quaternion)).toArray();
    const fit = fitPad(side, target.clone().add(CENTER), poseFor(pose), seed, offset);
    for (const [j, definition] of fingerJoints(side, 1).entries()) pose.joints[definition.name] = fit.angles[j];
    const jointStep = i ? Math.max(...fit.angles.map((v, j) => Math.abs(v - seed[j]))) : 0;
    seed = fit.angles; offset = fit.padOffset;
    apply(side, pose); apply(other, support.pose);
    const drive: FingerContact = { side, finger: 1, role: "drive", point: start.clone(), normal: Z.clone(), padOffset: offset.clone() };
    const contacts = [...supportContacts, drive], poses = { left: poseFor(current("left")), right: poseFor(current("right")) }, move = parseMove(direction < 0 ? "F" : "F'");
    const contact = measureContact(poses[side], drive, move, angle), supportPassed = hasMeasuredSupport(poses, contacts, move, angle);
    const cube = mode === "reach" ? null : { left: intoCube(meshes.left, Z, angle), right: intoCube(meshes.right, Z, angle) };
    maxima.contactMM = Math.max(maxima.contactMM, contact.error * 1000); maxima.wristMM = Math.max(maxima.wristMM, wristOffset.length() * 1000); maxima.wristAngleDegrees = Math.max(maxima.wristAngleDegrees, Math.abs(rollDegrees * progress)); maxima.jointStepRAD = Math.max(maxima.jointStepRAD, jointStep);
    if (cube) maxima.cubeMM = Math.max(maxima.cubeMM, cube.left.depthMM, cube.right.depthMM);
    if (contact.error > .0003 || !supportPassed || (cube && Math.max(cube.left.depthMM, cube.right.depthMM) > .3)) failures.push({ progress, cubeAngle: angle, errorMM: contact.error * 1000, supportPassed, cube, jointsAtLimit: fingerJoints(side, 1).flatMap((j, k) => Math.abs(fit.angles[k] - j.lower) < 1e-4 ? [j.name + " lower"] : Math.abs(fit.angles[k] - j.upper) < 1e-4 ? [j.name + " upper"] : []) });
    const full = mode === "full" ? fullGeometry(contacts, angle) : null;
    if (full) { for (const [k, v] of Object.entries(full.maximum)) maxima[k] = Math.max(maxima[k] ?? 0, v); if (!full.passed) failures.push({ progress, full }); }
    frames.push({ progress, cubeAngle: angle, turning: true, left: current("left"), right: current("right"), contacts: contacts.map(serializeContact), target: target.toArray(), errorMM: contact.error * 1000, cube, full });
  }
  return { id: `${side}-${direction < 0 ? "F" : "Fprime"}`, side, direction, notation: direction < 0 ? "F" : "F'", finger: 1, passed: failures.length === 0, maxima, failures, frames };
}
function decodedContacts(data: any[]): FingerContact[] { return data.map(c => ({ ...c, point: new Vector3().fromArray(c.point), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) })); }
function pathPose(nodes: Pose[], progress: number): Pose {
  const x = Math.max(0, Math.min(1, progress)) * (nodes.length - 1), lo = Math.floor(x), hi = Math.min(nodes.length - 1, lo + 1);
  return blend(nodes[lo], nodes[hi], x - lo);
}
function roundTrip(side: Side, direction: number) {
  const sourceFile = `evidence/competitive-thumb-full-x${startX}-y${startY}-follow${follow}-roll${rollDegrees}-${divisions}.json`, source = JSON.parse(readFileSync(sourceFile, "utf8"));
  const stroke = source.cases.find((c: any) => c.side === side && c.direction === direction);
  if (!stroke?.passed) throw new Error(`No accepted full thumb stroke for ${side}/${direction}`);
  const other: Side = side === "left" ? "right" : "left", low = { left: structuredClone(fingerLibrary.hands.left.support), right: structuredClone(fingerLibrary.hands.right.support) };
  const poses: Record<Side, Pose> = structuredClone(low), supportContacts = fingerContacts(other, direct.faces.F.hands[other].support.contacts), lowContacts = fingerContacts(side, fingerLibrary.hands[side].contacts);
  const segments: any[] = [], maximum: Record<string, number> = {}, joins: any[] = [], landmarks: Record<string, any> = {};
  let heldAngle = 0, checkedFrames = 0;
  function segment(id: string, moving: Side, nodes: Pose[], contacts: FingerContact[], turning = false, strokeFrames?: any[]) {
    const fixed = structuredClone(poses[moving === "left" ? "right" : "left"]), frames: any[] = [], localMaximum: Record<string, number> = {};
    const previous = segments.at(-1)?.frames.at(-1);
    const at = (progress: number) => {
      const state: Record<Side, Pose> = moving === "left" ? { left: pathPose(nodes, progress), right: structuredClone(fixed) } : { left: structuredClone(fixed), right: pathPose(nodes, progress) };
      let angle = heldAngle, cs = contacts;
      if (strokeFrames) {
        const x = progress * (strokeFrames.length - 1), lo = Math.floor(x), hi = Math.min(lo + 1, strokeFrames.length - 1), t = x - lo;
        angle = strokeFrames[lo].cubeAngle + (strokeFrames[hi].cubeAngle - strokeFrames[lo].cubeAngle) * t;
        cs = decodedContacts(strokeFrames[lo].contacts);
        cs.forEach((c, j) => c.padOffset.lerp(new Vector3().fromArray(strokeFrames[hi].contacts[j].padOffset), t));
      }
      return { ...state, cubeAngle: angle, contacts: cs };
    };
    if (previous) {
      const first = at(0);
      for (const s of sides) {
        const difference = { positionMM: new Vector3().fromArray(previous[s].position).distanceTo(new Vector3().fromArray(first[s].position)) * 1000, angleRAD: new Quaternion().fromArray(previous[s].quaternion).angleTo(new Quaternion().fromArray(first[s].quaternion)), jointRAD: Math.max(...Object.keys(previous[s].joints).map(k => Math.abs(previous[s].joints[k] - first[s].joints[k]))) };
        joins.push({ id, side: s, ...difference });
        if (difference.positionMM > 1e-6 || difference.angleRAD > 1e-6 || difference.jointRAD > 1e-7) throw new Error(`Discontinuous ${id}/${s}: ${JSON.stringify(difference)}`);
      }
    }
    let failure: any = null;
    for (let i = 0; i <= divisions * 2; i++) {
      const progress = i / (divisions * 2), frame = at(progress); for (const s of sides) apply(s, frame[s]);
      const check = fullGeometry(frame.contacts, frame.cubeAngle, turning); checkedFrames++;
      for (const [k, v] of Object.entries(check.maximum)) { maximum[k] = Math.max(maximum[k] ?? 0, v); localMaximum[k] = Math.max(localMaximum[k] ?? 0, v); }
      if (!(i % 2)) frames.push({ progress, cubeAngle: frame.cubeAngle, left: current("left"), right: current("right"), contacts: frame.contacts.map(serializeContact) });
      if (!check.passed) { failure = { progress, interpolationMidpoint: Boolean(i % 2), ...check }; break; }
    }
    const result = { id, stage: turning ? "TURN" : "PREPARE", active: moving, ...(turning ? { finger: 1 } : {}), passed: !failure, maximum: localMaximum, firstFailure: failure, frames };
    segments.push(result); console.log(JSON.stringify({ case: `${side}-${direction}`, segment: id, passed: result.passed, firstFailure: failure ? { progress: failure.progress, maximum: failure.maximum, cube: failure.cube, mutual: failure.mutual, self: failure.self, armWitness: failure.arm.handWitness } : null }));
    if (!failure) { const end = at(1); for (const s of sides) poses[s] = structuredClone(end[s]); heldAngle = end.cubeAngle; }
    return !failure;
  }
  function straight(a: Pose, b: Pose) { return Array.from({ length: divisions + 1 }, (_, i) => blend(a, b, i / divisions)); }
  function guided(from: Pose, fromPoint: Vector3, toPoint: Vector3, endWrist: Pose) {
    const nodes = [structuredClone(from)], sourceContact = fingerLibrary.hands[side].contacts.find(c => c.finger === 1)!;
    let seed = fingerJoints(side, 1).map(j => from.joints[j.name]), pad = new Vector3().fromArray(sourceContact.padOffset);
    for (let i = 1; i <= divisions; i++) {
      const p = i / divisions, pose = blend(from, endWrist, p), target = fromPoint.clone().lerp(toPoint, p).add(CENTER), fit = fitPad(side, target, poseFor(pose), seed, pad);
      if (fit.errorMM > .3) throw new Error(`Hover IK unreachable ${side}/${i}: ${fit.errorMM} mm`);
      seed = fit.angles; pad = fit.padOffset; fingerJoints(side, 1).forEach((j, k) => pose.joints[j.name] = fit.angles[k]); nodes.push(pose);
    }
    return nodes;
  }
  const supportEntries: Pose[][] = direct.faces.F.hands[other].supportEntry;
  const execute = () => {
    for (let i = 0; i < supportEntries.length; i++) if (!segment(`support-enter-${i}`, other, supportEntries[i], lowContacts)) return false;
    landmarks["support-ready"] = { poses: structuredClone(poses), contacts: supportContacts.map(serializeContact) };
    const free = activeFree(side);
    if (!segment("active-fingers-release", side, straight(poses[side], free), supportContacts)) return false;
    if (!segment("thumb-seat", side, straight(poses[side], stroke.frames[0][side]), supportContacts)) return false;
    landmarks["thumb-ready"] = { poses: structuredClone(poses), contacts: stroke.frames[0].contacts };
    if (!segment("thumb-turn", side, stroke.frames.map((f: any) => f[side]), decodedContacts(stroke.frames[0].contacts), true, stroke.frames)) return false;
    landmarks["thumb-finished"] = { poses: structuredClone(poses), contacts: stroke.frames.at(-1).contacts };
    const shifted = (p: Pose) => { const out = structuredClone(p); out.position[2] += releaseOffset; return out; };
    if (!segment("thumb-wrist-release", side, straight(poses[side], shifted(poses[side])), supportContacts)) return false;
    if (!segment("thumb-clear-rewind", side, [...stroke.frames].reverse().map((f: any) => shifted(f[side])), supportContacts)) return false;
    if (!segment("thumb-clear-home-shape", side, straight(poses[side], shifted(free)), supportContacts)) return false;
    if (!segment("thumb-support-reseat", side, straight(poses[side], free), supportContacts)) return false;
    if (!segment("active-fingers-regrasp", side, straight(poses[side], low[side]), supportContacts)) return false;
    for (let i = supportEntries.length - 1; i >= 0; i--) if (!segment(`support-return-${i}`, other, [...supportEntries[i]].reverse(), lowContacts)) return false;
    return true;
  };
  let passed = false, planningFailure: string | null = null;
  try { passed = execute(); } catch (error) { planningFailure = String(error); }
  const pathMM = { left: 0, right: 0 };
  for (const part of segments) for (let i = 1; i < part.frames.length; i++) for (const s of sides) pathMM[s] += new Vector3().fromArray(part.frames[i - 1][s].position).distanceTo(new Vector3().fromArray(part.frames[i][s].position)) * 1000;
  return { id: `${side}-${direction < 0 ? "F" : "Fprime"}-roundtrip`, notation: direction < 0 ? "F" : "F'", active: side, finger: 1, passed, planningFailure, sourceFile, sourceSHA256: createHash("sha256").update(readFileSync(sourceFile)).digest("hex"), checkedFrames, maximum, pathMM, joins, landmarks, final: structuredClone(poses), finalAngle: heldAngle, segments };
}
const sources = ["src/scene/finger-library.json", "src/scene/finger-direct.json", "src/scene/finger-rig.json", "src/scene/finger-rig.ts", "src/scene/finger-contact.ts", ...assetFiles];
const hashes = sources.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
const cases: any[] = [];
for (const side of sides.filter(s => sideArg === "both" || sideArg === s)) for (const direction of (directionArg === "natural" ? [side === "left" ? -1 : 1] : [-1, 1])) {
  const result = mode === "entry" ? roundTrip(side, direction) : candidate(side, direction); cases.push(result);
  console.log(JSON.stringify({ id: result.id, passed: result.passed, maximum: "maximum" in result ? result.maximum : result.maxima, firstFailure: "failures" in result ? result.failures[0] : result.planningFailure }));
}
const scriptSHA256 = createHash("sha256").update(readFileSync("scripts/competitive-thumb-calibrate.ts")).digest("hex"), scriptSnapshot = `evidence/competitive-thumb-script-${scriptSHA256.slice(0, 12)}.ts`;
writeFileSync(scriptSnapshot, readFileSync("scripts/competitive-thumb-calibrate.ts"));
const file = `evidence/competitive-thumb-${mode}${mode === "entry" ? `-release${releaseOffset}` : ""}-x${startX}-y${startY}-follow${follow}-roll${rollDegrees}-${divisions}.json`;
writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), mode, parameters: { divisions, follow, rollDegrees, startX, startY, releaseOffset, side: sideArg, direction: directionArg }, thresholdMM: .3, scriptSHA256, scriptSnapshot, sources: hashes, cases, limitations: mode === "reach" ? ["FK/IK reach and measured support only, no collision or entry/exit acceptance."] : mode === "entry" ? ["Complete low-to-low sampled mesh/arm/contact checks at stored poses and all exported interpolation midpoints; not continuous triangle collision, force closure, speed or hardware proof."] : mode === "full" ? ["Sampled full geometry at stored nodes, not continuous collision, interpolation-midpoint or entry/exit acceptance."] : ["Thumb/cube vertex penetration only at this stage, no mutual-hand, self, arm or entry/exit acceptance."] }, null, 2) + "\n");
console.log(JSON.stringify({ output: file, passes: cases.filter(c => c.passed).length, total: cases.length }));

