/** Read-only application probe: real Wuji STL / URDF, small wrist-assisted U. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import {
  Box3,
  Euler,
  Matrix4,
  Mesh,
  Quaternion,
  Ray,
  Triangle,
  Vector3,
} from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DexterousHand } from "../src/scene/hand";
import { CENTER, type Side } from "../src/scene/motion";
import {
  fingerJoints,
  fitFinger,
  forwardFinger,
  type FingerIndex,
  type WristTransform,
} from "../src/scene/finger-rig";

Object.assign(globalThis, { DOMParser, Document, Element });
type Calibration = {
  finger: FingerIndex;
  target: number[];
  normal: number[];
  angles: number[];
  padOffset: number[];
};
const source = JSON.parse(
  readFileSync("evidence/finger-contact-trials.json", "utf8"),
);
const base = Object.fromEntries(
  source.hands.map((h: any) => [h.side, h]),
) as Record<
  Side,
  { position: number[]; quaternion: number[]; fingers: Calibration[] }
>;
const hands = {} as Record<Side, DexterousHand>;
const meshes = {} as Record<Side, Mesh[][]>;
const allMeshes = {} as Record<Side, Mesh[]>;
const numberArg = (flag: string, fallback: number) =>
  process.argv.includes(flag)
    ? Number(process.argv[process.argv.indexOf(flag) + 1])
    : fallback;
const supportArg = process.argv.indexOf("--right-support");
const supportFingers = (
  supportArg >= 0
    ? process.argv[supportArg + 1].split(",").map(Number)
    : process.argv.includes("--keep-right-support")
      ? [1, 3, 4, 5]
      : []
) as FingerIndex[];
const mode =
  supportFingers.length === 4
    ? "both"
    : supportFingers.length
      ? `right-${supportFingers.join("-")}`
      : "left";
const MAX_MM = numberArg("--max-mm", 30),
  MAX_DEG = numberArg("--max-deg", 30);
const STEPS = numberArg("--steps", 12);
const DEG = Math.PI / 180;
const serialize = (v: Vector3) => v.toArray().map((n) => +n.toFixed(8));

for (const side of ["left", "right"] as const) {
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
  hands[side] = new DexterousHand(
    loader.parse(
      readFileSync(`${directory}/${side}.urdf`, "utf8"),
      directory + "/",
    ),
    side,
  );
  hands[side].root.position.fromArray(base[side].position);
  hands[side].root.quaternion.fromArray(base[side].quaternion);
  base[side].fingers.forEach((f) => setAngles(side, f.finger, f.angles));
  meshes[side] = Array.from({ length: 5 }, (_, i) => {
    const result: Mesh[] = [];
    hands[side].robot.links[`${side}_finger${i + 1}_link1`].traverse((node) => {
      if (node instanceof Mesh) result.push(node);
    });
    return result;
  });
  allMeshes[side] = [];
  hands[side].robot.traverse((node) => {
    if (node instanceof Mesh) allMeshes[side].push(node);
  });
}
function setAngles(side: Side, finger: number, angles: number[]) {
  angles.forEach((a, i) =>
    hands[side].robot.joints[
      `${side}_finger${finger}_joint${i + 1}`
    ].setJointValue(a),
  );
}
function clearFinger(side: Side, finger: number) {
  setAngles(
    side,
    finger,
    finger === 1
      ? [0.35, 0, 0.15, 0.15]
      : [0.06, side === "left" && finger === 2 ? -0.3 : 0, 0.12, 0.15],
  );
}
function wristOf(side: Side): WristTransform {
  return {
    position: hands[side].root.position.clone(),
    quaternion: hands[side].root.quaternion.clone(),
  };
}
function applyWrist(params: number[]) {
  const h = hands.right;
  h.root.position
    .fromArray(base.right.position)
    .add(new Vector3(...params.slice(0, 3).map((x) => x / 1000)));
  h.root.quaternion
    .setFromEuler(
      new Euler(
        ...(params.slice(3).map((x) => x * DEG) as [number, number, number]),
        "XYZ",
      ),
    )
    .multiply(new Quaternion().fromArray(base.right.quaternion));
}
const point = new Vector3();
function penetration(nodes: Mesh[], angle: number, stride = 1) {
  const c = Math.cos(-angle),
    s = Math.sin(-angle);
  let depth = 0,
    count = 0,
    link = "",
    examined = 0;
  for (const mesh of nodes) {
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i += stride) {
      point
        .fromBufferAttribute(positions, i)
        .applyMatrix4(mesh.matrixWorld)
        .sub(CENTER);
      const fixed = Math.min(
        0.045 - Math.abs(point.x),
        0.045 - Math.abs(point.z),
        point.y + 0.045,
        0.015 - point.y,
      );
      const x = c * point.x + s * point.z,
        z = -s * point.x + c * point.z;
      const upper = Math.min(
        0.045 - Math.abs(x),
        0.045 - Math.abs(z),
        point.y - 0.015,
        0.045 - point.y,
      );
      const d = Math.max(fixed, upper);
      if (d > 0.0003) count++;
      if (d > depth) {
        depth = d;
        link = mesh.parent?.parent?.name ?? mesh.name;
      }
      examined++;
    }
  }
  return { depthMM: depth * 1000, penetratingVertices: count, link, examined };
}
/** Exact maximum of the cube box-depth metric over a continuous 90-degree U.
 * For any radius r, the best square orientation has |x|=|z|=r/sqrt(2).
 * This is useful for the stationary supporting hand: no angular samples miss
 * the narrow moment when a moving U corner passes a static thumb link. */
