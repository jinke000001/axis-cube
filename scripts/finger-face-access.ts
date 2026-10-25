/** Actual Wuji/arm geometry probe for direct F/D/B face access with a fixed cube frame. */
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


const FACE_NORMALS = { F: new Vector3(0, 0, 1), D: new Vector3(0, -1, 0), B: new Vector3(0, 0, -1) };
type AccessFace = keyof typeof FACE_NORMALS;
function transformPose(pose: Pose, rotation: Quaternion): Pose {
  return { position: new Vector3().fromArray(pose.position).sub(CENTER).applyQuaternion(rotation).add(CENTER).toArray(), quaternion: rotation.clone().multiply(new Quaternion().fromArray(pose.quaternion)).toArray(), joints: { ...pose.joints } };
}
function transformedContacts(side: Side, rotation: Quaternion, role: "support" | "drive") {
  return grip[side].contacts.map((c) => ({ side, finger: c.finger, role, cubeLocalPoint: new Vector3().fromArray(c.target).sub(CENTER).applyQuaternion(rotation).toArray(), normal: new Vector3().fromArray(c.normal).applyQuaternion(rotation).toArray(), padOffset: c.padOffset }));
}
function posesForGate() {
  return Object.fromEntries(sides.map((side) => { const pose = current(side); return [side, { position: new Vector3().fromArray(pose.position), quaternion: new Quaternion().fromArray(pose.quaternion), joints: pose.joints, closed: 1 }]; })) as any;
}
function asContact(c: ReturnType<typeof transformedContacts>[number]): FingerContact {
  return { ...c, point: new Vector3().fromArray(c.cubeLocalPoint), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) };
}
function triangleArea(records: ReturnType<typeof transformedContacts>) {
  let area = 0;
  for (let a = 0; a < records.length; a++) for (let b = a + 1; b < records.length; b++) for (let c = b + 1; c < records.length; c++) {
    const p = new Vector3().fromArray(records[a].cubeLocalPoint), q = new Vector3().fromArray(records[b].cubeLocalPoint), r = new Vector3().fromArray(records[c].cubeLocalPoint);
    area = Math.max(area, q.sub(p).cross(r.sub(p)).length() / 2);
  }
  return area;
}
function selfCheck(side: Side) {
  let depthMM = 0;
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) depthMM = Math.max(depthMM, mutualHands(fingers[side][a], fingers[side][b]).depthMM);
  return depthMM;
}
function definitions(face: AccessFace, active: Side, roll: number) {
  const normal = FACE_NORMALS[face], initialNormal = new Vector3(active === "right" ? 1 : -1, 0, 0);
  const rotation = new Quaternion().setFromAxisAngle(normal, roll * Math.PI / 180).multiply(new Quaternion().setFromUnitVectors(initialNormal, normal));
  const other: Side = active === "right" ? "left" : "right";
  const initial = Object.fromEntries(sides.map((side) => [side, transformPose(grip[side].pose, rotation)])) as Record<Side, Pose>;
  const records = [...transformedContacts(active, rotation, "drive"), ...transformedContacts(other, rotation, "support")];
  return { face, active, other, roll, normal, rotation, initial, records };
}
function inspect(def: ReturnType<typeof definitions>, degrees: number, divisions: number, keepFrames: boolean) {
  const frames: any[] = [], worst: Record<string, any> = {};
  const maximum = { cubeDepthMM: 0, mutualDepthMM: 0, handArmDepthMM: 0, armCubeDepthMM: 0, crossArmDepthMM: 0, reachErrorMM: 0, contactErrorMM: 0, elbowJumpMM: 0 };
  let supportFailures = 0, bodyFailures = 0;
  const previousElbow = {} as Record<Side, Vector3>;
  const records = def.records.map(asContact), supports = def.records.filter((c) => c.role === "support");
  const move = { face: def.face, turns: 1, notation: def.face } as const;
  for (let i = 0; i <= divisions; i++) {
    const angle = degrees * Math.PI / 180 * i / divisions;
    const q = new Quaternion().setFromAxisAngle(def.normal, angle);
    apply(def.active, transformPose(def.initial[def.active], q)); apply(def.other, def.initial[def.other]);
    let elbowJumpMM = 0;
    for (const side of sides) { if (previousElbow[side]) elbowJumpMM = Math.max(elbowJumpMM, arms[side].elbowPosition.distanceTo(previousElbow[side]) * 1000); previousElbow[side] = arms[side].elbowPosition.clone(); }
    const poses = posesForGate(), supported = hasMeasuredSupport(poses, records, move, angle);
    if (!supported) supportFailures++;
    const measurements = records.map((contact) => measureContact(poses[contact.side], contact, move, angle));
    bodyFailures += measurements.filter((m) => !m.valid).length;
    const cube = { left: intoCube(meshes.left, def.normal, angle), right: intoCube(meshes.right, def.normal, angle) };
    const mutual = mutualHands(), arm = armCheck(def.normal, angle);
    const value = { cubeDepthMM: Math.max(cube.left.depthMM, cube.right.depthMM), mutualDepthMM: mutual.depthMM, handArmDepthMM: arm.handDepthMM, armCubeDepthMM: arm.armCube.depthMM, crossArmDepthMM: arm.crossArmDepthMM, reachErrorMM: arm.reachErrorMM, contactErrorMM: Math.max(...measurements.map((m) => m.error * 1000)), elbowJumpMM };
    for (const key of Object.keys(maximum) as (keyof typeof maximum)[]) if (value[key] > maximum[key]) { maximum[key] = value[key]; worst[key] = { progress: i / divisions, angle, value: value[key], cube, mutual, arm }; }
    if (keepFrames) frames.push({ progress: i / divisions, angle, left: current("left"), right: current("right"), supported, contacts: records.map((contact, index) => ({ side: contact.side, finger: contact.finger, role: contact.role, point: measurements[index].actual.toArray(), target: measurements[index].target.toArray(), residualMM: measurements[index].error * 1000 })), ...value });
  }
  const passed = !supportFailures && !bodyFailures && Math.max(maximum.cubeDepthMM, maximum.mutualDepthMM, maximum.handArmDepthMM, maximum.armCubeDepthMM, maximum.crossArmDepthMM, maximum.contactErrorMM) <= .3 && maximum.reachErrorMM < 1 && maximum.elbowJumpMM < (divisions >= 64 ? 40 : 200);
  return { id: `${def.face}-${def.active}-roll${def.roll}-${degrees}`, face: def.face, active: def.active, support: def.other, rollDegrees: def.roll, turnDegrees: degrees, rotation: def.rotation.toArray(), initial: def.initial, contacts: def.records, supportAreaM2: triangleArea(supports), sampleCount: divisions + 1, maximum, supportFailures, bodyFailures, passed, worst, frames: keepFrames ? frames : undefined };
}
const coarse: any[] = [], dense: any[] = [];
const previous = process.argv.includes("--refine") ? JSON.parse(readFileSync("evidence/finger-face-access.json", "utf8")) : null;
if (previous && previous.sourceSHA256 !== createHash("sha256").update(readFileSync(input)).digest("hex")) throw new Error("Cannot reuse evidence after the source grip changed.");
for (const face of ["F", "D", "B"] as AccessFace[]) {
  if (previous) coarse.push(...previous.coarse.filter((c: any) => c.face === face));
  else for (const active of ["right", "left"] as Side[]) for (const roll of [0, 90, 180, 270]) for (const degrees of [-90, 90]) {
    const result = inspect(definitions(face, active, roll), degrees, 8, false); coarse.push(result);
    console.log(JSON.stringify({ stage: "coarse", id: result.id, passed: result.passed, maximum: result.maximum, supportFailures: result.supportFailures, bodyFailures: result.bodyFailures }));
  }
  const candidates = coarse.filter((c) => c.face === face && c.passed);
  // Prefer a single initial grasp for both directions when physically feasible.
  // Sum both directions' arm excursion so selection cannot accidentally choose
  // different roots per direction after merely prioritizing paired candidates.
  const pairs = candidates.filter((c) => c.turnDegrees === -90).map((negative) => ({ negative, positive: candidates.find((c) => c.active === negative.active && c.rollDegrees === negative.rollDegrees && c.turnDegrees === 90) })).filter((pair) => pair.positive);
  pairs.sort((a, b) => Math.round((a.negative.maximum.elbowJumpMM + a.positive.maximum.elbowJumpMM) * 1e6) - Math.round((b.negative.maximum.elbowJumpMM + b.positive.maximum.elbowJumpMM) * 1e6) || a.negative.id.localeCompare(b.negative.id));
  candidates.sort((a, b) => Math.round(a.maximum.elbowJumpMM * 1e6) - Math.round(b.maximum.elbowJumpMM * 1e6) || a.id.localeCompare(b.id));
  for (const direction of [-90, 90]) {
    const best = pairs.length ? (direction === -90 ? pairs[0].negative : pairs[0].positive) : candidates.find((c) => c.turnDegrees === direction);
    if (!best) continue;
    const cached = previous?.dense.find((c: any) => c.id === best.id && c.sampleCount === intervals + 1 && c.passed);
    const result = cached ?? inspect(definitions(face, best.active, best.rollDegrees), direction, intervals, true); dense.push(result);
    console.log(JSON.stringify({ stage: cached ? "reused-dense" : "dense", id: result.id, passed: result.passed, maximum: result.maximum, supportFailures: result.supportFailures, bodyFailures: result.bodyFailures }));
  }
}
const output = "evidence/finger-face-access.json";
writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), source: input, sourceSHA256: createHash("sha256").update(readFileSync(input)).digest("hex"), cubeCenter: CENTER.toArray(), cubeOrientation: [0, 0, 0, 1], penetrationThresholdMM: .3, supportAreaThresholdM2: .00015, coarse, dense,
 scope: "Both existing baseline hand grips are transformed by a cube symmetry while cube overall orientation stays identity. Only the active hand rotates around the target face normal. Manufacturer joints are unchanged. Checks use actual STL and fixed mechanical-arm bases, exact URDF contact FK and production hasMeasuredSupport. No approach, whole-cube reorientation, or transitions between face grasps are implied." }, null, 2) + "\n");
