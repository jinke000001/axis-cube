/** Actual Wuji/arm geometry probe for layer-preserving wrist turns and R→U. */
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

const cases: any[] = [];
if (!process.argv.includes("--ru-only")) for (const side of sides) for (const degrees of [-90, 90, -180, 180]) {
  const other: Side = side === "left" ? "right" : "left", normal = new Vector3(side === "right" ? 1 : -1, 0, 0);
  const frames: any[] = []; let maxElbowJumpMM = 0; const previousElbows = {} as Record<Side, Vector3>;
  for (let i = 0; i <= intervals; i++) {
    const worldAngle = degrees * Math.PI / 180 * i / intervals;
    apply(side, wristTurn(side, worldAngle)); apply(other, grip[other].pose);
    for (const s of sides) { if (previousElbows[s]) maxElbowJumpMM = Math.max(maxElbowJumpMM, arms[s].elbowPosition.distanceTo(previousElbows[s]) * 1000); previousElbows[s] = arms[s].elbowPosition.clone(); }
    const layerAngle = worldAngle * (side === "right" ? 1 : -1);
    frames.push({ progress: i / intervals, worldAngle, left: current("left"), right: current("right"), contacts: [...contacts(side, worldAngle), ...contacts(other, 0)], cube: { left: intoCube(meshes.left, normal, layerAngle), right: intoCube(meshes.right, normal, layerAngle) }, mutual: mutualHands(), arms: armCheck(normal, layerAngle) });
  }
  const summary = { side, worldDegrees: degrees, maxCubeDepthMM: Math.max(...frames.flatMap((f) => [f.cube.left.depthMM, f.cube.right.depthMM])), maxMutualDepthMM: Math.max(...frames.map((f) => f.mutual.depthMM)), maxHandArmDepthMM: Math.max(...frames.map((f) => f.arms.handDepthMM)), maxArmCubeDepthMM: Math.max(...frames.map((f) => f.arms.armCube.depthMM)), maxCrossArmDepthMM: Math.max(...frames.map((f) => f.arms.crossArmDepthMM)), maxReachErrorMM: Math.max(...frames.map((f) => f.arms.reachErrorMM)), maxContactErrorMM: Math.max(...frames.flatMap((f) => f.contacts.map((c: any) => c.residualMM))), maxElbowJumpMM };
  const passed = Math.max(summary.maxCubeDepthMM, summary.maxMutualDepthMM, summary.maxHandArmDepthMM, summary.maxArmCubeDepthMM, summary.maxCrossArmDepthMM, summary.maxContactErrorMM) <= 0.3 && summary.maxReachErrorMM < 1 && maxElbowJumpMM < 40;
  console.log(JSON.stringify({ ...summary, passed })); cases.push({ ...summary, passed, frames });
}