function sweptPenetration(nodes: Mesh[]) {
  let depthMM = 0;
  for (const mesh of nodes) {
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      point
        .fromBufferAttribute(positions, i)
        .applyMatrix4(mesh.matrixWorld)
        .sub(CENTER);
      const lower = Math.min(
        0.045 - Math.abs(point.x),
        0.045 - Math.abs(point.z),
        point.y + 0.045,
        0.015 - point.y,
      );
      const upper = Math.min(
        0.045 - Math.hypot(point.x, point.z) / Math.sqrt(2),
        point.y - 0.015,
        0.045 - point.y,
      );
      depthMM = Math.max(depthMM, Math.max(lower, upper) * 1000);
    }
  }
  return depthMM;
}
function fitContact(
  side: Side,
  finger: FingerIndex,
  target: Vector3,
  initial: number[],
  normal: Vector3,
  dynamicPad = false,
) {
  const calibration = base[side].fingers[finger - 1];
  let offset = new Vector3().fromArray(calibration.padOffset),
    result;
  const wrist = wristOf(side);
  for (let iteration = 0; iteration < (dynamicPad ? 3 : 1); iteration++) {
    result = fitFinger({
      side,
      finger,
      position: target,
      initial: result?.angles ?? initial,
      wrist,
      padOffset: offset,
      tolerance: 0.00002,
      iterations: 70,
    });
    if (!dynamicPad || iteration === 2) break;
    const frame = forwardFinger(side, finger, result.angles, wrist);
    const localNormal = normal
      .clone()
      .applyQuaternion(frame.quaternion.clone().invert());
    const tipMesh = meshes[side][finger - 1].at(-1)!;
    const positions = tipMesh.geometry.getAttribute("position");
    let minimum = Infinity;
    for (let i = 0; i < positions.count; i++)
      minimum = Math.min(
        minimum,
        point.fromBufferAttribute(positions, i).dot(localNormal),
      );
    let count = 0;
    offset = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      if (point.dot(localNormal) <= minimum + 0.00015) {
        offset.add(point);
        count++;
      }
    }
    offset.divideScalar(count);
  }
  setAngles(side, finger, result!.angles);
  return { ...result!, padOffset: serialize(offset) };
}

function padSurface(
  side: Side,
  finger: FingerIndex,
  q: Quaternion,
  normal: Vector3,
) {
  const localNormal = normal.clone().applyQuaternion(q.clone().invert());
  const positions = meshes[side][finger - 1]
    .at(-1)!
    .geometry.getAttribute("position");
  let minimum = Infinity;
  for (let i = 0; i < positions.count; i++)
    minimum = Math.min(
      minimum,
      point.fromBufferAttribute(positions, i).dot(localNormal),
    );
  let count = 0;
  const offset = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    if (point.dot(localNormal) <= minimum + 0.00015) {
      offset.add(point);
      count++;
    }
  }
  return offset.divideScalar(count);
}

// The idle index must release the moving U layer. The other four left contacts
// remain fixed in world coordinates; no cube pose change is used by this probe.
clearFinger("left", 2);
const leftBackFinger = numberArg("--left-back-finger", 0) as FingerIndex | 0;
const leftDrop = numberArg("--left-middle-drop", 0);
if (leftDrop) {
  const f = base.left.fingers[2];
  f.target[1] -= leftDrop / 1000;
  const fitted = fitContact(
    "left",
    3,
    new Vector3().fromArray(f.target),
    f.angles,
    new Vector3().fromArray(f.normal),
    true,
  );
  f.angles = fitted.angles;
  f.padOffset = fitted.padOffset;
}
if (leftBackFinger) {
  const f = base.left.fingers[leftBackFinger - 1];
  f.target = [
    numberArg("--left-back-x", -30) / 1000,
    CENTER.y + numberArg("--left-back-y", 0) / 1000,
    -0.0452,
  ];
  f.normal = [0, 0, -1];
  const fitted = fitContact(
    "left",
    leftBackFinger,
    new Vector3().fromArray(f.target),
    f.angles,
    new Vector3().fromArray(f.normal),
    true,
  );
  f.angles = fitted.angles;
  f.padOffset = fitted.padOffset;
  console.log(
    JSON.stringify({
      leftBackFinger,
      errorMM: fitted.error * 1000,
      angles: fitted.angles,
    }),
  );
}
for (const finger of [1, 3, 4, 5] as FingerIndex[])
  if (!supportFingers.includes(finger)) clearFinger("right", finger);
