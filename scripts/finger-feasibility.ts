/** Independent Wuji finger-workspace exploration. No application files are changed. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Matrix3, Matrix4, Mesh, Quaternion, Ray, Triangle, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { DexterousHand } from "../src/scene/hand";
import { canonical, CENTER, type Side } from "../src/scene/motion";
import calibration from "../src/scene/grips.json";

Object.assign(globalThis, { DOMParser, Document, Element });
const sides: Side[] = ["left", "right"];
const wristPitch = process.argv.includes("--pitch") ? Number(process.argv[process.argv.indexOf("--pitch") + 1]) : 0;
const hands = {} as Record<Side, DexterousHand>;
const v = (p: Vector3) => p.toArray().map((x) => +x.toFixed(7));
function names(side: Side, finger: number) {
  return Array.from({ length: 4 }, (_, i) => `${side}_finger${finger}_joint${i + 1}`);
}
for (const side of sides) {
  const directory = resolve("public/models/wuji/hand/body/urdf");
  const loader = new URDFLoader();
  loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, onLoad) => {
    const bytes = readFileSync(url);
    const geometry = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    geometry.deleteAttribute("normal");
    const merged = mergeVertices(geometry, 1e-6);
    geometry.dispose();
    onLoad(new Mesh(merged, material));
  };
  const robot = loader.parse(readFileSync(`${directory}/${side}.urdf`, "utf8"), directory + "/");
  hands[side] = new DexterousHand(robot, side);
}

/** Local +Z points from wrist to fingers; human hold points it toward cube back. */
function humanBasis(side: Side) {
  const basis = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      new Vector3(side === "right" ? -1 : 1, 0, 0),
      new Vector3(0, side === "right" ? 1 : -1, 0),
      new Vector3(0, 0, -1),
    ),
  );
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), wristPitch * Math.PI / 180).multiply(basis);
}
function setWrist(side: Side, position: Vector3, quaternion: Quaternion) {
  hands[side].root.position.copy(position);
  hands[side].root.quaternion.copy(quaternion);
  hands[side].root.updateMatrixWorld(true);
}
function tip(side: Side, finger: number) {
  hands[side].root.updateMatrixWorld(true);
  return hands[side].robot.links[`${side}_finger${finger}_tip_link`].getWorldPosition(new Vector3());
}
function jointValues(side: Side, finger: number) {
  return names(side, finger).map((name) => hands[side].robot.joints[name].angle);
}
function setAngles(side: Side, finger: number, angles: number[]) {
  names(side, finger).forEach((name, i) => hands[side].robot.joints[name].setJointValue(angles[i]));
}
const padOffset = new Vector3(0, 0, 0.0022);
const padMeshes = {} as Record<Side, Mesh[]>;
for (const side of sides) padMeshes[side] = Array.from({ length: 5 }, (_, i) => {
  let result: Mesh | undefined;
  hands[side].robot.links[`${side}_finger${i + 1}_tip_link`].traverse((node) => { if (node instanceof Mesh) result = node; });
  return result!;
});
function contactPoint(side: Side, finger: number, normal: Vector3) {
  hands[side].root.updateMatrixWorld(true);
  const mesh = padMeshes[side][finger - 1];
  const localNormal = normal.clone().applyQuaternion(mesh.getWorldQuaternion(new Quaternion()).invert());
  const vertices = mesh.geometry.getAttribute("position");
  const p = new Vector3();
  let minimum = Infinity;
  for (let i = 0; i < vertices.count; i++) minimum = Math.min(minimum, p.fromBufferAttribute(vertices, i).dot(localNormal));
  let count = 0;
  const local = new Vector3();
  for (let i = 0; i < vertices.count; i++) {
    p.fromBufferAttribute(vertices, i);
    if (p.dot(localNormal) <= minimum + 0.00015) { local.add(p); count++; }
  }
  local.divideScalar(count);
  return { point: mesh.localToWorld(local.clone()), local, supportProjection: minimum };
}
function closestPadSurface(side: Side, finger: number, target: Vector3) {
  hands[side].root.updateMatrixWorld(true);
  const mesh = padMeshes[side][finger - 1];
  const localTarget = mesh.worldToLocal(target.clone());
  const vertices = mesh.geometry.getAttribute("position"), indices = mesh.geometry.index;
  const triangle = new Triangle(), point = new Vector3();
  let best = Infinity;
  const local = new Vector3(), localNormal = new Vector3();
  const count = indices?.count ?? vertices.count;
  for (let i = 0; i < count; i += 3) {
    triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(i) : i);
    triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(i + 1) : i + 1);
    triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(i + 2) : i + 2);
    triangle.closestPointToPoint(localTarget, point);
    const squared = point.distanceToSquared(localTarget);
    if (squared < best) { best = squared; local.copy(point); triangle.getNormal(localNormal); }
  }
  return { distanceMM: Math.sqrt(best) * 1000, local, point: mesh.localToWorld(local.clone()), normal: localNormal.applyQuaternion(mesh.getWorldQuaternion(new Quaternion())) };
}
function padPoint(side: Side, finger: number, offset = padOffset) {
  hands[side].root.updateMatrixWorld(true);
  return hands[side].robot.links[`${side}_finger${finger}_tip_link`].localToWorld(offset.clone());
}
function ik(side: Side, finger: number, target: Vector3, iterations = 65, offset = padOffset, normal?: Vector3) {
  const hand = hands[side];
  const joints = names(side, finger).map((name) => hand.robot.joints[name]);
  let best = Infinity, bestAngles = jointValues(side, finger);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const point = normal ? contactPoint(side, finger, normal).point : padPoint(side, finger, offset), error = target.clone().sub(point);
    const squared = error.lengthSq();
    if (squared < best) { best = squared; bestAngles = jointValues(side, finger); }
    if (squared < 1e-12) break;
    const jac = joints.map((j) => j.axis.clone().applyQuaternion(j.getWorldQuaternion(new Quaternion())).cross(point.clone().sub(j.getWorldPosition(new Vector3()))));
    const lambda = 0.000006;
    const a = new Matrix3().set(
      jac.reduce((s, j) => s + j.x * j.x, lambda), jac.reduce((s, j) => s + j.x * j.y, 0), jac.reduce((s, j) => s + j.x * j.z, 0),
      jac.reduce((s, j) => s + j.y * j.x, 0), jac.reduce((s, j) => s + j.y * j.y, lambda), jac.reduce((s, j) => s + j.y * j.z, 0),
      jac.reduce((s, j) => s + j.z * j.x, 0), jac.reduce((s, j) => s + j.z * j.y, 0), jac.reduce((s, j) => s + j.z * j.z, lambda),
    ).invert();
    const update = error.applyMatrix3(a);
    joints.forEach((j, i) => j.setJointValue(j.angle + Math.max(-0.20, Math.min(0.20, jac[i].dot(update)))));
  }
  setAngles(side, finger, bestAngles);
  const contact = normal ? contactPoint(side, finger, normal) : undefined;
  return { errorMM: Math.sqrt(best) * 1000, angles: bestAngles, point: v(contact?.point ?? padPoint(side, finger, offset)), padOffset: v(contact?.local ?? offset) };
}
function fingerPenetration(side: Side, finger: number, angle = 0) {
  const hand = hands[side];
  hand.root.updateMatrixWorld(true);
  let worst = 0, vertices = 0, link = "", worstPoint: number[] = [];
  const point = new Vector3(), inverseTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -angle);
  const depth = (p: Vector3) => Math.min(0.045 - Math.abs(p.x), 0.045 - Math.abs(p.y), 0.045 - Math.abs(p.z));
  hand.robot.links[`${side}_finger${finger}_link1`].traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const points = node.geometry.getAttribute("position");
    for (let i = 0; i < points.count; i++) {
      point.fromBufferAttribute(points, i).applyMatrix4(node.matrixWorld).sub(CENTER);
      const d = angle ? Math.max(Math.min(depth(point), 0.015 - point.y), Math.min(depth(point.clone().applyQuaternion(inverseTurn)), point.y - 0.015)) : depth(point);
      if (d > 0.0003) { if (d > worst) { worst = d; link = node.parent?.parent?.name ?? "unknown"; worstPoint = v(point.clone().add(CENTER)); } vertices++; }
    }
  });
  return { depthMM: worst * 1000, vertices, link, point: worstPoint };
}
function fingerUSweepPenetration(side: Side, finger: number) {
  hands[side].root.updateMatrixWorld(true);
  const point = new Vector3();
  let max = 0, count = 0, link = "";
  hands[side].robot.links[`${side}_finger${finger}_link1`].traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const vertices = node.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(node.matrixWorld).sub(CENTER);
      const lower = Math.min(0.045 - Math.abs(point.x), 0.015 - point.y, 0.045 + point.y, 0.045 - Math.abs(point.z));
      const swept = Math.min(Math.SQRT2 * 0.045 - Math.hypot(point.x, point.z), point.y - 0.015, 0.045 - point.y);
      const depth = Math.max(lower, swept);
      if (depth > 0.0003) { count++; if (depth > max) { max = depth; link = node.parent?.parent?.name ?? "unknown"; } }
    }
  });
  return { depthMM: max * 1000, vertices: count, link };
}
function seed(side: Side, finger: number) {
  setAngles(side, finger, names(side, finger).map((name) => calibration[side][name as keyof typeof calibration[typeof side]]));
}
/** Narrow phase for conservative OBB warnings: vertex containment plus actual triangle depth. */
function meshInsideDepth(source: Mesh, target: Mesh) {
  const transform = target.matrixWorld.clone().invert().multiply(source.matrixWorld);
  const src = source.geometry.getAttribute("position"), vertices = target.geometry.getAttribute("position"), indices = target.geometry.index;
  const count = indices?.count ?? vertices.count;
  const triangle = new Triangle(), point = new Vector3(), hit = new Vector3(), closest = new Vector3();
  const ray = new Ray(), direction = new Vector3(1, 0.371, 0.219).normalize();
  let maximum = 0;
  for (let i = 0; i < src.count; i++) {
    point.fromBufferAttribute(src, i).applyMatrix4(transform);
    if (!target.geometry.boundingBox!.containsPoint(point)) continue;
    ray.set(point, direction);
    const hits: number[] = [];
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(t) : t);
      triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(t + 1) : t + 1);
      triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(t + 2) : t + 2);
      if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) hits.push(point.distanceToSquared(hit));
    }
    hits.sort((a, b) => a - b);
    if (hits.filter((d, j) => j === 0 || Math.abs(d - hits[j - 1]) > 1e-11).length % 2 !== 1) continue;
    let nearest = Infinity;
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(t) : t);
      triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(t + 1) : t + 1);
      triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(t + 2) : t + 2);
      triangle.closestPointToPoint(point, closest);
      nearest = Math.min(nearest, point.distanceToSquared(closest));
    }
    maximum = Math.max(maximum, Math.sqrt(nearest) * 1000);
  }
  return maximum;
}

