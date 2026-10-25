/** Offline, deterministic transition carriers for the measured Wuji finger roles.
 * Only this script and evidence/finger-role-transitions.{json,summary.md} are written.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Box3, Group, Matrix4, Mesh, Quaternion, Ray, Triangle, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { DexterousHand } from "../src/scene/hand";
import { MechanicalArm, ARM_LENGTHS } from "../src/scene/arm";

type Side = "left" | "right";
type Pose = { position: number[]; quaternion: number[]; joints: Record<string, number> };
type ActiveContact = { side: Side; finger: number; padLocalOffset: number[]; cubeLocalPoint: number[]; normal: number[] };
type Frame = { progress: number; cubeAngle: number; left: Pose; right: Pose; activeContact?: ActiveContact };
type Segment = { id: string; side: Side; kind: string; frames: Frame[]; validation?: ReturnType<typeof validate>; validationReused?: boolean };
const sides: Side[] = ["left", "right"], center = new Vector3(0, 0.34, 0), axisY = new Vector3(0, 1, 0);
const sourcePath = "evidence/finger-role-strokes.json", outputPath = "evidence/finger-role-transitions.json";
const existingEvidence = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : undefined;
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!source.allStrokeChecksPass) throw new Error("Source stroke carrier has not passed its gates.");
const records = Object.fromEntries(source.hands.map((r: any) => [r.side, r])) as Record<Side, any>;
const divisions = 64, thresholdMM = 0.3;
const clone = <T>(value: T): T => structuredClone(value);
const other = (side: Side): Side => side === "left" ? "right" : "left";
const jointNames = (side: Side, finger: number) => Array.from({ length: 4 }, (_, i) => `${side}_finger${finger}_joint${i + 1}`);
const q = (a: number[]) => new Quaternion(...a as [number, number, number, number]);
const v = (a: number[]) => new Vector3(...a as [number, number, number]);
const poseOf = (value: any): Pose => ({ position: [...value.position], quaternion: [...value.quaternion], joints: { ...value.joints } });
const low = (side: Side) => poseOf(records[side].supportPose);
const high = (side: Side) => poseOf(records[side].activePose);
function move(pose: Pose, offset: number[]) { const copy = clone(pose); copy.position = v(copy.position).add(v(offset)).toArray(); return copy; }
function fingerPose(side: Side, finger: number, angles: number[], pose = high(side)) { const copy = clone(pose); jointNames(side, finger).forEach((name, i) => { copy.joints[name] = angles[i]; }); return copy; }
function mixPose(a: Pose, b: Pose, t: number): Pose {
  return { position: v(a.position).lerp(v(b.position), t).toArray(), quaternion: q(a.quaternion).slerp(q(b.quaternion), t).toArray(), joints: Object.fromEntries(Object.keys(a.joints).map((name) => [name, a.joints[name] + (b.joints[name] - a.joints[name]) * t])) };
}
function frame(side: Side, pose: Pose, progress: number, cubeAngle = 0): Frame {
  return { progress, cubeAngle, left: side === "left" ? clone(pose) : low("left"), right: side === "right" ? clone(pose) : low("right") };
}
function between(id: string, side: Side, kind: string, start: Pose, end: Pose): Segment {
  return { id, side, kind, frames: Array.from({ length: divisions + 1 }, (_, i) => frame(side, mixPose(start, end, i / divisions), i / divisions)) };
}
function reversed(segment: Segment, id: string): Segment {
  return { id, side: segment.side, kind: "role-return", frames: segment.frames.toReversed().map((f, i) => ({ ...clone(f), progress: i / divisions })) };
}

Object.assign(globalThis, { DOMParser, Document, Element });
const hands = {} as Record<Side, DexterousHand>, arms = {} as Record<Side, MechanicalArm>;
const assetHasher = createHash("sha256");
type Bound = { side: Side; finger: number; name: string; mesh: Mesh; local: OBB; world: OBB; inverse: Matrix4 };
const bounds = {} as Record<Side, Bound[]>;
for (const side of sides) {
  const directory = resolve("public/models/wuji/hand/body/urdf");
  const loader = new URDFLoader(); loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, done) => {
    const bytes = readFileSync(url);
    assetHasher.update(url).update(bytes);
    const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.deleteAttribute("normal"); const merged = mergeVertices(geometry, 1e-6); geometry.dispose();
    done(new Mesh(merged, material));
  };
  const urdf = readFileSync(`${directory}/${side}.urdf`, "utf8"); assetHasher.update(urdf);
  hands[side] = new DexterousHand(loader.parse(urdf, directory + "/"), side);
  arms[side] = new MechanicalArm(side);
  bounds[side] = [];
  hands[side].root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.computeBoundingBox();
    let link = node.parent; while (link && !/finger\d|palm/.test(link.name)) link = link.parent;
    bounds[side].push({ side, finger: Number(link?.name.match(/finger(\d)/)?.[1] ?? 0), name: link?.name ?? "unknown", mesh: node, local: new OBB().fromBox3(node.geometry.boundingBox!), world: new OBB(), inverse: new Matrix4() });
  });
}
const links = sides.flatMap((side) => (["upper", "fore"] as const).map((part) => {
  const root = arms[side].root.getObjectByName(`${side}-${part === "upper" ? "upper-arm" : "forearm"}`) as Group;
  const length = ARM_LENGTHS[part], meshes: Mesh[] = [];
  root.traverse((node) => { if (node instanceof Mesh) { node.geometry.computeBoundingBox(); meshes.push(node); } });
  return { side, part, root, length, meshes, inverse: new Matrix4(), world: new OBB(), local: new OBB().fromBox3(new Box3(new Vector3(-0.03, -length / 2, -0.035), new Vector3(0.03, length / 2, 0.035))) };
}));
const selfCache = new Map<string, { depthMM: number; pair: string }>();
function apply(f: Frame) {
  for (const side of sides) {
    const pose = f[side];
    hands[side].root.position.fromArray(pose.position); hands[side].root.quaternion.fromArray(pose.quaternion);
    hands[side].robot.setJointValues(pose.joints); hands[side].root.updateMatrixWorld(true);
    arms[side].update(v(pose.position), q(pose.quaternion)); arms[side].root.updateMatrixWorld(true);
    for (const bound of bounds[side]) { bound.world.copy(bound.local).applyMatrix4(bound.mesh.matrixWorld); bound.inverse.copy(bound.mesh.matrixWorld).invert(); }
  }
  for (const link of links) { link.world.copy(link.local).applyMatrix4(link.root.matrixWorld); link.inverse.copy(link.root.matrixWorld).invert(); }
}
const triangle = new Triangle(), ray = new Ray(), direction = new Vector3(1, 0.371, 0.219).normalize();
function insideDepth(a: Bound, b: Bound) {
  const matrix = b.inverse.clone().multiply(a.mesh.matrixWorld), points = a.mesh.geometry.getAttribute("position"), vertices = b.mesh.geometry.getAttribute("position"), indices = b.mesh.geometry.index;
  const count = indices?.count ?? vertices.count, p = new Vector3(), hit = new Vector3(), closest = new Vector3();
  let depth = 0;
  for (let i = 0; i < points.count; i++) {
    p.fromBufferAttribute(points, i).applyMatrix4(matrix);
    if (!b.mesh.geometry.boundingBox!.containsPoint(p)) continue;
    ray.set(p, direction); const hits: number[] = [];
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(t) : t); triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(t + 1) : t + 1); triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(t + 2) : t + 2);
      if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) hits.push(p.distanceToSquared(hit));
    }
    hits.sort((a, b) => a - b);
    if (hits.filter((x, j) => j === 0 || Math.abs(x - hits[j - 1]) > 1e-11).length % 2 !== 1) continue;
    let nearest = Infinity;
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(t) : t); triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(t + 1) : t + 1); triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(t + 2) : t + 2);
      triangle.closestPointToPoint(p, closest); nearest = Math.min(nearest, p.distanceToSquared(closest));
    }
    depth = Math.max(depth, Math.sqrt(nearest) * 1000);
  }
  return depth;
}
function pairDepth(a: Bound[], b: Bound[], sameSide = false) {
  let depthMM = 0, pair = "";
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const left = a[i], right = b[j];
    if (sameSide && (j <= i || !left.finger || !right.finger || left.finger === right.finger)) continue;
    if (!left.world.intersectsOBB(right.world)) continue;
    const depth = Math.max(insideDepth(left, right), insideDepth(right, left));
    if (depth > depthMM) { depthMM = depth; pair = `${left.name} / ${right.name}`; }
  }
  return { depthMM, pair };
}
function selfDepth(side: Side, pose: Pose) {
  // Same-hand containment depends on joint angles, not its rigid world pose.
  const key = `${side}:${Object.values(pose.joints).map((a) => a.toFixed(9)).join(",")}`;
  if (!selfCache.has(key)) selfCache.set(key, pairDepth(bounds[side], bounds[side], true));
  return selfCache.get(key)!;
}
function boxDepth(p: Vector3) { return Math.min(0.045 - Math.abs(p.x), 0.045 - Math.abs(p.y), 0.045 - Math.abs(p.z)); }
function cubeDepth(meshes: Mesh[], angle: number) {
  const inverseTurn = new Quaternion().setFromAxisAngle(axisY, -angle), point = new Vector3(), rotated = new Vector3();
  let depthMM = 0, meshName = "";
  for (const mesh of meshes) {
    const vertices = mesh.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).sub(center);
      const lower = Math.min(boxDepth(point), 0.015 - point.y);
      rotated.copy(point).applyQuaternion(inverseTurn);
      const depth = Math.max(lower, Math.min(boxDepth(rotated), point.y - 0.015)) * 1000;
      if (depth > depthMM) { depthMM = depth; meshName = mesh.parent?.parent?.name ?? "unknown"; }
    }
  }
  return { depthMM, meshName };
}
const bodyQ = new Vector3();
function bodyDepth(p: Vector3, length: number) {
  const radius = 0.008;
  bodyQ.set(Math.abs(p.x) - (0.047 / 2 - radius), Math.abs(p.y) - (length * 0.77 / 2 - radius), Math.abs(p.z) - (0.041 / 2 - radius));
  const shell = radius - (Math.hypot(Math.max(bodyQ.x, 0), Math.max(bodyQ.y, 0), Math.max(bodyQ.z, 0)) + Math.min(Math.max(bodyQ.x, bodyQ.y, bodyQ.z), 0));
  const half = (length - 0.028) / 2, taper = 0.025 - 0.004 * (p.y + half) / (2 * half);
  return Math.max(shell, Math.min(half - Math.abs(p.y), taper - Math.hypot(p.x, p.z)));
}
const armMeshBox = new OBB();
function intoArm(mesh: Mesh, link: (typeof links)[number]) {
  armMeshBox.fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  if (!armMeshBox.intersectsOBB(link.world)) return 0;
  const matrix = link.inverse.clone().multiply(mesh.matrixWorld), points = mesh.geometry.getAttribute("position"), point = new Vector3();
  let depthMM = 0;
  for (let i = 0; i < points.count; i++) depthMM = Math.max(depthMM, bodyDepth(point.fromBufferAttribute(points, i).applyMatrix4(matrix), link.length) * 1000);
  return depthMM;
}
function mixFrame(a: Frame, b: Frame, t: number): Frame {
  const f: Frame = { progress: a.progress + (b.progress - a.progress) * t, cubeAngle: a.cubeAngle + (b.cubeAngle - a.cubeAngle) * t, left: mixPose(a.left, b.left, t), right: mixPose(a.right, b.right, t) };
  if (a.activeContact && b.activeContact) f.activeContact = { ...a.activeContact, padLocalOffset: v(a.activeContact.padLocalOffset).lerp(v(b.activeContact.padLocalOffset), t).toArray() };
  return f;
}
function validate(segment: Segment) {
  const maximum = { handCubeMM: 0, selfContainmentMM: 0, handHandMM: 0, handArmMM: 0, crossArmMM: 0, armCubeMM: 0, reachErrorMM: 0, supportErrorMM: 0, activeErrorMM: 0, jointLimitRadians: 0, elbowStepMM: 0 };
  const failures: any[] = []; let firstFailure: any; const previous = {} as Record<Side, Vector3>;
  const supportSide = other(segment.side), supportContacts = records[supportSide].supportPose.contacts;
  for (let i = 0; i < segment.frames.length * 2 - 1; i++) {
    const start = segment.frames[Math.floor(i / 2)], end = segment.frames[Math.min(Math.floor(i / 2) + 1, segment.frames.length - 1)], f = i % 2 ? mixFrame(start, end, 0.5) : start;
    apply(f);
    const metric = { ...maximum }; Object.keys(metric).forEach((key) => { metric[key as keyof typeof metric] = 0; });
    let detail: any = {};
    for (const side of sides) {
      const cube = cubeDepth(bounds[side].map((b) => b.mesh), f.cubeAngle); metric.handCubeMM = Math.max(metric.handCubeMM, cube.depthMM);
      if (cube.depthMM > thresholdMM) detail.cube = { side, ...cube };
      const self = selfDepth(side, f[side]); metric.selfContainmentMM = Math.max(metric.selfContainmentMM, self.depthMM);
      if (self.depthMM > thresholdMM) detail.self = { side, ...self };
      for (const [name, angle] of Object.entries(f[side].joints)) { const limit = hands[side].robot.joints[name].limit; metric.jointLimitRadians = Math.max(metric.jointLimitRadians, angle - limit.upper, limit.lower - angle); }
      const origin = new Vector3(side === "left" ? -0.355 : 0.355, 0.155, -0.09);
      metric.reachErrorMM = Math.max(metric.reachErrorMM, Math.abs(arms[side].elbowPosition.distanceTo(origin) - ARM_LENGTHS.upper) * 1000, Math.abs(arms[side].elbowPosition.distanceTo(arms[side].wristPosition) - ARM_LENGTHS.fore) * 1000);
      if (previous[side]) metric.elbowStepMM = Math.max(metric.elbowStepMM, previous[side].distanceTo(arms[side].elbowPosition) * 1000);
      previous[side] = arms[side].elbowPosition.clone();
    }
    const handPair = pairDepth(bounds.left, bounds.right); metric.handHandMM = handPair.depthMM;
    if (handPair.depthMM > thresholdMM) detail.hands = handPair;
    for (const contact of supportContacts) {
      const point = hands[supportSide].robot.links[`${supportSide}_finger${contact.finger}_tip_link`].localToWorld(v(contact.padLocalOffset));
      metric.supportErrorMM = Math.max(metric.supportErrorMM, point.distanceTo(v(contact.target)) * 1000);
    }
    if (f.activeContact) {
      const c = f.activeContact, point = hands[c.side].robot.links[`${c.side}_finger${c.finger}_tip_link`].localToWorld(v(c.padLocalOffset));
      const target = v(c.cubeLocalPoint).applyAxisAngle(axisY, f.cubeAngle).add(center);
      metric.activeErrorMM = point.distanceTo(target) * 1000;
    }
    for (const link of links) {
      for (const side of sides) for (const bound of bounds[side]) metric.handArmMM = Math.max(metric.handArmMM, intoArm(bound.mesh, link));
      for (const opposite of links.filter((l) => l.side !== link.side)) for (const mesh of opposite.meshes) metric.crossArmMM = Math.max(metric.crossArmMM, intoArm(mesh, link));
      metric.armCubeMM = Math.max(metric.armCubeMM, cubeDepth(link.meshes, f.cubeAngle).depthMM);
    }
    for (const key of Object.keys(maximum) as (keyof typeof maximum)[]) maximum[key] = Math.max(maximum[key], metric[key]);
    const invalid = Object.entries(metric).filter(([key, value]) => key === "jointLimitRadians" ? value > 1e-7 : key === "elbowStepMM" ? value > 40 : value > thresholdMM);
    if (invalid.length) { const failure = { sample: i, progress: f.progress, metric, invalid: invalid.map(([key]) => key), detail }; if (!firstFailure) firstFailure = { ...failure, frame: clone(f) }; failures.push(failure); }
  }
  return { passed: failures.length === 0, frames: segment.frames.length, checkedFrames: segment.frames.length * 2 - 1, maximum, firstFailure, failures };
}

const segments: Record<string, Segment> = {}, attempts: any[] = [];
const assetSHA256 = assetHasher.digest("hex");
const validatorDigest = createHash("sha256").update(readFileSync("scripts/finger-role-transitions.ts", "utf8").split("const segments: Record")[0]).update(readFileSync("src/scene/arm.ts")).update(JSON.stringify(source.hands)).update(assetSHA256).digest("hex");
function add(segment: Segment) {
  const previous = existingEvidence?.segments?.[segment.id];
  const reusable = !process.argv.includes("--fresh") && existingEvidence?.validatorDigest === validatorDigest && previous?.validation && JSON.stringify(previous.frames) === JSON.stringify(segment.frames);
  segment.validationReused = !!reusable;
  segment.validation = reusable ? previous.validation : validate(segment); segments[segment.id] = segment;
  console.log(JSON.stringify({ id: segment.id, passed: segment.validation.passed, reused: segment.validationReused, ...segment.validation.maximum, firstFailure: segment.validation.firstFailure?.detail }));
  return segment;
}
const rolePaths = {} as Record<Side, { exit: string[]; enter: string[] }>;
for (const side of sides) {
  const sign = side === "right" ? 1 : -1;
  const a = low(side), b = move(a, [sign * 0.020, 0, 0]);
  // The opposed thumb opens toward the cube's back: forward clearance is needed
  // in addition to lateral retreat, even though both endpoint poses are clear.
  const c = move(high(side), [sign * 0.030, 0, 0.040]), d = high(side);
  const rise = between(`${side}-role-rise-open`, side, "role-exit", b, c);
  // Let the wrist establish forward clearance before the thumb sweeps open.
  // This is a geometric path parameter, not a separate timing multiplier.
  for (const f of rise.frames) for (const name of jointNames(side, 1)) f[side].joints[name] = b.joints[name] + (c.joints[name] - b.joints[name]) * f.progress ** 2;
  const exiting = [
    add(between(`${side}-role-retreat`, side, "role-exit", a, b)),
    add(rise),
    add(between(`${side}-role-enter-high`, side, "role-exit", c, d)),
  ];
  const returning = exiting.toReversed().map((s, i) => add(reversed(s, `${side}-role-return-${i + 1}`)));
  rolePaths[side] = { exit: exiting.map((s) => s.id), enter: returning.map((s) => s.id) };
}
const strokePaths: Record<string, { prepare: string[]; turn: string; release: string[] }> = {};
for (const stroke of source.strokes) {
  const side = stroke.side as Side, finger = stroke.finger, id = stroke.id;
  const free = high(side), start = fingerPose(side, finger, stroke.samples[0].angles), end = fingerPose(side, finger, stroke.samples.at(-1).angles);
  const hover = stroke.hover.find((h: any) => h.end === "start" && h.posePass);
  if (!hover) throw new Error(`Missing accepted start hover: ${id}`);
  const startHover = fingerPose(side, finger, hover.angles);
  const prepare = [add(between(`${id}-prepare-hover`, side, "prepare", free, startHover)), add(between(`${id}-seat`, side, "seat", startHover, start))];
  const turn: Segment = { id: `${id}-turn`, side, kind: "turn", frames: stroke.samples.map((s: any) => {
    const f = frame(side, fingerPose(side, finger, s.angles), s.phase, s.angle);
    f.activeContact = { side, finger, padLocalOffset: s.padLocalOffset, cubeLocalPoint: v(stroke.samples[0].target).sub(center).toArray(), normal: [0, 1, 0] };
    return f;
  }) };
  add(turn);
  const endHover = stroke.hover.find((h: any) => h.end === "end" && h.posePass);
  let release: Segment[];
  if (endHover) {
    const pose = fingerPose(side, finger, endHover.angles);
    release = [add(between(`${id}-release-hover`, side, "release", end, pose)), add(between(`${id}-release-free`, side, "release", pose, free))];
  } else {
    const lifted = move(end, [0, 0.008, 0]), liftedFree = move(free, [0, 0.008, 0]);
    release = [add(between(`${id}-release-lift-wrist`, side, "release", end, lifted)), add(between(`${id}-release-free-raised`, side, "release", lifted, liftedFree)), add(between(`${id}-release-lower-wrist`, side, "release", liftedFree, free))];
  }
  strokePaths[id] = { prepare: prepare.map((s) => s.id), turn: turn.id, release: release.map((s) => s.id) };
}
const overlapPaths: Record<Side, { turn: string; release: string[] }> = {} as any;
for (const side of sides) {
  const index = strokePaths[`${side}-index`], normalTurn = segments[index.turn];
  const middle = source.strokes.find((s: any) => s.id === `${side}-middle`);
  const ready = middle.hover.find((h: any) => h.end === "start" && h.posePass).angles;
  const free = records[side].freeAngles[3];
  const overlap: Segment = { id: `${side}-index-turn-prepare-middle`, side, kind: "overlap-turn", frames: Array.from({ length: 321 }, (_, i) => {
    const progress = i / 320, scaled = progress * (normalTurn.frames.length - 1), index = Math.floor(scaled), fraction = scaled - index;
    const f = mixFrame(normalTurn.frames[index], normalTurn.frames[Math.min(index + 1, normalTurn.frames.length - 1)], fraction);
    const t = Math.max(0, Math.min(1, (progress - 0.8) / 0.2));
    const smooth = t ** 3 * (10 - 15 * t + 6 * t * t);
    jointNames(side, 3).forEach((name, j) => { f[side].joints[name] = free[j] + (ready[j] - free[j]) * smooth; });
    return f;
  }) };
  add(overlap);
  const release = index.release.map((id) => {
    const candidate = clone(segments[id]); candidate.id += "-middle-ready"; candidate.kind = "overlap-release"; delete candidate.validation;
    for (const f of candidate.frames) jointNames(side, 3).forEach((name, j) => { f[side].joints[name] = ready[j]; });
    return add(candidate).id;
  });
  overlapPaths[side] = { turn: overlap.id, release };
}
function poseGap(a: Pose, b: Pose) {
  return { wristMM: v(a.position).distanceTo(v(b.position)) * 1000, wristRadians: q(a.quaternion).angleTo(q(b.quaternion)), jointRadians: Math.max(...Object.keys(a.joints).map((name) => Math.abs(a.joints[name] - b.joints[name]))) };
}
function action(side: Side, double: boolean, overlap = false) {
  const refs: { segment: string; angleOffset: number }[] = [];
  let offset = 0;
  const append = (ids: string[]) => ids.forEach((segment) => refs.push({ segment, angleOffset: offset }));
  append(rolePaths[side].exit);
  for (const name of double ? ["index", "middle"] : ["index"]) {
    const path = strokePaths[`${side}-${name}`];
    append(overlap && name === "middle" ? path.prepare.slice(1) : path.prepare);
    append([overlap && name === "index" ? overlapPaths[side].turn : path.turn]);
    offset += side === "right" ? -Math.PI / 2 : Math.PI / 2;
    append(overlap && name === "index" ? overlapPaths[side].release : path.release);
  }
  append(rolePaths[side].enter);
  const boundaries = refs.slice(1).map((ref, i) => {
    const previous = refs[i], a = segments[previous.segment].frames.at(-1)!, b = segments[ref.segment].frames[0];
    return { from: previous.segment, to: ref.segment, left: poseGap(a.left, b.left), right: poseGap(a.right, b.right), cubeAngleGap: Math.abs(a.cubeAngle + previous.angleOffset - b.cubeAngle - ref.angleOffset) };
  });
  return { side, turns: double ? 2 : 1, segments: refs, boundaries, passed: refs.every((ref) => segments[ref.segment].validation!.passed) && boundaries.every((b) => b.cubeAngleGap < 1e-9 && [b.left, b.right].every((p) => p.wristMM < 1e-6 && p.wristRadians < 1e-7 && p.jointRadians < 1e-9)) };
}
const actions = { U: action("right", false), UPrime: action("left", false), U2: action("right", true), U2Prime: action("left", true) };
const overlapActions = { U2: action("right", true, true), U2Prime: action("left", true, true) };
const previous = existingEvidence;
const history = previous?.failedAttempts ?? [];
if (previous && !previous.passed) history.push({ date: previous.date, scriptSHA256: previous.scriptSHA256, segments: Object.values(previous.segments).filter((s: any) => !s.validation.passed) });
const result = {
  date: new Date().toISOString(), version: 1, passed: Object.values(actions).every((a) => a.passed), source: { path: sourcePath, sha256: createHash("sha256").update(readFileSync(sourcePath)).digest("hex") },
  scriptSHA256: createHash("sha256").update(readFileSync("scripts/finger-role-transitions.ts")).digest("hex"), validatorDigest, assetSHA256, cubeCenter: center.toArray(), cubeOrientation: [0, 0, 0, 1], thresholdMM,
  sampling: "65 stored poses per segment, plus every interpolated midpoint checked. Parent can retime this geometric carrier without changing its path.",
  supportContacts: Object.fromEntries(sides.map((side) => [side, records[side].supportPose.contacts])),
  actions, overlapActions, segments, failedAttempts: [...history, ...attempts],
  limitations: ["Geometric evidence only; contacts are not a force-closure, friction, actuator-speed or hardware proof.", "Self collision checks cover different fingers; adjacent links of one finger and intentional wrist mounts are excluded.", "Mesh checks use STL vertices plus bidirectional vertex containment/triangle depth, not continuous triangle intersection.", "Arm checks cover rendered upper/forearm solids and reach; decorative joint/collar attachments are not independent collision bodies.", "Each non-turn segment is defined at cubeAngle=0. During assembly add the action reference angleOffset; top-layer cube geometry repeats every 90 degrees. Active material contact coordinates in turn frames must account for that offset when assigning cubie identity."]
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, passed: result.passed, actions: Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, a.passed])) }));
if (!result.passed) process.exitCode = 1;
