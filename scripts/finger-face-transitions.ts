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
for (const side of sides) {
  const directory = resolve("public/models/wuji/hand/body/urdf");
  const loader = new URDFLoader(); loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, done) => {
    const bytes = readFileSync(url), geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.deleteAttribute("normal");
    const merged = mergeVertices(geometry, 1e-6); geometry.dispose();
    merged.computeBoundingBox(); done(new Mesh(merged, material));
  };
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
type Route = { retreat: number; radius: number; endRetreat?: number; via?: number[]; orientationStart?: number; orientationEnd?: number };
function movePose(a: Pose, b: Pose, fromNormal: Vector3, toNormal: Vector3, route: Route, phase: number): Pose {
  const aOut: Pose = { ...a, position: new Vector3().fromArray(a.position).addScaledVector(fromNormal, route.retreat).toArray() };
  const bOut: Pose = { ...b, position: new Vector3().fromArray(b.position).addScaledVector(toNormal, route.endRetreat ?? route.retreat).toArray() };
  if (phase <= 1 / 4) return blend(a, aOut, phase * 4);
  if (phase >= 3 / 4) return blend(bOut, b, (phase - .75) * 4);
  const t = (phase - .25) * 2, start = new Vector3().fromArray(aOut.position).sub(CENTER), end = new Vector3().fromArray(bOut.position).sub(CENTER);
  const r0 = start.length(), r1 = end.length(), u0 = start.clone().normalize(), u1 = end.clone().normalize();
  let unit: Vector3;
  if (route.via) {
    const via = new Vector3().fromArray(route.via).normalize();
    const left = t <= .5, x = left ? u0 : via, y = left ? via : u1, localT = left ? t * 2 : (t - .5) * 2;
    unit = x.clone().applyQuaternion(new Quaternion().setFromUnitVectors(x, y).slerp(new Quaternion(), 1 - localT));
  } else unit = u0.clone().applyQuaternion(new Quaternion().setFromUnitVectors(u0, u1).slerp(new Quaternion(), 1 - t));
  const radius = r0 + (r1 - r0) * t + Math.max(0, route.radius - Math.max(r0, r1)) * Math.sin(Math.PI * t);
  const orientStart = route.orientationStart ?? 0, orientEnd = route.orientationEnd ?? 1;
  const orientationT = Math.max(0, Math.min(1, (t - orientStart) / (orientEnd - orientStart)));
  const pose = blend(aOut, bOut, orientationT);
  pose.position = unit.multiplyScalar(radius).add(CENTER).toArray(); return pose;
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
function evaluate(goal: any, order: Side[], route: Route, divisions: number, full: boolean) {
  const target = goal.initial as Record<Side, Pose>, rotation = new Quaternion().fromArray(goal.templateRotation);
  const targetContacts = Object.fromEntries(sides.map((side) => [side, goal.contacts.filter((c: any) => c.side === side).map((c: any) => ({ ...c, role: "support" }))])) as Record<Side, any[]>;
  const state = { left: low.left, right: low.right } as Record<Side, Pose>;
  const records = { left: lowContacts.left, right: lowContacts.right };
  const frames: any[] = [], segments: any[] = [], maximum: Record<string, number> = {}, worst: Record<string, any> = {};
  let firstFailure: any = null, maxElbowJumpMM = 0;
  for (const moving of order) {
    const support: Side = moving === "left" ? "right" : "left";
    const fromNormal = new Vector3(moving === "right" ? 1 : -1, 0, 0), toNormal = fromNormal.clone().applyQuaternion(rotation);
    const start = state[moving], end = target[moving], segmentStart = frames.length;
    let previous: Record<Side, Vector3> | null = null;
    for (let i = 0; i <= divisions; i++) {
      const phase = i / divisions;
      apply(support, state[support]); apply(moving, movePose(start, end, fromNormal, toNormal, route, phase));
      const check = checkFrame(moving, records[support]);
      const elbow = Object.fromEntries(sides.map((side) => [side, arms[side].elbowPosition.clone()])) as Record<Side, Vector3>;
      if (previous) for (const side of sides) maxElbowJumpMM = Math.max(maxElbowJumpMM, elbow[side].distanceTo(previous[side]) * 1000);
      previous = elbow;
      for (const [key, value] of Object.entries(check.value)) if (value > (maximum[key] ?? 0)) { maximum[key] = value; worst[key] = { moving, phase, ...check }; }
      if (!check.passed && !firstFailure) firstFailure = { moving, support, phase, ...check };
      if (full) frames.push({ progress: (order.indexOf(moving) + phase) / order.length, phase, moving, support, left: current("left"), right: current("right"), supportContacts: records[support], supported: check.supported, ...check.value });
      // Coarse failures are retained; a failed candidate need not consume a full trace.
      if (!full && firstFailure) return { order, route, sampleCount: divisions + 1, passed: false, firstFailure, maximum, maxElbowJumpMM };
    }
    state[moving] = target[moving]; records[moving] = targetContacts[moving];
    segments.push({ moving, support, frameStart: segmentStart, frameEnd: frames.length, supportContacts: records[support] });
  }
  const passed = !firstFailure && (divisions < 64 || maxElbowJumpMM < 40);
  return { order, route, sampleCount: divisions + 1, passed, firstFailure, maximum, maxElbowJumpMM, segments, frames: full ? frames : undefined, return: { mode: "reverse-frames", frameIndices: full ? frames.map((_, i) => frames.length - 1 - i) : undefined, supportRule: "At each reversed segment retain its recorded support hand; transfer only at the shared full-contact endpoint." } };
}
function inspectInterpolation(trace: any) {
  const maximum: Record<string, number> = {}; let firstFailure: any = null;
  for (let i = 0; i < trace.frames.length - 1; i++) {
    const a = trace.frames[i], b = trace.frames[i + 1];
    for (const side of sides) apply(side, blend(a[side], b[side], .5));
    const check = checkFrame(a.moving, a.supportContacts);
    for (const [key, value] of Object.entries(check.value)) maximum[key] = Math.max(maximum[key] ?? 0, value);
    if (!check.passed && !firstFailure) firstFailure = { frame: i, progress: (a.progress + b.progress) / 2, ...check };
  }
  return { samples: trace.frames.length - 1, maximum, firstFailure, passed: !firstFailure };
}
if (process.argv.includes("--diagnose-d")) {
  const goal = targetData.primitives.find((p: any) => p.id === "D-left-roll90--90"), rotation = new Quaternion().fromArray(goal.templateRotation);
  const records: any[] = [];
  for (const side of sides) for (const mm of [0, 10, 20, 30, 40, 60, 80]) {
    const other: Side = side === "left" ? "right" : "left", normal = new Vector3(side === "right" ? 1 : -1, 0, 0).applyQuaternion(rotation);
    const pose: Pose = { ...goal.initial[side], position: new Vector3().fromArray(goal.initial[side].position).addScaledVector(normal, mm / 1000).toArray() };
    apply(side, pose); apply(other, low[other]);
    const record = { side, mm, ...checkFrame(side, lowContacts[other]) }; records.push(record);
    console.log(JSON.stringify({ side, mm, passed: record.passed, value: record.value, arm: record.arm.handWitness, mutual: record.mutual, cube: record.cube }));
  }
  const file = "evidence/finger-face-transitions.json", data = JSON.parse(readFileSync(file, "utf8")); data.diagnostics = records;
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n"); process.exit(0);
}
const groups = [
  { id: "fb-right-front", primitive: "F-right-roll270--90", faces: ["F", "B"] },
  { id: "d-left", primitive: "D-left-roll90--90", faces: ["D", "DPrime"] },
  { id: "fb-left-front", primitive: "F-left-roll90-90", faces: ["FPrime", "BPrime"] },
];
const routes: Route[] = [
  { retreat: .06, radius: .29 }, { retreat: .08, radius: .33 }, { retreat: .04, radius: .26 },
  { retreat: .06, radius: .32, via: [0, 1, 1] }, { retreat: .08, radius: .36, via: [0, 1, 1] },
  { retreat: .04, radius: .28, via: [0, 0, 1] },
  { retreat: .04, radius: .26, orientationEnd: .5 },
  { retreat: .04, radius: .28, orientationEnd: .75 },
  { retreat: .04, radius: .26, orientationStart: .4 },
  { retreat: .03, radius: .26, orientationEnd: .5 },
  { retreat: .02, radius: .26, orientationEnd: .5 },
  { retreat: .02, radius: .26, orientationStart: .4 },
  { retreat: .06, endRetreat: .02, radius: .26, orientationEnd: .5 },
  { retreat: .06, endRetreat: .02, radius: .26, orientationStart: .4 },
  { retreat: .06, endRetreat: .02, radius: .29, orientationEnd: .6 },
  { retreat: .06, endRetreat: .02, radius: .29, via: [0, 0, 1] },
];
const results: any[] = [];
const saved = process.argv.includes("--refine") ? JSON.parse(readFileSync("evidence/finger-face-transitions.json", "utf8")) : null;
function assertFresh(data: any) {
  for (const input of data.inputs) if (createHash("sha256").update(readFileSync(input.path)).digest("hex") !== input.sha256) throw new Error(`Measured input changed: ${input.path}. Re-run the entry probes before reusing or adding regrips.`);
}
if (saved) assertFresh(saved);
if (!process.argv.includes("--regrips-only")) for (const group of groups) {
  const goal = targetData.primitives.find((p: any) => p.id === group.primitive);
  if (!goal) throw new Error(`Missing measured target ${group.primitive}`);
  const cached = saved?.results.find((r: any) => r.id === group.id);
  const trials: any[] = cached?.trials ?? []; let selected: any = cached?.passed ? cached.selected : null;
  if (selected && !selected.interpolation) { selected.interpolation = inspectInterpolation(selected); if (!selected.interpolation.passed) selected = null; }
  if (selected) console.log(JSON.stringify({ group: group.id, stage: "reused-with-interpolation", passed: true, interpolation: selected.interpolation }));
  if (!selected) for (const route of routes) {
    for (const order of [["right", "left"], ["left", "right"]] as Side[][]) {
      if (trials.some((t) => JSON.stringify(t.route) === JSON.stringify(route) && JSON.stringify(t.order) === JSON.stringify(order) && t.passed === false)) continue;
      const coarse = evaluate(goal, order, route, 16, false); trials.push(coarse);
      console.log(JSON.stringify({ group: group.id, stage: "coarse", order, route, passed: coarse.passed, failure: coarse.firstFailure && { moving: coarse.firstFailure.moving, phase: coarse.firstFailure.phase, value: coarse.firstFailure.value, armWitness: coarse.firstFailure.arm.handWitness, cube: coarse.firstFailure.cube, mutual: coarse.firstFailure.mutual } }));
      if (!coarse.passed) continue;
      const dense = evaluate(goal, order, route, intervals, true);
      if (dense.passed) { (dense as any).interpolation = inspectInterpolation(dense); dense.passed = (dense as any).interpolation.passed; }
      console.log(JSON.stringify({ group: group.id, stage: "dense", order, route, passed: dense.passed, maximum: dense.maximum, maxElbowJumpMM: dense.maxElbowJumpMM, failure: dense.firstFailure }));
      if (dense.passed) { selected = dense; break; }
      trials.push({ ...dense, frames: undefined });
    }
    if (selected) break;
  }
  results.push({ ...group, target: goal.initial, targetContacts: goal.contacts.map((c: any) => ({ ...c, role: "support" })), passed: !!selected, selected, trials });
  const output = "evidence/finger-face-transitions.json";
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), inputs: [lowSource, targetSource].map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })), cubeCenter: CENTER.toArray(), cubeOrientation: [0, 0, 0, 1], thresholdMM: threshold, supportAreaThresholdM2: .00015, results, regrips: saved?.regrips, regripScope: saved?.regripScope, scope: "One hand moves at a time from the measured two-low support poses to a measured face-entry grip. Only the stationary hand supplies the production three-contact support gate. Real mesh vertices vs the entire aligned cube box; interhand and inter-finger containment; fixed-base mechanical arms; joint limits. Return is the strict reverse trace. No moving-layer composition or hardware stability is claimed." }, null, 2) + "\n");
  console.log(output);
}