if (process.argv.includes("--validate-roles")) {
  const supportSource = "evidence/finger-u-assisted-u90-trajectory.json";
  const assisted = JSON.parse(readFileSync(supportSource, "utf8"));
  const original = JSON.parse(readFileSync("evidence/finger-contact-trials.json", "utf8"));
  const records = sides.map((side) => {
    const sign = side === "right" ? 1 : -1;
    const position = [sign * 0.09, 0.34, 0.14];
    const quaternion = side === "right" ? [0, 1, 0, 0] : [1, 0, 0, 0];
    setWrist(side, new Vector3(...position), new Quaternion(...quaternion));
    const freeAngles: Record<number, number[]> = {
      1: [0.35, 0, 0.15, 0.15],
      2: [0.06, sign * 0.3, 0.12, 0.15],
      3: [0.06, 0, 0.12, 0.15],
      4: [0.06, 0, 0.12, 0.15],
      5: [0.06, 0, 0.12, 0.15],
    };
    for (let finger = 1; finger <= 5; finger++) setAngles(side, finger, freeAngles[finger]);
    const contacts = assisted.supports.filter((c: any) => [1, 4, 5].includes(c.finger)).map((contact: any) => {
      const target = new Vector3(...contact.cubeLocalPoint).add(CENTER); target.x = Math.abs(target.x) * sign;
      const normal = new Vector3(...contact.normal); normal.x = Math.abs(normal.x) * sign;
      if (side === "left") setAngles(side, contact.finger, names("left", contact.finger).map((name) => assisted.frames[0].left.joints[name]));
      else {
        const initial = original.hands.find((h: any) => h.side === side).fingers.find((f: any) => f.finger === contact.finger).angles;
        setAngles(side, contact.finger, initial);
        ik(side, contact.finger, target, 120, padOffset, normal);
      }
      const surface = closestPadSurface(side, contact.finger, target);
      return { finger: contact.finger, role: "static-support", target: v(target), normal: v(normal), angles: jointValues(side, contact.finger), padLocalOffset: surface.local.toArray(), residualMM: surface.distanceMM };
    });
    const joints: Record<string, number> = {};
    const activeJoints: Record<string, number> = {};
    for (let finger = 1; finger <= 5; finger++) names(side, finger).forEach((name, i) => { joints[name] = jointValues(side, finger)[i]; activeJoints[name] = freeAngles[finger][i]; });
    const supportSweep = [1, 2, 3, 4, 5].map((finger) => ({ finger, ...fingerUSweepPenetration(side, finger) }));
    return {
      side, freeAngles,
      supportPose: { position, quaternion, joints, contacts, freeFingers: [2, 3], supportSweep },
      activePose: { position: [sign * 0.08, 0.375, 0.13], quaternion, joints: activeJoints, contacts: [], freeFingers: [1, 2, 3, 4, 5] },
    };
  });
  function applyPose(side: Side, pose: any) { setWrist(side, new Vector3(...pose.position), new Quaternion(...pose.quaternion)); hands[side].robot.setJointValues(pose.joints); hands[side].root.updateMatrixWorld(true); }
  function applyRoles(activeSide: Side) { for (const record of records) applyPose(record.side, record.side === activeSide ? record.activePose : record.supportPose); }
  const meshBoxes = sides.map((side) => {
    const boxes: { name: string; finger: number; mesh: Mesh; local: OBB; world: OBB }[] = [];
    hands[side].root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.computeBoundingBox();
      let link = node.parent;
      while (link && !/finger\d|palm/.test(link.name)) link = link.parent;
      boxes.push({ name: link?.name ?? "unknown", finger: Number(link?.name.match(/finger(\d)/)?.[1] ?? 0), mesh: node, local: new OBB().fromBox3(node.geometry.boundingBox!), world: new OBB() });
    });
    return boxes;
  });
  const strokes: any[] = [];
  for (const side of sides) for (const finger of [2, 3]) {
    const source = `evidence/finger-multi-${side}-${finger}-top-x80-y35-z130-h45.json`;
    const path = JSON.parse(readFileSync(source, "utf8"));
    applyRoles(side);
    const supporter = records.find((record) => record.side !== side)!;
    const samples: any[] = [], frames: any[] = [];
    let maxCubeDepthMM = 0, maxSupportErrorMM = 0, maxActiveErrorMM = 0, maxSelfContainmentMM = 0;
    let worstDetails: any[] = [];
    const overlapPairs = new Set<string>(), selfOverlapPairs = new Set<string>();
    for (let i = 0; i < path.samples.length * 2 - 1; i++) {
      const start = path.samples[Math.floor(i / 2)], end = path.samples[Math.min(Math.floor(i / 2) + 1, path.samples.length - 1)], fraction = i % 2 ? 0.5 : 0;
      const angle = start.angle + (end.angle - start.angle) * fraction;
      const angles = start.angles.map((a: number, j: number) => a + (end.angles[j] - a) * fraction);
      setAngles(side, finger, angles);
      const target = new Vector3(...path.samples[0].target).sub(CENTER).applyAxisAngle(new Vector3(0, 1, 0), angle).add(CENTER);
      const surface = closestPadSurface(side, finger, target);
      maxActiveErrorMM = Math.max(maxActiveErrorMM, surface.distanceMM);
      let cubeDepthMM = 0;
      for (const current of sides) cubeDepthMM = Math.max(cubeDepthMM, hands[current].penetration(new Quaternion(), "U", angle).maxDepthMM);
      if (cubeDepthMM > maxCubeDepthMM + 0.01) worstDetails = sides.flatMap((current) => [1, 2, 3, 4, 5].map((f) => ({ side: current, finger: f, ...fingerPenetration(current, f, angle) }))).filter((r) => r.depthMM > 0.3).map((r) => ({ ...r, angle, phase: i / (path.samples.length * 2 - 2) }));
      maxCubeDepthMM = Math.max(maxCubeDepthMM, cubeDepthMM);
      for (const contact of supporter.supportPose.contacts) maxSupportErrorMM = Math.max(maxSupportErrorMM, padPoint(supporter.side, contact.finger, new Vector3(...contact.padLocalOffset)).distanceTo(new Vector3(...contact.target)) * 1000);
      for (const boxes of meshBoxes) for (const box of boxes) box.world.copy(box.local).applyMatrix4(box.mesh.matrixWorld);
      for (const a of meshBoxes[0]) for (const b of meshBoxes[1]) if (a.world.intersectsOBB(b.world)) overlapPairs.add(`${a.name} / ${b.name}`);
      const own = meshBoxes[side === "left" ? 0 : 1];
      for (const a of own.filter((b) => b.finger === finger)) for (const b of own.filter((b) => b.finger > 0 && b.finger !== finger)) if (a.world.intersectsOBB(b.world)) {
        selfOverlapPairs.add(`${a.name} / ${b.name}`);
        maxSelfContainmentMM = Math.max(maxSelfContainmentMM, meshInsideDepth(a.mesh, b.mesh), meshInsideDepth(b.mesh, a.mesh));
      }
      if (i % 2 === 0) samples.push({ phase: i / (path.samples.length * 2 - 2), angle, angles, target: v(target), normal: [0, 1, 0], padLocalOffset: surface.local.toArray(), surfacePoint: surface.point.toArray(), surfaceNormal: surface.normal.toArray(), contactDistanceMM: surface.distanceMM });
      frames.push({ phase: i / (path.samples.length * 2 - 2), angle, activeErrorMM: surface.distanceMM, cubeDepthMM });
    }
    let maxExportedPadInterpolationErrorMM = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      setAngles(side, finger, a.angles.map((value: number, j: number) => (value + b.angles[j]) / 2));
      const offset = new Vector3(...a.padLocalOffset).lerp(new Vector3(...b.padLocalOffset), 0.5);
      const target = new Vector3(...path.samples[0].target).sub(CENTER).applyAxisAngle(new Vector3(0, 1, 0), (a.angle + b.angle) / 2).add(CENTER);
      maxExportedPadInterpolationErrorMM = Math.max(maxExportedPadInterpolationErrorMM, padPoint(side, finger, offset).distanceTo(target) * 1000);
    }
    const hover = ["start", "end"].map((end) => {
      const sample = end === "start" ? samples[0] : samples.at(-1);
      const trials = [0.008, 0.005].map((height) => {
        setAngles(side, finger, sample.angles);
        const target = new Vector3(...sample.target).add(new Vector3(0, height, 0));
        const fit = ik(side, finger, target, 120, padOffset, new Vector3(0, 1, 0));
        const surface = closestPadSurface(side, finger, target);
        const cube = hands[side].penetration(new Quaternion(), "U", sample.angle);
        let selfDepth = 0;
        for (const boxes of meshBoxes) for (const box of boxes) box.world.copy(box.local).applyMatrix4(box.mesh.matrixWorld);
        const own = meshBoxes[side === "left" ? 0 : 1];
        for (const a of own.filter((b) => b.finger === finger)) for (const b of own.filter((b) => b.finger > 0 && b.finger !== finger)) if (a.world.intersectsOBB(b.world)) selfDepth = Math.max(selfDepth, meshInsideDepth(a.mesh, b.mesh), meshInsideDepth(b.mesh, a.mesh));
        return { end, clearanceMM: height * 1000, target: v(target), normal: [0, 1, 0], angles: fit.angles, padLocalOffset: surface.local.toArray(), targetSurfaceErrorMM: surface.distanceMM, cubeDepthMM: cube.maxDepthMM, selfContainmentMM: selfDepth, posePass: surface.distanceMM <= 0.3 && cube.maxDepthMM <= 0.3 && selfDepth <= 0.3 };
      });
      const chosen = trials.find((trial) => trial.posePass) ?? trials.toSorted((a, b) => a.targetSurfaceErrorMM - b.targetSurfaceErrorMM)[0];
      return { ...chosen, trials };
    });
    strokes.push({ id: `${side}-${finger === 2 ? "index" : "middle"}`, side, finger, source, samples, hover, validation: { frames: frames.length, maxCubeDepthMM, maxSupportErrorMM, maxActiveErrorMM, maxExportedPadInterpolationErrorMM, maxSelfContainmentMM, worstDetails, handHandOBBOverlaps: [...overlapPairs], activeVsOtherFingerOBBOverlaps: [...selfOverlapPairs], framesData: frames } });
  }
  const result = {
    date: new Date().toISOString(), version: 1, modelRevision: calibration.modelRevision, supportSource, cubeCenter: v(CENTER), cubeSize: 0.09, penetrationThresholdMM: 0.3,
    inputs: [supportSource, "evidence/finger-contact-trials.json", ...strokes.map((s) => s.source)].map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
    allStrokeChecksPass: records.every((r) => r.supportPose.contacts.every((c: any) => c.residualMM <= 0.3) && r.supportPose.supportSweep.every((f) => f.depthMM <= 0.3)) && strokes.every((s) => [s.validation.maxCubeDepthMM, s.validation.maxSupportErrorMM, s.validation.maxActiveErrorMM, s.validation.maxExportedPadInterpolationErrorMM, s.validation.maxSelfContainmentMM].every((value) => value <= 0.3) && s.validation.handHandOBBOverlaps.length === 0),
    scope: "Fixed wrist during each 90-degree stroke; opposite hand remains in low support pose with three static contacts. Active hand uses high pose; all fingers other than driver are free. Support/active role changes need separately validated approach and release paths.",
    hands: records, strokes,
    suggestedSequences: { U: ["right-index"], UPrime: ["left-index"], U2: ["right-index", "right-middle"], U2Prime: ["left-index", "left-middle"] },
    limitations: ["Approach, release, return, role exchange and index-to-middle handover are not validated. Hover entries certify only the static pose, not the path to/from it; posePass=false entries are not usable hovers.", "OBB warnings are followed by bidirectional mesh vertex containment with closest-triangle depth; that is still not a continuous triangle intersection proof.", "supportSweep.depthMM reports only vertices deeper than the 0.3 mm threshold; zero means no violation, not strict separation.", "All-STL-vertex checks at 129 frames per stroke are geometric sampling, not continuous collision or hardware force/friction/torque proof."]
  };
  console.log(JSON.stringify({ supports: records.map((r) => ({ side: r.side, contacts: r.supportPose.contacts, sweep: r.supportPose.supportSweep })), strokes: strokes.map((s) => ({ id: s.id, ...s.validation, framesData: undefined })) }, null, 2));
  if (process.argv.includes("--save")) writeFileSync("evidence/finger-role-strokes.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--validate-fixed")) {
  const sourceBase = "evidence/finger-top-base-x80-y35-z130.json";
  const base = JSON.parse(readFileSync(sourceBase, "utf8"));
  const baseHands = base.hands.map((record: any) => {
    const side = record.side as Side;
    const sign = side === "right" ? 1 : -1;
    const parked: Record<number, number[]> = { 2: [-0.12, sign * 0.12, -0.10, 0.05], 3: [-0.12, 0, -0.10, 0.05] };
    const joints: Record<string, number> = {};
    record.fingers.forEach((finger: any) => names(side, finger.finger).forEach((name, index) => { joints[name] = parked[finger.finger]?.[index] ?? finger.angles[index]; }));
    return {
      side,
      wrist: { position: record.position, quaternion: record.quaternion },
      joints,
      contacts: record.fingers.filter((f: any) => [1, 4, 5].includes(f.finger)).map((f: any) => ({ finger: f.finger, role: "static-support", target: f.target, normal: f.normal, padLocalOffset: f.padOffset, residualMM: f.errorMM })),
      freeFingers: [2, 3],
    };
  });
  function restoreBase() {
    for (const record of baseHands) {
      const side = record.side as Side;
      setWrist(side, new Vector3(...record.wrist.position), new Quaternion(...record.wrist.quaternion));
      hands[side].robot.setJointValues(record.joints);
      hands[side].root.updateMatrixWorld(true);
    }
  }
  restoreBase();
  for (const record of baseHands) for (const contact of record.contacts) {
    const surface = closestPadSurface(record.side, contact.finger, new Vector3(...contact.target));
    contact.padLocalOffset = surface.local.toArray();
    contact.residualMM = surface.distanceMM;
  }
  const meshBoxes = sides.map((side) => {
    const boxes: { name: string; finger: number; mesh: Mesh; local: OBB; world: OBB }[] = [];
    hands[side].root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.computeBoundingBox();
      let link = node.parent;
      while (link && !/finger\d|palm/.test(link.name)) link = link.parent;
      boxes.push({ name: link?.name ?? "unknown", finger: Number(link?.name.match(/finger(\d)/)?.[1] ?? 0), mesh: node, local: new OBB().fromBox3(node.geometry.boundingBox!), world: new OBB() });
    });
    return boxes;
  });
  const strokes: any[] = [];
  for (const side of sides) for (const finger of [2, 3]) {
    const source = `evidence/finger-multi-${side}-${finger}-top-x80-y35-z130-h45.json`;
    const path = JSON.parse(readFileSync(source, "utf8"));
    restoreBase();
    let maxCubeDepthMM = 0, maxSupportErrorMM = 0, maxActiveErrorMM = 0, maxEnvelopeAnchorErrorMM = 0;
    let worstDetails: unknown[] = [];
    const surfaceSamples: any[] = [];
    const overlapPairs = new Set<string>(), selfOverlapPairs = new Set<string>();
    const frames: any[] = [];
    // Original samples plus every interpolated midpoint: test the saved carrier,
    // not only the IK answers themselves.
    for (let i = 0; i < path.samples.length * 2 - 1; i++) {
      const start = path.samples[Math.floor(i / 2)], end = path.samples[Math.min(Math.floor(i / 2) + 1, path.samples.length - 1)], fraction = i % 2 ? 0.5 : 0;
      const angle = start.angle + (end.angle - start.angle) * fraction;
      const angles = start.angles.map((a: number, j: number) => a + (end.angles[j] - a) * fraction);
      setAngles(side, finger, angles);
      const target = new Vector3(...path.samples[0].target).sub(CENTER).applyAxisAngle(new Vector3(0, 1, 0), angle).add(CENTER);
      const actualContact = closestPadSurface(side, finger, target);
      const activeErrorMM = actualContact.distanceMM;
      maxActiveErrorMM = Math.max(maxActiveErrorMM, activeErrorMM);
      maxEnvelopeAnchorErrorMM = Math.max(maxEnvelopeAnchorErrorMM, contactPoint(side, finger, new Vector3(0, 1, 0)).point.distanceTo(target) * 1000);
      if (i % 2 === 0) surfaceSamples.push({ phase: i / (path.samples.length * 2 - 2), angle, angles, target: v(target), normal: [0, 1, 0], padLocalOffset: actualContact.local.toArray(), surfacePoint: actualContact.point.toArray(), surfaceNormal: actualContact.normal.toArray(), contactDistanceMM: actualContact.distanceMM });
      let cubeDepthMM = 0;
      for (const record of baseHands) {
        const current = record.side as Side;
        cubeDepthMM = Math.max(cubeDepthMM, hands[current].penetration(new Quaternion(), "U", angle).maxDepthMM);
        for (const contact of record.contacts) maxSupportErrorMM = Math.max(maxSupportErrorMM, padPoint(current, contact.finger, new Vector3(...contact.padLocalOffset)).distanceTo(new Vector3(...contact.target)) * 1000);
      }
      if (cubeDepthMM > maxCubeDepthMM + 0.01) worstDetails = sides.flatMap((current) => [1, 2, 3, 4, 5].map((f) => ({ side: current, finger: f, ...fingerPenetration(current, f, angle) }))).filter((record) => record.depthMM > 0.3).map((record) => ({ ...record, angle, phase: i / (path.samples.length * 2 - 2) }));
      maxCubeDepthMM = Math.max(maxCubeDepthMM, cubeDepthMM);
      for (const boxes of meshBoxes) for (const box of boxes) box.world.copy(box.local).applyMatrix4(box.mesh.matrixWorld);
      for (const a of meshBoxes[0]) for (const b of meshBoxes[1]) if (a.world.intersectsOBB(b.world)) overlapPairs.add(`${a.name} / ${b.name}`);
      const own = meshBoxes[side === "left" ? 0 : 1];
      for (const a of own.filter((b) => b.finger === finger)) for (const b of own.filter((b) => b.finger > 0 && b.finger !== finger)) if (a.world.intersectsOBB(b.world)) selfOverlapPairs.add(`${a.name} / ${b.name}`);
      frames.push({ phase: i / (path.samples.length * 2 - 2), activeErrorMM, cubeDepthMM });
    }
    strokes.push({ id: `${side}-${finger === 2 ? "index" : "middle"}`, side, finger, source, angleStart: 0, angleEnd: path.samples.at(-1).angle, wrist: { position: path.position, quaternion: path.quaternion }, samples: surfaceSamples, validation: { frames: frames.length, maxCubeDepthMM, maxSupportErrorMM, maxActiveErrorMM, maxEnvelopeAnchorErrorMM, worstDetails, handHandOBBOverlaps: [...overlapPairs], activeVsOtherFingerOBBOverlaps: [...selfOverlapPairs], framesData: frames } });
  }
  restoreBase();
  for (const record of baseHands) for (const contact of record.contacts) {
    const surface = closestPadSurface(record.side, contact.finger, new Vector3(...contact.target));
    contact.padLocalOffset = surface.local.toArray();
    contact.residualMM = surface.distanceMM;
  }
  const result = {
    date: new Date().toISOString(), modelRevision: calibration.modelRevision, cubeCenter: v(CENTER), cubeSize: 0.09, penetrationThresholdMM: 0.3,
    scope: "Fixed-wrist U/U-prime strokes and candidate index-middle double-flick carriers. Cube orientation is identity. Six thumb/ring/little contacts stay fixed; inactive index/middle fingers are free and parked.",
    hands: baseHands, strokes,
    suggestedSequences: { U: ["right-index"], UPrime: ["left-index"], U2: ["right-index", "right-middle"], U2Prime: ["left-index", "left-middle"] },
    limitations: ["Approach, release, return, and index-to-middle handover are not validated by these stroke-only carriers.", "OBB overlaps are conservative mesh-bound warnings, not triangle intersection proofs.", "Arm-body clearance and playback smoothness need runtime validation; no hardware force, torque, friction, or speed claim."]
  };
  console.log(JSON.stringify(strokes.map((stroke) => ({ id: stroke.id, ...stroke.validation, framesData: undefined })), null, 2));
  if (process.argv.includes("--save")) writeFileSync("evidence/finger-fixed-strokes.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--export-base")) {
  const trial = JSON.parse(readFileSync("evidence/finger-contact-trials.json", "utf8"));
  const records = trial.hands.map((record: any) => {
    const side = record.side as Side;
    setWrist(side, new Vector3(...record.position), new Quaternion(...record.quaternion));
    const joints: Record<string, number> = {};
    record.fingers.forEach((finger: any) => {
      setAngles(side, finger.finger, finger.angles);
      names(side, finger.finger).forEach((name, index) => { joints[name] = finger.angles[index]; });
    });
    hands[side].root.updateMatrixWorld(true);
    return { side, wrist: { position: record.position, quaternion: record.quaternion }, joints, contacts: record.fingers.map((finger: any) => ({ finger: finger.finger, role: finger.finger === 2 ? "upper-layer-ready; lift this finger when the opposite hand turns U" : "static-body-candidate", target: finger.target, normal: finger.normal, padLocalOffset: finger.padOffset, residualMM: finger.errorMM })), cubePenetration: hands[side].penetration() };
  });
  const boxes = sides.map((side) => {
    const result: { name: string, box: OBB }[] = [];
    hands[side].root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.computeBoundingBox();
      result.push({ name: node.parent?.parent?.name ?? "unknown", box: new OBB().fromBox3(node.geometry.boundingBox!).applyMatrix4(node.matrixWorld) });
    });
    return result;
  });
  const overlaps = boxes[0].flatMap((a) => boxes[1].filter((b) => a.box.intersectsOBB(b.box)).map((b) => [a.name, b.name]));
  const result = { date: new Date().toISOString(), modelRevision: calibration.modelRevision, cubeCenter: v(CENTER), cubeSize: 0.09, coordinateFrame: "front +Z, up +Y", hands: records, handHandOBBOverlaps: overlaps, limitations: ["Static cube clearance and inter-hand OBB checks only; arm-body checks remain separate.", "Support contacts are geometric, not force-closure or friction proof.", "The ready index contacts the U layer; it must lift during the opposite hand's turn. Middle-finger clearance during a rotating U layer still requires trajectory validation."] };
  console.log(JSON.stringify(result, null, 2));
  writeFileSync("evidence/finger-base-grip.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--thumb-search")) {
  const outputs = sides.map((side) => {
    const sign = side === "right" ? 1 : -1;
    setWrist(side, new Vector3(sign * 0.09, CENTER.y + 0.025, 0.14), humanBasis(side));
    const candidates: any[] = [];
    for (const x of [0.026, 0.032, 0.038, 0.042]) for (const y of [-0.015, -0.008, 0, 0.002]) {
      const target = new Vector3(sign * x, CENTER.y + y, 0.0452);
      let best: any;
      for (const a of [0.6, 1, 1.5]) for (const b of [-0.1, 0.6]) for (const c of [0.3, 1.2]) {
        setAngles(side, 1, [a, b, c, 0.5]);
        const fitted = ik(side, 1, target, 80, padOffset, new Vector3(0, 0, 1));
        const penetration = fingerPenetration(side, 1);
        const score = fitted.errorMM ** 2 + penetration.depthMM ** 2 * 4;
        if (!best || score < best.score) best = { target: v(target), ...fitted, penetration, score };
      }
      candidates.push(best);
    }
    candidates.sort((a, b) => a.score - b.score);
    return { side, position: [sign * 0.09, CENTER.y + 0.025, 0.14], quaternion: humanBasis(side).toArray(), candidates };
  });
  const result = { date: new Date().toISOString(), hands: outputs };
  console.log(JSON.stringify(outputs.map((o) => ({ side: o.side, best: o.candidates.slice(0, 4) })), null, 2));
  if (process.argv.includes("--save")) writeFileSync("evidence/finger-thumb-search.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--thumb-sweep-search")) {
  const records = sides.map((side) => {
    const sign = side === "right" ? 1 : -1;
    setWrist(side, new Vector3(sign * 0.08, 0.375, 0.13), humanBasis(side));
    const candidates: any[] = [];
    for (const x of [0.026, 0.032, 0.038, 0.042]) for (const y of [0.310, 0.318, 0.326, 0.334, 0.342]) {
      const target = new Vector3(sign * x, y, 0.0452);
      let best: any;
      for (const a of [1, 1.5]) for (const b of [-0.12, 0.2, 0.7]) for (const c of [0.2, 1.2]) for (const d of [0.2, 1.3]) {
        setAngles(side, 1, [a, b, c, d]);
        const fitted = ik(side, 1, target, 80, padOffset, new Vector3(0, 0, 1));
        const penetration = fingerUSweepPenetration(side, 1);
        const score = fitted.errorMM ** 2 + penetration.depthMM ** 2 * 10;
        if (!best || score < best.score) best = { target: v(target), ...fitted, penetration, score };
      }
      candidates.push(best);
    }
    candidates.sort((a, b) => a.score - b.score);
    return { side, position: [sign * 0.08, 0.375, 0.13], quaternion: humanBasis(side).toArray(), candidates };
  });
  const result = { date: new Date().toISOString(), scope: "Static thumb against full U-layer swept disk plus stationary lower two layers; actual finger mesh vertices. Contact search uses STL surface extrema, final output still requires closest-triangle contact validation.", hands: records };
  console.log(JSON.stringify(records.map((r) => ({ side: r.side, best: r.candidates.slice(0, 4) })), null, 2));
  if (process.argv.includes("--save")) writeFileSync("evidence/finger-thumb-sweep-search.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--multi")) {
  const numberArg = (flag: string, fallback: number) => process.argv.includes(flag) ? Number(process.argv[process.argv.indexOf(flag) + 1]) : fallback;
  const finger = numberArg("--finger", 2);
  const side: Side = process.argv.includes("--left") ? "left" : "right";
  const sign = side === "right" ? 1 : -1;
  const position = new Vector3(sign * numberArg("--x", 0.09), CENTER.y + numberArg("--y", 0), numberArg("--z", 0.14));
  const quaternion = humanBasis(side);
  setWrist(side, position, quaternion);
  const back = process.argv.includes("--back-contact");
  const top = process.argv.includes("--top-contact");
  const initialPoint = top ? new Vector3(sign * numberArg("--contact-x", 0.032), CENTER.y + 0.0452, numberArg("--contact-z", -0.020)) : back ? new Vector3(sign * 0.030, CENTER.y + numberArg("--height", 0.030), -0.0452) : new Vector3(sign * 0.0452, CENTER.y + numberArg("--height", 0.030), -0.030);
  const initialNormal = top ? new Vector3(0, 1, 0) : back ? new Vector3(0, 0, -1) : new Vector3(sign, 0, 0);
  const divisions = Math.max(2, numberArg("--samples", 65) - 1);
  seed(side, finger);
  let previous = jointValues(side, finger);
  const samples: any[] = [];
  for (let i = 0; i <= divisions; i++) {
    const angle = -sign * Math.PI / 2 * i / divisions;
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
    const target = initialPoint.clone().sub(CENTER).applyQuaternion(rotation).add(CENTER);
    const normal = initialNormal.clone().applyQuaternion(rotation);
    const seeds = [previous, ...[0, 0.5, 1, 1.5].flatMap((a) => [-0.4, 0.3, 1].flatMap((c) => [-0.3, 0.5, 1.3].map((d) => [a, sign * (finger === 2 ? 0.02 : 0.25), c, d])))];
    let best: any;
    for (const start of seeds) {
      setAngles(side, finger, start);
      const fitted = ik(side, finger, target, 70, padOffset, normal);
      const penetration = fingerPenetration(side, finger, angle);
      const change = fitted.angles.reduce((sum, a, j) => sum + (a - previous[j]) ** 2, 0);
      const score = fitted.errorMM ** 2 + penetration.depthMM ** 2 * 4 + change * 0.015;
      if (!best || score < best.score) best = { i, angle, target: v(target), normal: v(normal), ...fitted, penetration, score, change };
      if (fitted.errorMM < 0.01 && penetration.depthMM <= 0.1 && change < 0.1) break;
    }
    previous = best.angles;
    samples.push(best);
  }
  const firstFailure = samples.find((sample) => sample.errorMM > 0.3 || sample.penetration.depthMM > 0.3);
  const result = { date: new Date().toISOString(), side, finger, position: v(position), quaternion: quaternion.toArray(), worldPitchDegrees: wristPitch, backContact: back, maxErrorMM: Math.max(...samples.map((s) => s.errorMM)), maxDepthMM: Math.max(...samples.map((s) => s.penetration.depthMM)), firstFailure, maxJointDeltaRadians: Math.max(...samples.slice(1).flatMap((s, i) => s.angles.map((a: number, j: number) => Math.abs(a - samples[i].angles[j])))), samples };
  console.log(JSON.stringify({ ...result, samples: undefined }, null, 2));
  const suffix = `${side}-${finger}-${top ? "top" : back ? "back" : "side"}-x${Math.round(Math.abs(position.x) * 1000)}-y${Math.round((position.y - CENTER.y) * 1000)}-z${Math.round(position.z * 1000)}-h${Math.round((initialPoint.y - CENTER.y) * 1000)}${wristPitch ? `-p${wristPitch}` : ""}`;
  if (process.argv.includes("--save")) writeFileSync(`evidence/finger-multi-${suffix}.json`, JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--grasp")) {
  const backContact = process.argv.includes("--back-contact");
  const topContact = process.argv.includes("--top-contact");
  const rootY = process.argv.includes("--root-y") ? Number(process.argv[process.argv.indexOf("--root-y") + 1]) : 0;
  const rootX = process.argv.includes("--root-x") ? Number(process.argv[process.argv.indexOf("--root-x") + 1]) : 0.09;
  const rootZ = process.argv.includes("--root-z") ? Number(process.argv[process.argv.indexOf("--root-z") + 1]) : 0.14;
  const thumbY = process.argv.includes("--thumb-y") ? Number(process.argv[process.argv.indexOf("--thumb-y") + 1]) : -0.008;
  const thumbX = process.argv.includes("--thumb-x") ? Number(process.argv[process.argv.indexOf("--thumb-x") + 1]) : 0.028;
  const ringY = process.argv.includes("--ring-y") ? Number(process.argv[process.argv.indexOf("--ring-y") + 1]) : -0.014;
  const littleY = process.argv.includes("--little-y") ? Number(process.argv[process.argv.indexOf("--little-y") + 1]) : -0.034;
  const littleZ = process.argv.includes("--little-z") ? Number(process.argv[process.argv.indexOf("--little-z") + 1]) : -0.016;
  const resultHands = sides.map((side) => {
    const sign = side === "right" ? 1 : -1;
    const position = new Vector3(sign * rootX, CENTER.y + rootY, rootZ);
    const quaternion = humanBasis(side);
    setWrist(side, position, quaternion);
    const targets = [
      new Vector3(sign * thumbX, CENTER.y + thumbY, 0.0452),
      topContact ? new Vector3(sign * 0.032, CENTER.y + 0.0452, -0.020) : backContact ? new Vector3(sign * 0.030, CENTER.y + 0.030, -0.0452) : new Vector3(sign * 0.0452, CENTER.y + 0.030, -0.030),
      new Vector3(sign * 0.0452, CENTER.y + 0.008, -0.025),
      new Vector3(sign * 0.0452, CENTER.y + ringY, -0.020),
      new Vector3(sign * 0.0452, CENTER.y + littleY, littleZ),
    ];
    const normals = targets.map((_t, i) => i === 0 ? new Vector3(0, 0, 1) : i === 1 && topContact ? new Vector3(0, 1, 0) : i === 1 && backContact ? new Vector3(0, 0, -1) : new Vector3(sign, 0, 0));
    const fingers = targets.map((target, i) => { seed(side, i + 1); return { finger: i + 1, target: v(target), normal: v(normals[i]), ...ik(side, i + 1, target, 100, padOffset, normals[i]) }; });
    const staticPenetration = hands[side].penetration();
    const fingerStaticPenetration = fingers.map((_f, i) => fingerPenetration(side, i + 1));
    const supportSweep = fingers.filter((f) => [1, 4, 5].includes(f.finger)).map((f) => ({ finger: f.finger, contactDistanceMM: closestPadSurface(side, f.finger, new Vector3(...f.target)).distanceMM, ...fingerUSweepPenetration(side, f.finger) }));
    const baseAngles = fingers.map((finger) => finger.angles);
    const paths = (process.argv.includes("--static-only") ? [] : [2, 3]).map((finger) => {
      baseAngles.forEach((angles, i) => setAngles(side, i + 1, angles));
      const initialPoint = backContact ? new Vector3(sign * (finger === 2 ? 0.030 : 0.026), CENTER.y + 0.030, -0.0452) : new Vector3(sign * 0.0452, CENTER.y + 0.030, finger === 2 ? -0.030 : -0.026);
      const initialNormal = backContact ? new Vector3(0, 0, -1) : new Vector3(sign, 0, 0);
      const samples = Array.from({ length: 65 }, (_, i) => {
        const angle = -sign * Math.PI / 2 * i / 64;
        const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
        const target = initialPoint.clone().sub(CENTER).applyQuaternion(rotation).add(CENTER);
        const normal = initialNormal.clone().applyQuaternion(rotation);
        const fitted = ik(side, finger, target, 90, padOffset, normal);
        return { i, angle, target: v(target), normal: v(normal), ...fitted, penetration: fingerPenetration(side, finger, angle) };
      });
      return { finger, maxErrorMM: Math.max(...samples.map((s) => s.errorMM)), maxDepthMM: Math.max(...samples.map((s) => s.penetration.depthMM)), samples };
    });
    return { side, position: v(position), quaternion: quaternion.toArray(), fingers, staticPenetration, fingerStaticPenetration, supportSweep, paths };
  });
  const result = { date: new Date().toISOString(), scope: "Pad support points use actual STL extrema, averaged over a 0.15 mm surface band. Not all IK solutions are collision-free; inspect residual and depth per frame.", hands: resultHands };
  console.log(JSON.stringify(resultHands.map((h) => ({ side: h.side, staticPenetration: h.staticPenetration, supportSweep: h.supportSweep, fingers: h.fingers.map((f) => ({ finger: f.finger, errorMM: f.errorMM, angles: f.angles })), paths: h.paths.map((p) => ({ finger: p.finger, maxErrorMM: p.maxErrorMM, maxDepthMM: p.maxDepthMM })) })), null, 2));
  if (process.argv.includes("--save")) writeFileSync(topContact ? `evidence/finger-top-base-x${Math.round(rootX * 1000)}-y${Math.round(rootY * 1000)}-z${Math.round(rootZ * 1000)}${wristPitch ? `-p${wristPitch}` : ""}.json` : backContact ? "evidence/finger-back-contact-trials.json" : "evidence/finger-contact-trials.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

if (process.argv.includes("--solve")) {
  const side: Side = "right";
  const targets = [
    new Vector3(0.026, CENTER.y - 0.008, 0.0452),
    new Vector3(0.027, CENTER.y + 0.0452, -0.028),
    new Vector3(0.010, CENTER.y + 0.0452, -0.027),
    new Vector3(0.028, CENTER.y - 0.0452, -0.010),
    new Vector3(0.032, CENTER.y - 0.015, -0.0452),
  ];
  const candidates: any[] = [];
  for (const pitch of [0, 15, 30, 45]) for (const yaw of [-10, 0, 10, 20])
    for (const x of [0.08, 0.10, 0.12]) for (const y of [-0.06, -0.03, 0]) for (const z of [0.12, 0.14, 0.16]) {
      const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw * Math.PI / 180)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch * Math.PI / 180)).multiply(humanBasis(side));
      const position = new Vector3(x, CENTER.y + y, z);
      setWrist(side, position, quaternion);
      const fingers = targets.map((target, index) => { seed(side, index + 1); return ik(side, index + 1, target, 55); });
      const score = fingers.reduce((sum, finger) => sum + finger.errorMM ** 2, 0);
      candidates.push({ pitch, yaw, position: v(position), quaternion: quaternion.toArray(), score, fingers });
    }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates.slice(0, 12).map((candidate) => {
    setWrist(side, new Vector3(...candidate.position), new Quaternion(...candidate.quaternion));
    candidate.fingers.forEach((f: any, i: number) => setAngles(side, i + 1, f.angles));
    return { ...candidate, penetration: hands[side].penetration(), perFinger: candidate.fingers.map((_f: any, i: number) => fingerPenetration(side, i + 1)) };
  });
  const result = { date: new Date().toISOString(), padOffset: v(padOffset), targets: targets.map(v), candidates: candidates.length, best, limitation: "Initial reach-only search; fingertip offsets require surface validation and collision repair. No feasible grasp is claimed by a small IK residual alone." };
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--save")) writeFileSync("evidence/finger-reach-search.json", JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

const inspect = sides.map((side) => {
  const hand = hands[side];
  const baseline = hand.getGripMetrics();
  const candidatePosition = new Vector3(side === "right" ? 0.09 : -0.09, CENTER.y - 0.015, 0.14);
  const candidateQuaternion = humanBasis(side);
  setWrist(side, candidatePosition, candidateQuaternion);
  const candidateTips = hand.getGripMetrics();
  const fingers = Array.from({ length: 5 }, (_, index) => {
    const finger = index + 1;
    const pad = hand.robot.links[`${side}_finger${finger}_tip_link`];
    const meshes: unknown[] = [];
    pad.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.computeBoundingBox();
      meshes.push({
        vertices: node.geometry.getAttribute("position").count,
        min: v(node.geometry.boundingBox!.min),
        max: v(node.geometry.boundingBox!.max),
      });
    });
    return {
      finger,
      joints: names(side, finger).map((name) => {
        const j = hand.robot.joints[name];
        return { name, lower: j.limit.lower, upper: j.limit.upper, angle: j.angle, axis: v(j.axis), origin: v(j.position) };
      }),
      padMeshes: meshes,
    };
  });
  return { side, canonical: { position: v(canonical(side).position), quaternion: canonical(side).quaternion.toArray(), tips: baseline }, humanCandidate: { position: v(candidatePosition), quaternion: candidateQuaternion.toArray(), tips: candidateTips, penetration: hand.penetration() }, fingers };
});

const result = { date: new Date().toISOString(), scope: "URDF/STL kinematic exploration; fixed cube front +Z, up +Y. Tip origins are not rubber surface contacts.", inspect };
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--save")) writeFileSync("evidence/finger-model-inspect.json", JSON.stringify(result, null, 2) + "\n");