function angleArray(pose: Pose, side: Side, finger: FingerIndex) {
  return [1, 2, 3, 4].map((j) => pose.joints[`${side}_finger${finger}_joint${j}`]);
}
function withFinger(pose: Pose, side: Side, finger: FingerIndex, values: number[]): Pose {
  return { ...pose, joints: { ...pose.joints, ...Object.fromEntries(values.map((v, i) => [`${side}_finger${finger}_joint${i + 1}`, v])) } };
}
function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    position: new Vector3().fromArray(a.position).lerp(new Vector3().fromArray(b.position), t).toArray(),
    quaternion: new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion), t).toArray(),
    joints: Object.fromEntries(Object.keys(a.joints).map((k) => [k, a.joints[k] + (b.joints[k] - a.joints[k]) * t])),
  };
}
function jointLimitViolations(pose: Pose, side: Side) {
  return ([1, 2, 3, 4, 5] as FingerIndex[]).flatMap((finger) => fingerJoints(side, finger).flatMap((joint) => {
    const value = pose.joints[joint.name];
    return value < joint.lower - 1e-8 || value > joint.upper + 1e-8 ? [{ joint: joint.name, value, lower: joint.lower, upper: joint.upper }] : [];
  }));
}
function withdrawFinger(pose: Pose, c: ReturnType<typeof contacts>[number]) {
  const side = c.side, finger = c.finger;
  const initial = angleArray(pose, side, finger), base = new Vector3().fromArray(c.target), normal = new Vector3().fromArray(c.normal);
  const candidates: any[] = [];
  // A release is an actual pad retreat. Side fingertips must also clear the full
  // U sweep envelope, not merely leave the original side face by a small gap.
  for (const millimeters of [5, 8, 12, 16, 20, 25, 30, 35]) {
    const target = base.clone().addScaledVector(normal, millimeters / 1000);
    const fit = fitFinger({ side, finger, initial, position: target,
      wrist: { position: new Vector3().fromArray(pose.position), quaternion: new Quaternion().fromArray(pose.quaternion) },
      padOffset: new Vector3().fromArray(c.padOffset), tolerance: 1e-6, iterations: 180 });
    const candidate = withFinger(pose, side, finger, fit.angles);
    let maxCubeDepthMM = 0;
    for (let i = 0; i <= 16; i++) {
      apply(side, blendPose(pose, candidate, i / 16));
      maxCubeDepthMM = Math.max(maxCubeDepthMM, intoCube(fingers[side][finger - 1], new Vector3(0, 1, 0), 0).depthMM);
    }
    const sweep = uSweep(fingers[side][finger - 1]);
    const actual = forwardFinger(side, finger, fit.angles, { position: new Vector3().fromArray(pose.position), quaternion: new Quaternion().fromArray(pose.quaternion) }, new Vector3().fromArray(c.padOffset)).position;
    const displacement = actual.clone().sub(base), outwardMM = displacement.dot(normal) * 1000;
    const passed = maxCubeDepthMM <= .3 && sweep.depthMM <= .3 && outwardMM >= 3 && jointLimitViolations(candidate, side).length === 0;
    candidates.push({ requestedRetreatMM: millimeters, target: target.toArray(), actual: actual.toArray(), angles: fit.angles, fitErrorMM: fit.error * 1000, outwardMM, maxCubeDepthMM, uSweep: sweep, passed });
    if (passed) return { pose: candidate, selected: candidates[candidates.length - 1], trials: candidates };
  }
  apply(side, pose);
  return { pose, selected: null, trials: candidates };
}
function fingerMutual(side: Side) {
  let depthMM = 0, overlaps = 0, witness: string[] = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    const check = mutualHands(fingers[side][a], fingers[side][b]); overlaps += check.overlaps;
    if (check.depthMM > depthMM) { depthMM = check.depthMM; witness = check.witness; }
  }
  return { depthMM, overlaps, witness };
}
function supportArea(records: { cubeLocalPoint: number[] }[]) {
  let area = 0;
  for (let a = 0; a < records.length; a++) for (let b = a + 1; b < records.length; b++) for (let c = b + 1; c < records.length; c++) {
    const p = new Vector3().fromArray(records[a].cubeLocalPoint), q = new Vector3().fromArray(records[b].cubeLocalPoint), r = new Vector3().fromArray(records[c].cubeLocalPoint);
    area = Math.max(area, q.sub(p).cross(r.sub(p)).length() / 2);
  }
  return area;
}
function actualPad(side: Side, finger: FingerIndex, target: number[]) {
  const tip = hands[side].robot.links[`${side}_finger${finger}_tip_link`], nodes: Mesh[] = [];
  tip.traverse((node) => { if (node instanceof Mesh) nodes.push(node); });
  const worldTarget = new Vector3().fromArray(target), nearest = new Vector3(); let distance = Infinity;
  for (const mesh of nodes) {
    const localTarget = worldTarget.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
    const p = mesh.geometry.getAttribute("position"), index = mesh.geometry.index, count = index?.count ?? p.count;
    for (let j = 0; j < count; j += 3) {
      triangle.a.fromBufferAttribute(p, index ? index.getX(j) : j); triangle.b.fromBufferAttribute(p, index ? index.getX(j + 1) : j + 1); triangle.c.fromBufferAttribute(p, index ? index.getX(j + 2) : j + 2);
      triangle.closestPointToPoint(localTarget, closest);
      const world = closest.clone().applyMatrix4(mesh.matrixWorld), d = world.distanceTo(worldTarget);
      if (d < distance) { distance = d; nearest.copy(world); }
    }
  }
  return { padOffset: nearest.clone().applyMatrix4(tip.matrixWorld.clone().invert()).toArray(), actual: nearest.toArray(), residualMM: distance * 1000 };
}
function inspectStableFrame(side: Side, angle: number, progress: number, changed?: ReturnType<typeof contacts>[number]) {
  const records = contacts(side, angle).filter((c) => c.finger !== 1 && (!changed || c.finger !== changed.finger));
  if (changed) records.push(changed);
  return { progress, left: current("left"), right: current("right"), supportContacts: records,
    cube: { left: intoCube(meshes.left, new Vector3(0, 1, 0), 0), right: intoCube(meshes.right, new Vector3(0, 1, 0), 0) },
    mutual: mutualHands(), self: fingerMutual(side), arms: armCheck(new Vector3(0, 1, 0), 0),
    jointLimitViolations: jointLimitViolations(current(side), side) };
}
function stableSummary(frames: ReturnType<typeof inspectStableFrame>[]) {
  return {
    maxCubeDepthMM: Math.max(...frames.flatMap((f) => [f.cube.left.depthMM, f.cube.right.depthMM])),
    maxMutualDepthMM: Math.max(...frames.map((f) => f.mutual.depthMM)),
    maxSelfDepthMM: Math.max(...frames.map((f) => f.self.depthMM)),
    maxHandArmDepthMM: Math.max(...frames.map((f) => f.arms.handDepthMM)),
    maxArmCubeDepthMM: Math.max(...frames.map((f) => f.arms.armCube.depthMM)),
    maxCrossArmDepthMM: Math.max(...frames.map((f) => f.arms.crossArmDepthMM)),
    maxSupportErrorMM: Math.max(...frames.flatMap((f) => f.supportContacts.map((c) => c.residualMM))),
    jointLimitViolations: frames.flatMap((f) => f.jointLimitViolations).length,
  };
}
if (process.argv.includes("--stabilize")) {
  const carries: any[] = [];
  for (const side of ["right", "left"] as Side[]) {
    const angle = -Math.PI / 2, other: Side = side === "right" ? "left" : "right";
    apply(other, grip[other].pose); apply(side, wristTurn(side, angle));
    const initial = current(side), before = contacts(side, angle), thumb = before.find((c) => c.finger === 1)!;
    const withdrawal = withdrawFinger(initial, thumb), released = withdrawal.pose;
    if (!withdrawal.selected) { console.log(JSON.stringify({ stabilize: side, failure: "thumb withdrawal" })); continue; }
    const releaseFrames: ReturnType<typeof inspectStableFrame>[] = [];
    for (let i = 0; i <= intervals; i++) { apply(side, blendPose(initial, released, i / intervals)); releaseFrames.push(inspectStableFrame(side, angle, i / intervals)); }
    const index = before.find((c) => c.finger === 2)!;
    const trials: any[] = []; let selected: any = null;
    // Relocate on the static R/L face while the opposite low hand still holds.
    // Lift 4 mm from the side plane during the transit; only the endpoint is
    // published as a support contact. This does not claim force closure.
    for (const [dy, dz] of [[.010, 0], [.012, 0], [.008, 0], [-.008, 0], [-.010, 0], [-.012, 0], [.010, .008], [-.010, .008], [.012, -.008], [-.008, -.008]]) {
      const target = new Vector3().fromArray(index.target).add(new Vector3(0, dy, dz));
      let pose = released, maximumFitErrorMM = 0; const path: Pose[] = [];
      for (let i = 0; i <= intervals; i++) {
        const t = i / intervals, p = new Vector3().fromArray(index.target).lerp(target, t).addScaledVector(new Vector3().fromArray(index.normal), .004 * Math.sin(Math.PI * t));
        const fit = fitFinger({ side, finger: 2, initial: angleArray(pose, side, 2), position: p,
          wrist: { position: new Vector3().fromArray(pose.position), quaternion: new Quaternion().fromArray(pose.quaternion) }, padOffset: new Vector3().fromArray(index.padOffset), tolerance: 1e-7, iterations: 160 });
        maximumFitErrorMM = Math.max(maximumFitErrorMM, fit.error * 1000); pose = withFinger(pose, side, 2, fit.angles); path.push(pose);
      }
      apply(side, pose);
      const pad = actualPad(side, 2, target.toArray());
      const changed = { ...index, target: target.toArray(), point: pad.actual, cubeLocalPoint: target.clone().sub(CENTER).toArray(), padOffset: pad.padOffset, meanOffset: index.padOffset, residualMM: pad.residualMM, inULayer: target.y - CENTER.y > .015 };
      const records = before.filter((c) => c.finger !== 1 && c.finger !== 2).concat(changed);
      const areaM2 = supportArea(records), endCube = intoCube(meshes[side], new Vector3(0, 1, 0), 0), heldSweep = uSweep(meshes[side]);
      const trial: any = { dyMM: dy * 1000, dzMM: dz * 1000, maximumFitErrorMM, contact: changed, areaM2, endCube, heldSweep };
      if (maximumFitErrorMM > .3 || pad.residualMM > .3 || areaM2 <= .00015 || endCube.depthMM > .3 || heldSweep.depthMM > .3) { trials.push(trial); console.log(JSON.stringify({ stabilize: side, trial })); continue; }
      const frames: ReturnType<typeof inspectStableFrame>[] = [];
      for (let i = 0; i < path.length; i++) {
        apply(side, path[i]);
        const frame = inspectStableFrame(side, angle, i / intervals);
        // While moving, index is FREE and the unchanged opposite hand supports.
        frame.supportContacts = frame.supportContacts.filter((c) => c.finger !== 2);
        if (i === intervals) frame.supportContacts.push(changed);
        frames.push(frame);
      }
      const summary = stableSummary(frames); trial.summary = summary;
      trial.passed = Math.max(...Object.values(summary)) <= .3;
      trials.push(trial); console.log(JSON.stringify({ stabilize: side, trial }));
      if (trial.passed) { selected = { trial, frames, pose, supportContacts: records }; break; }
    }
    const releaseSummary = stableSummary(releaseFrames);
    const passed = !!selected && Math.max(...Object.values(releaseSummary)) <= .3;
    carries.push({ side, worldDegrees: -90, initial, withdrawal: { selected: withdrawal.selected, releaseFrames, summary: releaseSummary }, relocation: selected, trials,
      hold: selected ? { pose: selected.pose, supportContacts: selected.supportContacts, maxTriangleAreaM2: selected.trial.areaM2, supportGatePassed: selected.trial.areaM2 > .00015, uSweep: selected.trial.heldSweep } : null,
      regrip: { steps: ["Reverse relocation.frames with opposite low hand supporting.", "Reverse withdrawal.releaseFrames, keeping wrist at carry angle.", "Then reverse the already validated R/L wrist turn if returning neutral."] }, passed,
      scope: "65 sampled configurations per thumb-release and fingertip relocation; actual STL vertices vs aligned cube and continuous U-sweep envelope; interhand and inter-finger mesh vertex containment; arm solids and rendered arm vertices; contact point chosen by actual tip-mesh closest triangle. Opposite baseline hand supports transitions. A complete opposite-hand U stroke remains a composition check." });
    console.log(JSON.stringify({ stableCarry: side, passed, areaM2: selected?.trial.areaM2, releaseSummary, relocationSummary: selected?.trial.summary }));
  }
  const output = `evidence/finger-wrist-${label}-stable-carries.json`;
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), source: input, cubeCenter: serialize(CENTER), cubeOrientation: [0, 0, 0, 1], thresholdMM: .3, supportAreaThresholdM2: .00015, intervals, carries }, null, 2) + "\n"); console.log(output);
}
if (process.argv.includes("--carry-strokes")) {
  const carrySource = `evidence/finger-wrist-${label}-stable-carries.json`, strokeSource = "evidence/finger-role-strokes.json";
  const carryData = JSON.parse(readFileSync(carrySource, "utf8")), roleData = JSON.parse(readFileSync(strokeSource, "utf8"));
  const cases: any[] = [];
  for (const carry of carryData.carries) {
    if (!carry.passed || !carry.hold) continue;
    const supportSide = carry.side as Side, activeSide: Side = supportSide === "right" ? "left" : "right";
    const activePose = roleData.hands.find((h: any) => h.side === activeSide).activePose as Pose;
    const supportContacts: FingerContact[] = carry.hold.supportContacts.map((c: any) => ({ side: supportSide, finger: c.finger, role: "support", point: new Vector3().fromArray(c.cubeLocalPoint), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) }));
    for (const stroke of roleData.strokes.filter((s: any) => s.side === activeSide)) {
      const frames: any[] = [], worst: Record<string, any> = {};
      const max = { cubeDepthMM: 0, mutualDepthMM: 0, selfDepthMM: 0, handArmDepthMM: 0, armCubeDepthMM: 0, crossArmDepthMM: 0, reachErrorMM: 0, supportErrorMM: 0, driveErrorMM: 0, jointLimitViolations: 0 };
      let supportFailures = 0;
      for (let i = 0; i < stroke.samples.length * 2 - 1; i++) {
        const a = stroke.samples[Math.floor(i / 2)], b = stroke.samples[Math.min(Math.floor(i / 2) + 1, stroke.samples.length - 1)], t = i % 2 ? .5 : 0;
        const angle = a.angle + (b.angle - a.angle) * t;
        const angles = a.angles.map((v: number, j: number) => v + (b.angles[j] - v) * t);
        apply(supportSide, carry.hold.pose); apply(activeSide, withFinger(activePose, activeSide, stroke.finger, angles));
        const poses = Object.fromEntries(sides.map((side) => { const p = current(side); return [side, { position: new Vector3().fromArray(p.position), quaternion: new Quaternion().fromArray(p.quaternion), joints: p.joints, closed: 1 }]; })) as any;
        const move = { face: "U", turns: 1, notation: "U" } as const;
        const supported = hasMeasuredSupport(poses, supportContacts, move, angle); if (!supported) supportFailures++;
        const supportErrors = supportContacts.map((contact) => measureContact(poses[supportSide], contact, move, angle).error * 1000);
        const driveContact: FingerContact = { side: activeSide, finger: stroke.finger, role: "drive", point: new Vector3().fromArray(stroke.samples[0].target).sub(CENTER), normal: new Vector3(0, 1, 0), padOffset: new Vector3().fromArray(a.padLocalOffset).lerp(new Vector3().fromArray(b.padLocalOffset), t) };
        const drive = measureContact(poses[activeSide], driveContact, move, angle);
        const cube = { left: intoCube(meshes.left, new Vector3(0, 1, 0), angle), right: intoCube(meshes.right, new Vector3(0, 1, 0), angle) };
        const mutual = mutualHands(), self = fingerMutual(activeSide), arms = armCheck(new Vector3(0, 1, 0), angle);
        const record = { phase: i / (stroke.samples.length * 2 - 2), angle, supported,
          cubeDepthMM: Math.max(cube.left.depthMM, cube.right.depthMM), mutualDepthMM: mutual.depthMM, selfDepthMM: self.depthMM,
          handArmDepthMM: arms.handDepthMM, armCubeDepthMM: arms.armCube.depthMM, crossArmDepthMM: arms.crossArmDepthMM,
          reachErrorMM: arms.reachErrorMM, supportErrorMM: Math.max(...supportErrors), driveErrorMM: drive.error * 1000,
          jointLimitViolations: sides.flatMap((side) => jointLimitViolations(current(side), side)).length };
        for (const key of Object.keys(max) as (keyof typeof max)[]) if (record[key] > max[key]) { max[key] = record[key]; worst[key] = { phase: record.phase, angle, value: record[key], cube, mutual, self, arms }; }
        frames.push(record);
      }
      const passed = !supportFailures && Math.max(max.cubeDepthMM, max.mutualDepthMM, max.selfDepthMM, max.handArmDepthMM, max.armCubeDepthMM, max.crossArmDepthMM, max.supportErrorMM, max.driveErrorMM) <= .3 && max.reachErrorMM < 1 && !max.jointLimitViolations;
      const result = { supportSide, carryDegrees: carry.worldDegrees, stroke: stroke.id, activeSide, activeFinger: stroke.finger, frames: frames.length, interpolatedMidpoints: stroke.samples.length - 1,
        supportAreaM2: carry.hold.maxTriangleAreaM2, supportFailures, max, passed, worst,
        inverseDirection: "The identical samples in reverse have the same geometric and support bounds; this does not validate a new approach or release." };
      cases.push(result); console.log(JSON.stringify({ ...result, worst: undefined }));
    }
  }
  const output = "evidence/finger-wrist-carry-strokes.json";
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), inputs: [carrySource, strokeSource].map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })), thresholdMM: .3, supportAreaThresholdM2: .00015, cubeOrientation: [0, 0, 0, 1], cases, passed: cases.length === 4 && cases.every((c) => c.passed),
    scope: "Actual STL samples plus every adjacent joint/pad-offset interpolation midpoint; both hands vs separately rotating U layer and static lower cube; interhand and active-hand inter-finger containment; both arms; production measureContact and hasMeasuredSupport. Carry held stationary; approach, release, role-transfer and full R-U-R-prime transitions remain separate checks." }, null, 2) + "\n"); console.log(output);
}
const carries: any[] = [];
if (process.argv.includes("--carry")) for (const degrees of [-90, 90, -180, 180]) {
  const angle = degrees * Math.PI / 180;
  apply("left", grip.left.pose); apply("right", wristTurn("right", angle));
  const initial = current("right"), before = contacts("right", angle);
  const fingerSweeps = ([1, 2, 3, 4, 5] as FingerIndex[]).map((finger) => ({ finger, ...uSweep(fingers.right[finger - 1]) }));
  const releaseFingers = before.filter((c) => c.inULayer || fingerSweeps.find((s) => s.finger === c.finger)!.depthMM > .3).map((c) => c.finger);
  let released = initial; const withdrawals: any[] = [];
  for (const c of before.filter((c) => releaseFingers.includes(c.finger))) {
    const withdrawal = withdrawFinger(released, c); released = withdrawal.pose;
    withdrawals.push({ finger: c.finger, ...withdrawal });
  }
  const frames: any[] = [];
  for (let i = 0; i <= intervals; i++) {
    apply("left", grip.left.pose); apply("right", blendPose(initial, released, i / intervals));
    const records = contacts("right", angle);
    frames.push({ progress: i / intervals, left: current("left"), right: current("right"),
      supportContacts: records.filter((c) => !releaseFingers.includes(c.finger)),
      releasedFingers: records.filter((c) => releaseFingers.includes(c.finger)),
      cube: { left: intoCube(meshes.left, new Vector3(0, 1, 0), 0), right: intoCube(meshes.right, new Vector3(0, 1, 0), 0) },
      mutual: mutualHands(), arms: armCheck(new Vector3(0, 1, 0), 0), jointLimitViolations: jointLimitViolations(current("right"), "right") });
  }
  const holdSweep = { fingers: ([1, 2, 3, 4, 5] as FingerIndex[]).map((finger) => ({ finger, ...uSweep(fingers.right[finger - 1]) })), rightHand: uSweep(meshes.right), arm: uSweep(armMeshes) };
  const summary = {
    maxCubeDepthMM: Math.max(...frames.flatMap((f) => [f.cube.left.depthMM, f.cube.right.depthMM])),
    maxMutualDepthMM: Math.max(...frames.map((f) => f.mutual.depthMM)),
    maxHandArmDepthMM: Math.max(...frames.map((f) => f.arms.handDepthMM)),
    maxArmCubeDepthMM: Math.max(...frames.map((f) => f.arms.armCube.depthMM)),
    maxCrossArmDepthMM: Math.max(...frames.map((f) => f.arms.crossArmDepthMM)),
    maxSupportContactErrorMM: Math.max(...frames.flatMap((f) => f.supportContacts.map((c: any) => c.residualMM))),
    jointLimitViolations: frames.flatMap((f) => f.jointLimitViolations).length,
    maxHeldUSweepDepthMM: Math.max(holdSweep.rightHand.depthMM, holdSweep.arm.depthMM),
  };
  const passed = withdrawals.every((w) => w.selected) && Math.max(...Object.values(summary)) <= .3;
  const carry = { side: "right", worldDegrees: degrees, initial, released, contacts: before, releaseFingers, staticSupportFingers: before.filter((c) => !releaseFingers.includes(c.finger)).map((c) => c.finger), fingerSweeps, withdrawals,
    release: { frames, summary, passed }, hold: { leftReference: grip.left.pose, right: released, supportContacts: frames[frames.length - 1].supportContacts, sweep: holdSweep },
    regrip: { interpolation: "Reverse release.frames after U returns to a quarter-turn-aligned layer; wrist is held at the same carry angle.", frameIndices: frames.map((_, i) => frames.length - 1 - i) },
    scope: "Release/regrip tested with the left baseline pose. During U only the right held hand and both arm solids are certified against the rotating layer. The left U stroke and its hand/arm interaction still require composition validation." };
  carries.push(carry); console.log(JSON.stringify({ carry: degrees, releaseFingers, staticSupportFingers: carry.staticSupportFingers, withdrawals: withdrawals.map((w) => ({ finger: w.finger, selected: w.selected })), summary, passed }));
}
if (carries.length) {
  const output = `evidence/finger-wrist-${label}-carries.json`;
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), source: input, cubeCenter: serialize(CENTER), cubeOrientation: [0, 0, 0, 1], thresholdMM: .3, intervals, carries }, null, 2) + "\n");
  console.log(output);
}
apply("left", grip.left.pose); apply("right", wristTurn("right", -Math.PI / 2));
const afterRContacts = contacts("right", -Math.PI / 2);
const afterR = { left: current("left"), right: current("right"), contacts: afterRContacts, fingerSweeps: [1, 2, 3, 4, 5].map((finger) => ({ finger, ...uSweep(fingers.right[finger - 1]) })) };
console.log(JSON.stringify({ afterRContacts: afterRContacts.map((c) => ({ finger: c.finger, local: c.cubeLocalPoint, inULayer: c.inULayer })), rightFingerUSweeps: afterR.fingerSweeps }));
if (cases.length) {
  const result = { date: new Date().toISOString(), source: input, cubeCenter: serialize(CENTER), cubeOrientation: [0, 0, 0, 1], thresholdMM: 0.3, samplesPerTurn: intervals + 1, armLengths: ARM_LENGTHS, wristLength: WRIST_LENGTH, scope: "Actual STL vertices vs separately moving R/L slab and static cube; interhand mesh vertex containment; hand vertices vs rendered upper/forearm solids; all arm mesh vertices vs cube; cross-arm body penetration and reach", cases, afterR };
  const output = `evidence/finger-wrist-${label}.json`;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); console.log(output);
}
