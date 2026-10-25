/** Bounded direct-M feasibility probe. No application files or cube pose are changed. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Mesh, Quaternion, Triangle, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DexterousHand } from "../src/scene/hand";
import { CENTER, type HandPose, type Side } from "../src/scene/motion";
import { parseMove } from "../src/core/cube";
import {
  fingerJoints,
  fitFinger,
  forwardFinger,
  type FingerIndex,
} from "../src/scene/finger-rig";
import {
  hasMeasuredSupport,
  measureContact,
  type FingerContact,
} from "../src/scene/finger-contact";

Object.assign(globalThis, { DOMParser, Document, Element });
type Pose = {
  position: number[];
  quaternion: number[];
  joints: Record<string, number>;
};
type SourceHand = {
  side: Side;
  wrist: { position: number[]; quaternion: number[] };
  joints: Record<string, number>;
  contacts: {
    finger: FingerIndex;
    target: number[];
    normal: number[];
    padLocalOffset: number[];
  }[];
};
const arg = (name: string, fallback: string) =>
  process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : fallback;
const group = arg("--group", "fixed"),
  supportMode = arg("--support-mode", "side-middle");
if (
  !["support", "fixed", "assist", "reversed"].includes(group) ||
  !["side-middle", "side-thumb"].includes(supportMode)
)
  throw new Error("Unknown bounded probe group");
const divisions = Number(arg("--samples", "16"));
if (!Number.isInteger(divisions) || divisions < 8 || divisions > 256)
  throw new Error("samples must be 8..256 intervals");
const sources = [
  "evidence/finger-base-grip.json",
  "evidence/finger-role-strokes.json",
  "src/scene/finger-rig.json",
];
const inputHashes = Object.fromEntries(
  sources.map((path) => [
    path,
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  ]),
);
const source = JSON.parse(readFileSync(sources[0], "utf8"));
const roles = JSON.parse(readFileSync(sources[1], "utf8"));
const base = Object.fromEntries(
  source.hands.map((hand: SourceHand) => [hand.side, hand]),
) as Record<Side, SourceHand>;
const sides: Side[] = ["left", "right"],
  X = new Vector3(1, 0, 0),
  identity = new Quaternion();
const move = parseMove("M'"); // normal L = -X, positive angle means world-X negative rotation.
const hands = {} as Record<Side, DexterousHand>,
  meshes = {} as Record<Side, Mesh[]>;
const fingerMeshes = {} as Record<Side, Mesh[][]>,
  pads = {} as Record<Side, Triangle[][]>;
const modelHash = createHash("sha256");
for (const side of sides) {
  const directory = resolve("public/models/wuji/hand/body/urdf"),
    loader = new URDFLoader();
  loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, done) => {
    const bytes = readFileSync(url);
    modelHash.update(url).update(bytes);
    const raw = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    raw.deleteAttribute("normal");
    const geometry = mergeVertices(raw, 1e-6);
    raw.dispose();
    geometry.computeBoundingBox();
    done(new Mesh(geometry, material));
  };
  const urdf = readFileSync(`${directory}/${side}.urdf`, "utf8");
  modelHash.update(urdf);
  hands[side] = new DexterousHand(loader.parse(urdf, directory + "/"), side);
  meshes[side] = [];
  hands[side].root.traverse((node) => {
    if (node instanceof Mesh) meshes[side].push(node);
  });
  fingerMeshes[side] = Array.from({ length: 5 }, (_, f) => {
    const result: Mesh[] = [];
    hands[side].robot.links[`${side}_finger${f + 1}_link1`].traverse((node) => {
      if (node instanceof Mesh) result.push(node);
    });
    return result;
  });
  hands[side].root.updateMatrixWorld(true);
  pads[side] = Array.from({ length: 5 }, (_, f) => {
    const tip = hands[side].robot.links[`${side}_finger${f + 1}_tip_link`],
      triangles: Triangle[] = [];
    tip.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const transform = tip.matrixWorld
          .clone()
          .invert()
          .multiply(node.matrixWorld),
        vertices = node.geometry.getAttribute("position"),
        index = node.geometry.index,
        count = index?.count ?? vertices.count;
      for (let i = 0; i < count; i += 3)
        triangles.push(
          new Triangle(
            ...([0, 1, 2].map((j) =>
              new Vector3()
                .fromBufferAttribute(
                  vertices,
                  index ? index.getX(i + j) : i + j,
                )
                .applyMatrix4(transform),
            ) as [Vector3, Vector3, Vector3]),
          ),
        );
    });
    return triangles;
  });
}
const assetSHA256 = modelHash.digest("hex");
const names = (side: Side, finger: FingerIndex) =>
  fingerJoints(side, finger).map((j) => j.name);
function setAngles(side: Side, finger: FingerIndex, angles: number[]) {
  names(side, finger).forEach((name, index) =>
    hands[side].robot.joints[name].setJointValue(angles[index]),
  );
}
function apply(side: Side, pose: Pose) {
  hands[side].root.position.fromArray(pose.position);
  hands[side].root.quaternion.fromArray(pose.quaternion);
  hands[side].robot.setJointValues(pose.joints);
  hands[side].root.updateMatrixWorld(true);
}
function current(side: Side): Pose {
  return {
    position: hands[side].root.position.toArray(),
    quaternion: hands[side].root.quaternion.toArray(),
    joints: Object.fromEntries(
      Object.entries(hands[side].robot.joints)
        .filter(([, j]) => j.jointType !== "fixed")
        .map(([name, j]) => [name, j.angle]),
    ),
  };
}
function poseForGate(side: Side): HandPose {
  const pose = current(side);
  return {
    position: new Vector3().fromArray(pose.position),
    quaternion: new Quaternion().fromArray(pose.quaternion),
    joints: pose.joints,
    closed: 1,
  };
}
function surfacePad(
  side: Side,
  finger: FingerIndex,
  targetLocal: Vector3,
  normalLocal: Vector3,
) {
  const point = new Vector3(),
    best = new Vector3();
  let distance = Infinity;
  let extreme = Infinity;
  for (const triangle of pads[side][finger - 1])
    for (const vertex of [triangle.a, triangle.b, triangle.c]) {
      const projected = vertex.dot(normalLocal);
      if (projected < extreme) {
        extreme = projected;
        best.copy(vertex);
      }
    }
  for (const triangle of pads[side][finger - 1]) {
    triangle.closestPointToPoint(targetLocal, point);
    if (point.dot(normalLocal) > extreme + 0.00005) continue;
    const d = point.distanceToSquared(targetLocal);
    if (d < distance) {
      distance = d;
      best.copy(point);
    }
  }
  return best;
}
function fitPad(
  side: Side,
  finger: FingerIndex,
  target: Vector3,
  normal: Vector3,
  initial: number[],
  padSeed: Vector3,
) {
  const wrist = {
    position: hands[side].root.position.clone(),
    quaternion: hands[side].root.quaternion.clone(),
  };
  let offset = padSeed.clone(),
    angles = initial.slice();
  for (let iteration = 0; iteration < 8; iteration++) {
    const fit = fitFinger({
      side,
      finger,
      position: target,
      initial: angles,
      wrist,
      padOffset: offset,
      tolerance: 0.000015,
      iterations: 100,
    });
    angles = fit.angles;
    const frame = forwardFinger(side, finger, angles, wrist);
    // A point on an actual distal STL triangle, not a fingertip origin or an interior centroid.
    const inverse = frame.quaternion.clone().invert();
    offset = surfacePad(
      side,
      finger,
      target.clone().sub(frame.position).applyQuaternion(inverse),
      normal.clone().applyQuaternion(inverse),
    );
  }
  const fitted = fitFinger({
    side,
    finger,
    position: target,
    initial: angles,
    wrist,
    padOffset: offset,
    tolerance: 0.000015,
    iterations: 100,
  });
  setAngles(side, finger, fitted.angles);
  hands[side].root.updateMatrixWorld(true);
  return {
    angles: fitted.angles,
    errorMM: fitted.error * 1000,
    padOffset: offset,
  };
}
const point = new Vector3();
function supportSweep(side: Side) {
  // Exact maximum of vertex/box depth for a stationary hand over a full 90° M.
  let depthMM = 0,
    witness = "";
  for (const mesh of meshes[side]) {
    const vertices = mesh.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      point
        .fromBufferAttribute(vertices, i)
        .applyMatrix4(mesh.matrixWorld)
        .sub(CENTER);
      const box = Math.min(
        0.045 - Math.abs(point.x),
        0.045 - Math.abs(point.y),
        0.045 - Math.abs(point.z),
      );
      const fixed = Math.min(box, Math.abs(point.x) - 0.015);
      const middle = Math.min(
        0.015 - Math.abs(point.x),
        0.045 - Math.hypot(point.y, point.z) / Math.SQRT2,
      );
      const depth = Math.max(fixed, middle) * 1000;
      if (depth > depthMM) {
        depthMM = depth;
        witness = mesh.parent?.parent?.name ?? mesh.name;
      }
    }
  }
  return { depthMM, witness };
}
function sliceWitness(side: Side, angle: number) {
  // Diagnostic of the same three slabs used by DexterousHand.penetration.
  let depthMM = 0,
    link = "",
    worldPoint: number[] = [],
    slab = 0;
  const p = new Vector3(),
    turned = new Vector3();
  for (const mesh of meshes[side]) {
    const vertices = mesh.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      p.fromBufferAttribute(vertices, i)
        .applyMatrix4(mesh.matrixWorld)
        .sub(CENTER);
      turned.copy(p).applyAxisAngle(X, angle);
      for (const layer of [-1, 0, 1]) {
        const v = layer === 0 ? turned : p,
          axis = -v.x;
        const depth =
          Math.min(
            0.045 - Math.abs(v.x),
            0.045 - Math.abs(v.y),
            0.045 - Math.abs(v.z),
            axis - (layer * 0.03 - 0.015),
            layer * 0.03 + 0.015 - axis,
          ) * 1000;
        if (depth > depthMM) {
          depthMM = depth;
          link = mesh.parent?.parent?.name ?? mesh.name;
          worldPoint = p.clone().add(CENTER).toArray();
          slab = layer;
        }
      }
    }
  }
  return { depthMM, link, worldPoint, slab };
}
function support(side: Side) {
  const b = base[side],
    role = roles.hands.find((hand: any) => hand.side === side),
    sign = side === "right" ? 1 : -1;
  apply(side, { ...b.wrist, joints: { ...role.activePose.joints } });
  const chosen: FingerIndex[] =
    supportMode === "side-middle" ? [2, 3, 5] : [1, 2, 5];
  const contacts: FingerContact[] = [],
    measurements: any[] = [];
  for (const finger of chosen) {
    const original = b.contacts.find((c) => c.finger === finger)!;
    const target = new Vector3().fromArray(original.target);
    if (finger === 3) target.z = 0.015;
    if (finger === 1) target.set(sign * 0.0452, 0.332, 0.02);
    target.x = sign * 0.0452;
    const fitted = fitPad(
      side,
      finger,
      target,
      new Vector3(sign, 0, 0),
      names(side, finger).map((name) => b.joints[name]),
      new Vector3().fromArray(original.padLocalOffset),
    );
    contacts.push({
      side,
      finger,
      role: "support",
      point: target.clone().sub(CENTER),
      normal: new Vector3(sign, 0, 0),
      padOffset: fitted.padOffset,
    });
    measurements.push({
      finger,
      target: target.toArray(),
      errorMM: fitted.errorMM,
      angles: fitted.angles,
      padOffset: fitted.padOffset.toArray(),
    });
  }
  const cross = contacts[1].point
    .clone()
    .sub(contacts[0].point)
    .cross(contacts[2].point.clone().sub(contacts[0].point));
  const sweep = supportSweep(side),
    pose = current(side),
    area = cross.length() / 2;
  return {
    side,
    pose,
    contacts,
    measurements,
    areaM2: area,
    sweep,
    passed:
      measurements.every((c) => c.errorMM <= 0.3) &&
      area > 0.00015 &&
      sweep.depthMM <= 0.3,
  };
}
const supports = Object.fromEntries(
  sides.map((side) => [side, support(side)]),
) as Record<Side, ReturnType<typeof support>>;
for (const side of sides)
  console.log(
    JSON.stringify({
      stage: "support",
      side,
      mode: supportMode,
      passed: supports[side].passed,
      areaM2: supports[side].areaM2,
      sweep: supports[side].sweep,
      contacts: supports[side].measurements,
    }),
  );

type Candidate = {
  side: Side;
  finger: FingerIndex;
  assisted: boolean;
  rollDegrees: number;
};
function initialPose(side: Side, rollDegrees: number) {
  const rotation = new Quaternion()
    .setFromAxisAngle(new Vector3(0, -1, 0), (rollDegrees * Math.PI) / 180)
    .multiply(
      new Quaternion().setFromUnitVectors(
        new Vector3(side === "left" ? -1 : 1, 0, 0),
        new Vector3(0, -1, 0),
      ),
    );
  const role = roles.hands.find((hand: any) => hand.side === side),
    b = base[side].wrist;
  return {
    position: new Vector3()
      .fromArray(b.position)
      .sub(CENTER)
      .applyQuaternion(rotation)
      .add(CENTER)
      .toArray(),
    quaternion: rotation
      .multiply(new Quaternion().fromArray(b.quaternion))
      .toArray(),
    joints: { ...role.activePose.joints },
  };
}
function run(def: Candidate, count: number) {
  const other: Side = def.side === "left" ? "right" : "left",
    fixed = supports[other];
  const start = initialPose(def.side, def.rollDegrees),
    origin = new Vector3(0, -0.0452, -0.02),
    normal = new Vector3(0, -1, 0);
  const baseContact = base[def.side].contacts.find(
    (c) => c.finger === def.finger,
  )!;
  let angles = names(def.side, def.finger).map(
    (name) => base[def.side].joints[name],
  );
  let padOffset = new Vector3().fromArray(baseContact.padLocalOffset),
    maxJump = 0;
  const frames: any[] = [],
    worst = {
      errorMM: 0,
      activeDepthMM: 0,
      supportDepthMM: 0,
      limitViolation: 0,
    };
  let supportFailures = 0;
  for (let i = 0; i <= count; i++) {
    const t = i / count,
      smooth = t * t * (3 - 2 * t),
      angle = (Math.PI / 2) * t,
      rotation = new Quaternion().setFromAxisAngle(X, -angle);
    const wrist = structuredClone(start);
    if (def.assisted) {
      wrist.position[1] += 0.018 * smooth;
      wrist.position[2] -= 0.012 * smooth;
      wrist.quaternion = new Quaternion()
        .setFromAxisAngle(X, ((-15 * Math.PI) / 180) * smooth)
        .multiply(new Quaternion().fromArray(start.quaternion))
        .toArray();
    }
    apply(def.side, wrist);
    apply(other, fixed.pose);
    const target = origin.clone().applyQuaternion(rotation).add(CENTER);
    const fitted = fitPad(
      def.side,
      def.finger,
      target,
      normal.clone().applyQuaternion(rotation),
      angles,
      padOffset,
    );
    if (i)
      maxJump = Math.max(
        maxJump,
        ...fitted.angles.map((a, j) => Math.abs(a - angles[j])),
      );
    angles = fitted.angles;
    padOffset = fitted.padOffset;
    const contact: FingerContact = {
      side: def.side,
      finger: def.finger,
      role: "drive",
      point: origin,
      normal,
      padOffset,
    };
    const poses = { left: poseForGate("left"), right: poseForGate("right") };
    const measured = measureContact(
      poses[def.side],
      contact,
      move,
      angle,
      identity,
    );
    const supported = hasMeasuredSupport(
      poses,
      fixed.contacts,
      move,
      angle,
      identity,
    );
    if (!supported) supportFailures++;
    const activeDepth = hands[def.side].penetration(identity, move, angle),
      supportDepth = hands[other].penetration(identity, move, angle);
    const limitViolation = Math.max(
      0,
      ...fingerJoints(def.side, def.finger).flatMap((joint, j) => [
        joint.lower - angles[j],
        angles[j] - joint.upper,
      ]),
    );
    worst.errorMM = Math.max(worst.errorMM, measured.error * 1000);
    worst.activeDepthMM = Math.max(worst.activeDepthMM, activeDepth.maxDepthMM);
    worst.supportDepthMM = Math.max(
      worst.supportDepthMM,
      supportDepth.maxDepthMM,
    );
    worst.limitViolation = Math.max(worst.limitViolation, limitViolation);
    frames.push({
      t,
      worldXDegrees: -90 * t,
      target: target.toArray(),
      normal: normal.clone().applyQuaternion(rotation).toArray(),
      actual: measured.actual.toArray(),
      errorMM: measured.error * 1000,
      padOffset: padOffset.toArray(),
      angles: angles.slice(),
      activeDepth,
      activeWitness: sliceWitness(def.side, angle),
      supportDepth,
      supported,
      left: current("left"),
      right: current("right"),
    });
  }
  return {
    id: `${def.assisted ? "assist" : "fixed"}-D-roll${def.rollDegrees}-${def.side}-finger${def.finger}`,
    ...def,
    sampleCount: count + 1,
    maxJointJumpRadians: maxJump,
    passed:
      fixed.passed &&
      !supportFailures &&
      worst.errorMM <= 0.3 &&
      worst.activeDepthMM <= 0.3 &&
      worst.supportDepthMM <= 0.3 &&
      worst.limitViolation === 0 &&
      maxJump < 0.25,
    supportFailures,
    worst,
    frames,
  };
}
const candidates: Candidate[] =
  group === "support"
    ? []
    : sides.flatMap((side) =>
        (group === "fixed"
          ? [3, 2, 4]
          : group === "reversed"
            ? [3, 4]
            : [3]
        ).map((finger) => ({
          side,
          finger: finger as FingerIndex,
          assisted: group === "assist",
          rollDegrees: group === "reversed" ? 180 : 0,
        })),
      );
const results = candidates.map((candidate) => {
  const result = run(candidate, divisions);
  console.log(
    JSON.stringify({
      stage: "stroke",
      id: result.id,
      passed: result.passed,
      maxJointJumpRadians: result.maxJointJumpRadians,
      worst: result.worst,
      supportFailures: result.supportFailures,
    }),
  );
  return result;
});
const output = `evidence/finger-slice-${group}-${supportMode}-${divisions}.json`;
writeFileSync(
  output,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      inputHashes,
      assetSHA256,
      scriptSHA256: createHash("sha256")
        .update(readFileSync("scripts/finger-slice-probe.ts"))
        .digest("hex"),
      group,
      supportMode,
      move,
      cubeCenter: CENTER.toArray(),
      cubeOrientation: [0, 0, 0, 1],
      padSelection:
        "actual STL surface point within 0.05 mm of its outward-normal envelope",
      contactExteriorClearanceMM: 0.2,
      penetrationThresholdMM: 0.3,
      maxAssistedWristTranslationMM: Math.hypot(18, 12),
      maxAssistedWristRotationDegrees: 15,
      support: Object.fromEntries(
        sides.map((side) => [
          side,
          {
            ...supports[side],
            contacts: supports[side].contacts.map((c) => ({
              ...c,
              point: c.point.toArray(),
              normal: c.normal.toArray(),
              padOffset: c.padOffset.toArray(),
            })),
          },
        ]),
      ),
      results,
      scope:
        "A genuine middle slab about world X; contact starts on external D surface at x=0 and travels to external F. Cube frame is identity. Three stationary support points all lie on x=+/-0.0452 outer side surfaces. FK/IK uses real URDF limits; contact offsets lie on distal STL triangles; production hand.penetration uses slice geometry. No entry/exit or hardware force proof.",
      limitations: [
        "Current pass is only contact, URDF limits and sampled hand/cube mesh vertices; mutual/self hand mesh and arm clearance require a further gate before a usable trajectory may be claimed.",
        "Support sweep is continuous for the vertex/box depth metric; moving driver samples are not continuous triangle-intersection proof.",
        "Pad material contact may slide over the distal mesh; each sample records its actual local surface point.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(output);