if (process.argv.includes("--lower-left-middle")) {
  const f = base.left.fingers[2],
    original = f.angles.slice();
  let found = false;
  for (const bend of [
    0, 0.005, 0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.12, -0.02, -0.04, -0.08,
  ]) {
    const angles = original.slice();
    angles[1] += bend;
    setAngles("left", 3, angles);
    hands.left.root.updateMatrixWorld(true);
    const frame = forwardFinger("left", 3, angles, wristOf("left"));
    const offset = padSurface(
      "left",
      3,
      frame.quaternion,
      new Vector3(-1, 0, 0),
    );
    const contact = forwardFinger(
      "left",
      3,
      angles,
      wristOf("left"),
      offset,
    ).position;
    const gapMM = (-contact.x - 0.045) * 1000;
    const maxDepthMM = sweptPenetration(meshes.left[2]);
    console.log(
      JSON.stringify({
        leftMiddleBend: bend,
        gapMM,
        maxDepthMM,
        contact: serialize(contact),
      }),
    );
    if (Math.abs(gapMM) < 0.3 && maxDepthMM < 0.12) {
      f.angles = angles;
      f.padOffset = serialize(offset);
      f.target = serialize(contact);
      found = true;
      break;
    }
  }
  if (!found) setAngles("left", 3, original);
}
if (process.argv.includes("--lower-left-thumb")) {
  const f = base.left.fingers[0],
    original = f.angles.slice(),
    originalTarget = f.target.slice();
  let found = false;
  searchThumb: for (const drop of [0, 2, 4, 5, 6, 8, 10, 15])
    for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
      const target = new Vector3().fromArray(originalTarget);
      target.y -= drop / 1000;
      target.x += shift / 1000;
      const fitted = fitContact(
        "left",
        1,
        target,
        original,
        new Vector3(0, 0, 1),
        true,
      );
      hands.left.root.updateMatrixWorld(true);
      const maxDepthMM = sweptPenetration(meshes.left[0]);
      console.log(
        JSON.stringify({
          leftThumbDropMM: drop,
          shiftMM: shift,
          errorMM: fitted.error * 1000,
          maxDepthMM,
        }),
      );
      if (fitted.error < 0.00015 && maxDepthMM < 0.12) {
        f.target = serialize(target);
        f.angles = fitted.angles;
        f.padOffset = fitted.padOffset;
        found = true;
        break searchThumb;
      }
    }
  if (!found) setAngles("left", 1, original);
}
if (process.argv.includes("--reground-left")) {
  const input = process.argv[process.argv.indexOf("--reground-left") + 1];
  const result = JSON.parse(readFileSync(input, "utf8"));
  hands.left.root.updateMatrixWorld(true);
  result.leftContacts = base.left.fingers
    .filter((f) => f.finger !== 2)
    .map((f) => {
      const actual = forwardFinger(
        "left",
        f.finger,
        f.angles,
        wristOf("left"),
        new Vector3().fromArray(f.padOffset),
      ).position;
      return {
        finger: f.finger,
        target: f.target,
        normal: f.normal,
        angles: f.angles,
        padOffset: f.padOffset,
        errorMM: actual.distanceTo(new Vector3().fromArray(f.target)) * 1000,
        point: serialize(actual),
      };
    });
  result.leftContinuousSweepDepthMM = sweptPenetration(allMeshes.left);
  for (const sample of result.samples)
    sample.leftDepth = penetration(allMeshes.left, sample.angle);
  result.summary.maxDepthMM = Math.max(
    ...result.samples.map((s: any) =>
      Math.max(s.depth.depthMM, s.leftDepth.depthMM),
    ),
  );
  result.summary.allSamplesPass = result.summary.maxDepthMM < 0.3;
  const output = input.replace(/\.json$/, "-stable.json");
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify({
      leftContinuousSweepDepthMM: result.leftContinuousSweepDepthMM,
      leftContacts: result.leftContacts,
    }),
  );
  console.log(output);
  process.exit(0);
}
let seed = 0xf19e20;
const random = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