console.log(output);
const primitiveOutput = "evidence/finger-face-primitives.json";
writeFileSync(primitiveOutput, JSON.stringify({
  version: 1,
  source: output,
  sourceSHA256: createHash("sha256").update(readFileSync(output)).digest("hex"),
  cubeCenter: CENTER.toArray(), cubeOrientation: [0, 0, 0, 1],
  poseInterpolation: "At progress t, keep the support side at initial[side]; set Q=Quaternion(normal,turnRadians*t), active.position=CENTER+Q*(initial.position-CENTER), active.quaternion=Q*initial.quaternion. All 20 actual URDF joint values remain unchanged.",
  boundaries: ["Entry and exit regrips have not been validated.", "These are quarter turns. A half turn cannot be inferred by extending the orbit.", "Inverse playback of an accepted segment has identical geometric bounds, starting from its end grip.", "The cube frame stays identity throughout the layer turn. This does not prove a collision-free transition between different face grips."],
  primitives: dense.filter((c) => c.passed).map((c) => ({
    id: c.id, face: c.face, active: c.active, support: c.support,
    normal: FACE_NORMALS[c.face as AccessFace].toArray(), turnRadians: c.turnDegrees * Math.PI / 180,
    templateRotation: c.rotation, initial: c.initial, contacts: c.contacts,
    validation: { sampleCount: c.sampleCount, maximum: c.maximum, supportAreaM2: c.supportAreaM2, supportFailures: c.supportFailures, bodyFailures: c.bodyFailures, passed: c.passed },
  })),
}, null, 2) + "\n");
console.log(primitiveOutput);