if (process.argv.includes("--regrips-only")) {
  const output = "evidence/finger-face-transitions.json", data = JSON.parse(readFileSync(output, "utf8"));
  assertFresh(data);
  const regrips: Record<string, any> = data.regrips ?? {};
  function rotateActive(pose: Pose, normal: Vector3, angle: number): Pose {
    const q = new Quaternion().setFromAxisAngle(normal, angle);
    return { position: new Vector3().fromArray(pose.position).sub(CENTER).applyQuaternion(q).add(CENTER).toArray(), quaternion: q.clone().multiply(new Quaternion().fromArray(pose.quaternion)).toArray(), joints: { ...pose.joints } };
  }
  function evaluateRegrip(primitive: any, retreat: number, divisions: number, full: boolean) {
    const moving = primitive.active as Side, support = primitive.support as Side, normal = new Vector3().fromArray(primitive.normal);
    const initial = primitive.initial[moving] as Pose, turned = rotateActive(initial, normal, primitive.turnRadians);
    const supportContacts = primitive.contacts.filter((c: any) => c.side === support).map((c: any) => ({ ...c, role: "support" }));
    const frames: any[] = [], maximum: Record<string, number> = {};
    let firstFailure: any = null, previous: Record<Side, Vector3> | null = null, maxElbowJumpMM = 0;
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      let pose: Pose;
      if (t <= .25) pose = { ...turned, position: new Vector3().fromArray(turned.position).addScaledVector(normal, retreat * t * 4).toArray() };
      else if (t < .75) { pose = rotateActive(turned, normal, -primitive.turnRadians * (t - .25) * 2); pose.position = new Vector3().fromArray(pose.position).addScaledVector(normal, retreat).toArray(); }
      else pose = { ...initial, position: new Vector3().fromArray(initial.position).addScaledVector(normal, retreat * (1 - (t - .75) * 4)).toArray() };
      apply(moving, pose); apply(support, primitive.initial[support]);
      const check = checkFrame(moving, supportContacts);
      const elbow = Object.fromEntries(sides.map((side) => [side, arms[side].elbowPosition.clone()])) as Record<Side, Vector3>;
      if (previous) for (const side of sides) maxElbowJumpMM = Math.max(maxElbowJumpMM, elbow[side].distanceTo(previous[side]) * 1000); previous = elbow;
      for (const [key, value] of Object.entries(check.value)) maximum[key] = Math.max(maximum[key] ?? 0, value);
      if (!check.passed && !firstFailure) firstFailure = { phase: t, ...check };
      if (full) frames.push({ progress: t, phase: t, moving, support, left: current("left"), right: current("right"), supportContacts, supported: check.supported, ...check.value });
      if (!full && firstFailure) break;
    }
    const passed = !firstFailure && (divisions < 64 || maxElbowJumpMM < 40);
    return { retreatMM: retreat * 1000, passed, maximum, firstFailure, maxElbowJumpMM, start: turned, end: initial, supportPose: primitive.initial[support], supportContacts, sampleCount: divisions + 1, frames: full ? frames : undefined };
  }
  for (const primitive of targetData.primitives) {
    if (regrips[primitive.id]?.passed) { console.log(JSON.stringify({ regrip: primitive.id, reused: true })); continue; }
    const trials: any[] = []; let selected: any = null;
    for (const retreat of [.04, .05, .06, .07]) {
      const coarse = evaluateRegrip(primitive, retreat, 16, false); trials.push(coarse);
      console.log(JSON.stringify({ regrip: primitive.id, stage: "coarse", retreatMM: retreat * 1000, passed: coarse.passed, firstFailure: coarse.firstFailure && { phase: coarse.firstFailure.phase, value: coarse.firstFailure.value, arm: coarse.firstFailure.arm.handWitness, mutual: coarse.firstFailure.mutual } }));
      if (!coarse.passed) continue;
      const dense = evaluateRegrip(primitive, retreat, intervals, true);
      if (dense.passed) { (dense as any).interpolation = inspectInterpolation(dense); dense.passed = (dense as any).interpolation.passed; }
      console.log(JSON.stringify({ regrip: primitive.id, stage: "dense", retreatMM: retreat * 1000, passed: dense.passed, maximum: dense.maximum, interpolation: (dense as any).interpolation, maxElbowJumpMM: dense.maxElbowJumpMM }));
      if (dense.passed) { selected = dense; break; } trials.push({ ...dense, frames: undefined });
    }
    regrips[primitive.id] = { id: primitive.id, face: primitive.face, active: primitive.active, support: primitive.support, passed: !!selected, selected, trials };
    data.regrips = regrips;
    data.regripScope = "Quarter-turn end pose to the same primitive's initial grasp: move active hand along face normal, unwind around that face axis entirely outside the cube, then approach. Opposite initial hand remains the sole measured support. This enables a second same-direction quarter turn and then the independently validated entry-return path; no 180-degree wrist orbit is inferred.";
    writeFileSync(output, JSON.stringify(data, null, 2) + "\n"); console.log(output);
  }
}