if (process.argv.includes("--validate")) {
  const input = process.argv[process.argv.indexOf("--validate") + 1];
  const source = JSON.parse(readFileSync(input, "utf8"));
  for (const f of source.leftContacts as Calibration[]) {
    base.left.fingers[f.finger - 1] = f;
    setAngles("left", f.finger, f.angles);
  }
  const previous = new Map<Mesh, { inverse: Matrix4; box: Box3 }>();
  function updateBounds() {
    for (const side of ["left", "right"] as const)
      for (const mesh of allMeshes[side]) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        previous.set(mesh, {
          inverse: mesh.matrixWorld.clone().invert(),
          box: mesh.geometry
            .boundingBox!.clone()
            .applyMatrix4(mesh.matrixWorld),
        });
      }
  }
  const ray = new Ray(),
    triangle = new Triangle(),
    hit = new Vector3(),
    closest = new Vector3();
  const rayDirection = new Vector3(1, 0.371, 0.219).normalize();
  function insideDepth(sourceMesh: Mesh, targetMesh: Mesh) {
    if (
      !previous
        .get(sourceMesh)!
        .box.intersectsBox(previous.get(targetMesh)!.box)
    )
      return 0;
    const matrix = previous
      .get(targetMesh)!
      .inverse.clone()
      .multiply(sourceMesh.matrixWorld);
    const src = sourceMesh.geometry.getAttribute("position"),
      positions = targetMesh.geometry.getAttribute("position"),
      indices = targetMesh.geometry.index;
    const count = indices?.count ?? positions.count;
    let max = 0;
    for (let i = 0; i < src.count; i++) {
      const local = new Vector3()
        .fromBufferAttribute(src, i)
        .applyMatrix4(matrix);
      if (!targetMesh.geometry.boundingBox!.containsPoint(local)) continue;
      ray.set(local, rayDirection);
      const distances: number[] = [];
      for (let t = 0; t < count; t += 3) {
        triangle.a.fromBufferAttribute(
          positions,
          indices ? indices.getX(t) : t,
        );
        triangle.b.fromBufferAttribute(
          positions,
          indices ? indices.getX(t + 1) : t + 1,
        );
        triangle.c.fromBufferAttribute(
          positions,
          indices ? indices.getX(t + 2) : t + 2,
        );
        if (
          ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)
        )
          distances.push(local.distanceToSquared(hit));
      }
      distances.sort((a, b) => a - b);
      const crossings = distances.filter(
        (d, i) => i === 0 || Math.abs(d - distances[i - 1]) > 1e-11,
      );
      if (crossings.length % 2 !== 1) continue;
      let distance = Infinity;
      for (let t = 0; t < count; t += 3) {
        triangle.a.fromBufferAttribute(
          positions,
          indices ? indices.getX(t) : t,
        );
        triangle.b.fromBufferAttribute(
          positions,
          indices ? indices.getX(t + 1) : t + 1,
        );
        triangle.c.fromBufferAttribute(
          positions,
          indices ? indices.getX(t + 2) : t + 2,
        );
        triangle.closestPointToPoint(local, closest);
        distance = Math.min(distance, closest.distanceToSquared(local));
      }
      max = Math.max(max, Math.sqrt(distance) * 1000);
    }
    return max;
  }
  function pairDepth(left: Mesh[], right: Mesh[]) {
    let depthMM = 0,
      pair: string[] = [],
      boundingBoxOverlaps = 0;
    for (const a of left)
      for (const b of right) {
        if (previous.get(a)!.box.intersectsBox(previous.get(b)!.box))
          boundingBoxOverlaps++;
        const depth = Math.max(insideDepth(a, b), insideDepth(b, a));
        if (depth > depthMM) {
          depthMM = depth;
          pair = [a.parent?.parent?.name ?? "", b.parent?.parent?.name ?? ""];
        }
      }
    return { depthMM, pair, boundingBoxOverlaps };
  }
  function surfaceDistance(mesh: Mesh, worldTarget: Vector3) {
    const local = worldTarget
      .clone()
      .applyMatrix4(mesh.matrixWorld.clone().invert());
    const positions = mesh.geometry.getAttribute("position"),
      indices = mesh.geometry.index;
    const count = indices?.count ?? positions.count;
    let distance = Infinity;
    const bestLocal = new Vector3();
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(positions, indices ? indices.getX(t) : t);
      triangle.b.fromBufferAttribute(
        positions,
        indices ? indices.getX(t + 1) : t + 1,
      );
      triangle.c.fromBufferAttribute(
        positions,
        indices ? indices.getX(t + 2) : t + 2,
      );
      triangle.closestPointToPoint(local, closest);
      const squared = closest.distanceToSquared(local);
      if (squared < distance) {
        distance = squared;
        bestLocal.copy(closest);
      }
    }
    return {
      distanceMM: Math.sqrt(distance) * 1000,
      point: bestLocal.applyMatrix4(mesh.matrixWorld),
    };
  }
  const records: any[] = [],
    trajectoryFrames: any[] = [],
    intervals = numberArg("--samples", 128);
  let maxJointStep = 0,
    positionArcMM = 0,
    rotationArcDeg = 0,
    prevAngles: number[] | undefined,
    prevPosition: Vector3 | undefined,
    prevQuaternion: Quaternion | undefined;
  for (let i = 0; i <= intervals; i++) {
    const at = (i / intervals) * (source.samples.length - 1),
      low = Math.min(source.samples.length - 2, Math.floor(at)),
      t = at - low;
    const a = source.samples[low],
      b = source.samples[low + 1];
    const angle = a.angle + (b.angle - a.angle) * t;
    const angles = a.angles.map(
      (v: number, j: number) => v + (b.angles[j] - v) * t,
    );
    const position = new Vector3()
      .fromArray(a.position)
      .lerp(new Vector3().fromArray(b.position), t);
    const quaternion = new Quaternion()
      .fromArray(a.quaternion)
      .slerp(new Quaternion().fromArray(b.quaternion), t);
    hands.right.root.position.copy(position);
    hands.right.root.quaternion.copy(quaternion);
    setAngles("right", 2, angles);
    for (const side of ["left", "right"] as const)
      hands[side].root.updateMatrixWorld(true);
    const frame = forwardFinger("right", 2, angles, { position, quaternion });
    const normal = new Vector3(1, 0, 0).applyAxisAngle(
      new Vector3(0, 1, 0),
      angle,
    );
    const offset = padSurface("right", 2, frame.quaternion, normal);
    const contact = forwardFinger(
      "right",
      2,
      angles,
      { position, quaternion },
      offset,
    ).position;
    const target = new Vector3()
      .fromArray(base.right.fingers[1].target)
      .sub(CENTER)
      .applyAxisAngle(new Vector3(0, 1, 0), angle)
      .add(CENTER);
    updateBounds();
    const leftCube = penetration(allMeshes.left, angle),
      rightCube = penetration(allMeshes.right, angle);
    const mutual = pairDepth(allMeshes.left, allMeshes.right);
    const finger = pairDepth(
      meshes.right[1],
      meshes.right.filter((_, j) => j !== 1).flat(),
    );
    const nearest = surfaceDistance(meshes.right[1].at(-1)!, target);
    const handData = (side: Side) => ({
      position: serialize(hands[side].root.position),
      quaternion: hands[side].root.quaternion.toArray(),
      joints: Object.fromEntries(
        Object.entries(hands[side].robot.joints)
          .filter(([, joint]) => joint.jointType !== "fixed")
          .map(([name, joint]) => [name, joint.angle]),
      ),
    });
    const actualPadOffset = nearest.point
      .clone()
      .sub(frame.position)
      .applyQuaternion(frame.quaternion.clone().invert());
    const serializedOffset = serialize(actualPadOffset);
    const activePadFKErrorMM =
      forwardFinger(
        "right",
        2,
        angles,
        { position: new Vector3().fromArray(serialize(position)), quaternion },
        new Vector3().fromArray(serializedOffset),
      ).position.distanceTo(target) * 1000;
    records.push({
      i,
      angle,
      contactErrorMM: activePadFKErrorMM,
      meanSupportCentroidErrorMM: contact.distanceTo(target) * 1000,
      targetSurfaceDistanceMM: nearest.distanceMM,
      leftCube,
      rightCube,
      mutual,
      finger,
    });
    trajectoryFrames.push({
      progress: i / intervals,
      angle,
      left: handData("left"),
      right: handData("right"),
      active: {
        side: "right",
        finger: 2,
        padOffset: serializedOffset,
        meanOffset: serialize(offset),
        cubeLocalPoint: serialize(
          new Vector3().fromArray(base.right.fingers[1].target).sub(CENTER),
        ),
        normal: [1, 0, 0],
        targetSurfaceDistanceMM: nearest.distanceMM,
      },
    });
    if (prevAngles)
      maxJointStep = Math.max(
        maxJointStep,
        ...angles.map((v: number, j: number) => Math.abs(v - prevAngles![j])),
      );
    if (prevPosition) positionArcMM += position.distanceTo(prevPosition) * 1000;
    if (prevQuaternion)
      rotationArcDeg += quaternion.angleTo(prevQuaternion) / DEG;
    prevAngles = angles;
    prevPosition = position;
    prevQuaternion = quaternion;
  }
  const support = source.leftContacts.map((f: Calibration) => ({
    finger: f.finger,
    residualMM:
      forwardFinger(
        "left",
        f.finger,
        f.angles,
        wristOf("left"),
        new Vector3().fromArray(f.padOffset),
      ).position.distanceTo(new Vector3().fromArray(f.target)) * 1000,
  }));
  const summary = {
    samples: intervals + 1,
    maxContactErrorMM: Math.max(...records.map((s) => s.contactErrorMM)),
    maxMeanSupportCentroidErrorMM: Math.max(
      ...records.map((s) => s.meanSupportCentroidErrorMM),
    ),
    maxTargetSurfaceDistanceMM: Math.max(
      ...records.map((s) => s.targetSurfaceDistanceMM),
    ),
    maxCubeDepthMM: Math.max(
      ...records.flatMap((s) => [s.leftCube.depthMM, s.rightCube.depthMM]),
    ),
    maxLeftContinuousSweepDepthMM: sweptPenetration(allMeshes.left),
    maxMutualDepthMM: Math.max(...records.map((s) => s.mutual.depthMM)),
    maxFingerDepthMM: Math.max(...records.map((s) => s.finger.depthMM)),
    maxInterhandBoundingBoxOverlaps: Math.max(
      ...records.map((s) => s.mutual.boundingBoxOverlaps),
    ),
    maxInterfingerBoundingBoxOverlaps: Math.max(
      ...records.map((s) => s.finger.boundingBoxOverlaps),
    ),
    maxJointStepRadians: maxJointStep,
    wristPathLengthMM: positionArcMM,
    wristAngularPathDeg: rotationArcDeg,
    support,
  };
  const output = input.replace(/\.json$/, "-validation.json");
  writeFileSync(
    output,
    JSON.stringify(
      {
        source: input,
        method:
          "Piecewise wrist-position / joint-angle interpolation and quaternion slerp; full STL vertices against cube; interhand and active-to-other-finger mesh vertex containment with closest triangle depth",
        summary,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(output);
  if (process.argv.includes("--export")) {
    if (
      Math.max(
        summary.maxContactErrorMM,
        summary.maxTargetSurfaceDistanceMM,
        summary.maxCubeDepthMM,
        summary.maxLeftContinuousSweepDepthMM,
        summary.maxMutualDepthMM,
        summary.maxFingerDepthMM,
        ...support.map((s: any) => s.residualMM),
      ) > 0.3
    )
      throw new Error("Refusing to export: dense validation exceeds 0.3 mm.");
    const exported = {
      version: 1,
      source: input,
      scope:
        "Only U 0-to-90 turn segment. Entry, preparation, release, return-to-grip, arm bodies and force closure are NOT validated by this file.",
      cubeCenter: serialize(CENTER),
      cubeOrientation: [0, 0, 0, 1],
      turn: "U",
      limits: { penetrationMM: 0.3, targetSurfaceDistanceMM: 0.3 },
      summary,
      supports: source.leftContacts.map((f: Calibration) => ({
        side: "left",
        finger: f.finger,
        padOffset: f.padOffset,
        cubeLocalPoint: serialize(
          new Vector3().fromArray(f.target).sub(CENTER),
        ),
        normal: f.normal,
      })),
      frames: trajectoryFrames,
    };
    const exportPath = "evidence/finger-u-assisted-u90-trajectory.json";
    writeFileSync(exportPath, JSON.stringify(exported, null, 2) + "\n");
    console.log(exportPath);
  }
  process.exit(0);
}

if (process.argv.includes("--direct")) {
  const limits = fingerJoints("right", 2);
  let previous = [...base.right.fingers[1].angles, 0, 0, 0];
  let previousPosition = new Vector3().fromArray(base.right.position);
  const samples: any[] = [];
  function measure(variables: number[], angle: number, dense = false) {
    const angles = variables.slice(0, 4);
    const q = new Quaternion()
      .setFromEuler(
        new Euler(
          variables[4] * DEG,
          variables[5] * DEG,
          variables[6] * DEG,
          "XYZ",
        ),
      )
      .multiply(new Quaternion().fromArray(base.right.quaternion));
    const normal = new Vector3(1, 0, 0).applyAxisAngle(
      new Vector3(0, 1, 0),
      angle,
    );
    const target = new Vector3()
      .fromArray(base.right.fingers[1].target)
      .sub(CENTER)
      .applyAxisAngle(new Vector3(0, 1, 0), angle)
      .add(CENTER);
    const frame = forwardFinger("right", 2, angles, {
      position: new Vector3(),
      quaternion: q,
    });
    const offset = padSurface("right", 2, frame.quaternion, normal);
    const tip = forwardFinger(
      "right",
      2,
      angles,
      { position: new Vector3(), quaternion: q },
      offset,
    ).position;
    const position = target.clone().sub(tip);
    hands.right.root.position.copy(position);
    hands.right.root.quaternion.copy(q);
    setAngles("right", 2, angles);
    hands.right.root.updateMatrixWorld(true);
    const depth = penetration(allMeshes.right, angle, 1);
    const translationMM =
      position.distanceTo(new Vector3().fromArray(base.right.position)) * 1000;
    const rotationDeg =
      q.angleTo(new Quaternion().fromArray(base.right.quaternion)) / DEG;
    const change = position.distanceTo(previousPosition) * 1000;
    const jointChange = angles.reduce(
      (s, a, i) => s + (a - previous[i]) ** 2,
      0,
    );
    const score =
      200 *
        Math.max(0, depth.depthMM - numberArg("--clearance-mm", 0.18)) ** 2 +
      20 * Math.max(0, translationMM - MAX_MM) ** 2 +
      20 * Math.max(0, rotationDeg - MAX_DEG) ** 2 +
      (translationMM / MAX_MM) ** 2 +
      (rotationDeg / MAX_DEG) ** 2 +
      0.05 * (change / 5) ** 2 +
      0.1 * jointChange;
    return {
      variables,
      angle,
      position: serialize(position),
      quaternion: q.toArray(),
      angles,
      padOffset: serialize(offset),
      target: serialize(target),
      depth,
      translationMM,
      rotationDeg,
      score,
    };
  }
  function directLocal(seed: number[], angle: number) {
    let best = measure(seed, angle);
    for (const step of [8, 4, 2, 1, 0.4, 0.15])
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (let axis = 0; axis < 7; axis++)
          for (const sign of [-1, 1]) {
            const vars = best.variables.slice();
            vars[axis] += sign * step * (axis < 4 ? DEG : 1);
            vars[axis] = Math.max(
              axis < 4 ? limits[axis].lower : -MAX_DEG,
              Math.min(axis < 4 ? limits[axis].upper : MAX_DEG, vars[axis]),
            );
            const candidate = measure(vars, angle);
            if (candidate.score < best.score) {
              best = candidate;
              changed = true;
            }
          }
        if (!changed) break;
      }
    return best;
  }
  for (let i = 0; i <= STEPS; i++) {
    const angle = ((-Math.PI / 2) * i) / STEPS;
    let best = directLocal(previous, angle);
    for (let restart = 0; restart < numberArg("--starts", 1); restart++) {
      const guess = best.variables.map(
        (value, j) => value + (random() - 0.5) * (j < 4 ? 0.3 : 8),
      );
      guess.forEach(
        (value, j) =>
          (guess[j] = Math.max(
            j < 4 ? limits[j].lower : -MAX_DEG,
            Math.min(j < 4 ? limits[j].upper : MAX_DEG, value),
          )),
      );
      const candidate = directLocal(guess, angle);
      if (candidate.score < best.score) best = candidate;
    }
    best = measure(best.variables, angle, true);
    hands.left.root.updateMatrixWorld(true);
    const leftDepth = penetration(allMeshes.left, angle);
    samples.push({ ...best, leftDepth });
    previous = best.variables;
    previousPosition.fromArray(best.position);
    console.log(
      JSON.stringify({
        degrees: -angle / DEG,
        depthMM: best.depth.depthMM,
        leftDepthMM: leftDepth.depthMM,
        translationMM: best.translationMM,
        rotationDeg: best.rotationDeg,
        score: best.score,
      }),
    );
  }
  const result = {
    method:
      "Direct constrained finger-angle/wrist search; real STL support extrema, exact tip contact by wrist translation, real URDF limits, all-vertex cube checks",
    limits: {
      maxTranslationMM: MAX_MM,
      maxRotationDeg: MAX_DEG,
      maxPenetrationMM: 0.3,
    },
    leftContacts: base.left.fingers.filter((f) => f.finger !== 2),
    samples,
    summary: {
      allSamplesPass: samples.every(
        (s) =>
          s.depth.depthMM <= 0.3 &&
          s.leftDepth.depthMM <= 0.3 &&
          s.translationMM <= MAX_MM + 0.01 &&
          s.rotationDeg <= MAX_DEG + 0.01,
      ),
      maxDepthMM: Math.max(
        ...samples.map((s) => Math.max(s.depth.depthMM, s.leftDepth.depthMM)),
      ),
      maxTranslationMM: Math.max(...samples.map((s) => s.translationMM)),
      maxRotationDeg: Math.max(...samples.map((s) => s.rotationDeg)),
    },
  };
  const labelIndex = process.argv.indexOf("--label");
  const label = labelIndex >= 0 ? `-${process.argv[labelIndex + 1]}` : "";
  writeFileSync(
    `evidence/finger-u-assisted-direct${label}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result.summary));
  process.exit(0);
}
let lastAngles = base.right.fingers[1].angles;
const fixedSupportAngles = base.right.fingers.map((f) => f.angles);

function evaluate(
  params: number[],
  angle: number,
  dense = false,
  dynamicPad = false,
) {
  applyWrist(params);
  const rotation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    angle,
  );
  const target = new Vector3()
    .fromArray(base.right.fingers[1].target)
    .sub(CENTER)
    .applyQuaternion(rotation)
    .add(CENTER);
  const normal = new Vector3(1, 0, 0).applyQuaternion(rotation);
  const active = fitContact("right", 2, target, lastAngles, normal, dynamicPad);
  const support = supportFingers.map((finger) => {
    const f = base.right.fingers[finger - 1];
    return {
      finger,
      ...fitContact(
        "right",
        finger as FingerIndex,
        new Vector3().fromArray(f.target),
        fixedSupportAngles[finger - 1],
        new Vector3().fromArray(f.normal),
        dynamicPad,
      ),
    };
  });
  hands.right.root.updateMatrixWorld(true);
  const activeDepth = penetration(meshes.right[1], angle, dense ? 1 : 3);
  const allDepth = penetration(allMeshes.right, angle, dense ? 1 : 6);
  const translationMM =
    hands.right.root.position.distanceTo(
      new Vector3().fromArray(base.right.position),
    ) * 1000;
  const rotationDeg =
    hands.right.root.quaternion.angleTo(
      new Quaternion().fromArray(base.right.quaternion),
    ) / DEG;
  const errorMM = Math.max(active.error, ...support.map((s) => s.error)) * 1000;
  const depthMM = Math.max(activeDepth.depthMM, allDepth.depthMM);
  const violation =
    Math.max(0, errorMM - 0.15) ** 2 + Math.max(0, depthMM - 0.2) ** 2;
  const score =
    100 * violation +
    (translationMM / MAX_MM) ** 2 +
    (rotationDeg / MAX_DEG) ** 2;
  return {
    params: params.slice(),
    angle,
    target: serialize(target),
    normal: serialize(normal),
    score,
    errorMM,
    activeDepth,
    allDepth,
    translationMM,
    rotationDeg,
    active,
    support,
    wrist: {
      position: serialize(hands.right.root.position),
      quaternion: hands.right.root.quaternion.toArray(),
    },
  };
}

function clipped(params: number[]) {
  return params.map((v, i) =>
    Math.max(
      -(i < 3 ? MAX_MM : MAX_DEG),
      Math.min(i < 3 ? MAX_MM : MAX_DEG, v),
    ),
  );
}
function local(initial: number[], angle: number, dynamicPad = false) {
  let best = evaluate(clipped(initial), angle, false, dynamicPad);
  for (const step of [8, 4, 2, 1, 0.4]) {
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (let axis = 0; axis < 6; axis++)
        for (const sign of [-1, 1]) {
          const params = best.params.slice();
          params[axis] += sign * step;
          const candidate = evaluate(clipped(params), angle, false, dynamicPad);
          if (candidate.score < best.score) {
            best = candidate;
            improved = true;
          }
        }
      if (!improved) break;
    }
  }
  return best;
}

const endpoint = process.argv.includes("--endpoint");
const fixedIndex = process.argv.indexOf("--fixed-wrist");
const prescribed =
  fixedIndex >= 0
    ? process.argv[fixedIndex + 1].split(",").map(Number)
    : undefined;
const samples: (ReturnType<typeof evaluate> & {
  leftDepth: ReturnType<typeof penetration>;
  rightJoints: Record<string, number>;
})[] = [];
let previous = [0, 0, 0, 0, 0, 0];
for (let i = endpoint ? STEPS : 0; i <= STEPS; i++) {
  const angle = ((-Math.PI / 2) * i) / STEPS;
  const fraction = process.argv.includes("--ramp-wrist") ? i / STEPS : 1;
  let best = prescribed
    ? evaluate(
        prescribed.map((p) => p * fraction),
        angle,
        false,
        process.argv.includes("--dynamic-pad"),
      )
    : local(previous, angle, process.argv.includes("--dynamic-pad"));
  const starts = prescribed ? 0 : numberArg("--starts", endpoint ? 10 : 2);
  for (let start = 0; start < starts; start++) {
    const guess = best.params.map(
      (v, j) => v + (random() - 0.5) * (j < 3 ? 25 : 30),
    );
    const candidate = local(
      guess,
      angle,
      process.argv.includes("--dynamic-pad"),
    );
    if (candidate.score < best.score) best = candidate;
  }
  const checked = evaluate(
    best.params,
    angle,
    true,
    process.argv.includes("--dynamic-pad"),
  );
  previous = best.params;
  lastAngles = checked.active.angles;
  hands.left.root.updateMatrixWorld(true);
  const leftDepth = penetration(allMeshes.left, angle);
  const rightJoints = Object.fromEntries(
    Object.entries(hands.right.robot.joints)
      .filter(([, joint]) => joint.jointType !== "fixed")
      .map(([name, joint]) => [name, joint.angle]),
  );
  samples.push({ ...checked, leftDepth, rightJoints });
  console.log(
    JSON.stringify({
      degrees: -angle / DEG,
      mode,
      params: checked.params,
      errorMM: checked.errorMM,
      activeDepth: checked.activeDepth.depthMM,
      allDepth: checked.allDepth.depthMM,
      leftDepth: leftDepth.depthMM,
      translationMM: checked.translationMM,
      rotationDeg: checked.rotationDeg,
      score: checked.score,
    }),
  );
}
const leftSupports = base.left.fingers
  .filter((f) => f.finger !== 2 || leftBackFinger === 2)
  .map((f) => {
    const frame = forwardFinger(
      "left",
      f.finger,
      f.angles,
      wristOf("left"),
      new Vector3().fromArray(f.padOffset),
    );
    return {
      finger: f.finger,
      target: f.target,
      actual: serialize(frame.position),
      errorMM:
        frame.position.distanceTo(new Vector3().fromArray(f.target)) * 1000,
    };
  });
const result = {
  timestamp: new Date().toISOString(),
  method:
    "actual STL vertices against stationary lower two layers and independently rotated U layer; inverse kinematics uses real URDF axes/limits",
  limits: {
    coordinateTranslationMM: MAX_MM,
    eulerDegrees: MAX_DEG,
    penetrationMM: 0.3,
  },
  mode,
  endpoint,
  leftSupports,
  summary: {
    allSamplesPass: samples.every(
      (s) =>
        s.errorMM <= 0.3 &&
        s.allDepth.depthMM <= 0.3 &&
        s.leftDepth.depthMM <= 0.3,
    ),
    maxErrorMM: Math.max(...samples.map((s) => s.errorMM)),
    maxDepthMM: Math.max(
      ...samples.map((s) => Math.max(s.allDepth.depthMM, s.leftDepth.depthMM)),
    ),
    maxTranslationMM: Math.max(...samples.map((s) => s.translationMM)),
    maxRotationDeg: Math.max(...samples.map((s) => s.rotationDeg)),
  },
  samples,
};
const labelIndex = process.argv.indexOf("--label");
const label = labelIndex >= 0 ? `-${process.argv[labelIndex + 1]}` : "";
const output = `evidence/finger-u-assisted-${mode}-${endpoint ? "endpoint" : "path"}${process.argv.includes("--dynamic-pad") ? "-dynamic" : ""}${label}.json`;
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(output);
