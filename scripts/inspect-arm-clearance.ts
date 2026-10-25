import { motionValidationCases } from "./motion-validation-cases";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Box3, Group, Matrix4, Mesh, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MechanicalArm, ARM_LENGTHS, WRIST_LENGTH } from "../src/scene/arm";
import { DexterousHand } from "../src/scene/hand";
import {
  CENTER,
  compileMotion,
  motionSampleTimes,
  sampleMotion,
  type Side,
} from "../src/scene/motion";
import { NORMALS, parseAlgorithm } from "../src/core/cube";
import { restingFingerFrame } from "../src/scene/finger-grips";

Object.assign(globalThis, { DOMParser, Document, Element });
const sides = ["left", "right"] as const;
const arms = Object.fromEntries(
  sides.map((s) => [s, new MechanicalArm(s)]),
) as Record<Side, MechanicalArm>;
const hands = {} as Record<Side, DexterousHand>;
const handMeshes = {} as Record<Side, Mesh[]>;
for (const side of sides) {
  const dir = resolve("public/models/wuji/hand/body/urdf");
  const loader = new URDFLoader();
  loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, done) => {
    const bytes = readFileSync(url);
    const geometry = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    geometry.deleteAttribute("normal");
    const merged = mergeVertices(geometry, 1e-6);
    geometry.dispose();
    done(new Mesh(merged, material));
  };
  hands[side] = new DexterousHand(
    loader.parse(readFileSync(dir + "/" + side + ".urdf", "utf8"), dir + "/"),
    side,
  );
  handMeshes[side] = [];
  hands[side].root.traverse((node) => {
    if (node instanceof Mesh) {
      node.geometry.computeBoundingBox();
      handMeshes[side].push(node);
    }
  });
}
const links = sides.flatMap((side) =>
  (["upper", "fore"] as const).map((part) => {
    const root = arms[side].root.getObjectByName(
      `${side}-${part === "upper" ? "upper-arm" : "forearm"}`,
    ) as Group;
    const length = ARM_LENGTHS[part];
    const meshes: Mesh[] = [];
    root.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    return {
      side,
      part,
      root,
      length,
      meshes,
      box: new OBB(),
      inverse: new Matrix4(),
    };
  }),
);
const localBox = (length: number) =>
  new OBB().fromBox3(
    new Box3(
      new Vector3(-0.03, -length / 2, -0.035),
      new Vector3(0.03, length / 2, 0.035),
    ),
  );
const meshBox = new OBB(),
  matrix = new Matrix4(),
  point = new Vector3(),
  q = new Vector3();
function bodyDepth(p: Vector3, length: number) {
  // Exact solid interiors of the rendered round-corner shell and tapered metal core.
  const radius = 0.008;
  q.set(
    Math.abs(p.x) - (0.047 / 2 - radius),
    Math.abs(p.y) - ((length * 0.77) / 2 - radius),
    Math.abs(p.z) - (0.041 / 2 - radius),
  );
  const shell =
    radius -
    (Math.hypot(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0)) +
      Math.min(Math.max(q.x, q.y, q.z), 0));
  const half = (length - 0.028) / 2;
  const taper = 0.025 - (0.004 * (p.y + half)) / (2 * half);
  return Math.max(
    shell,
    Math.min(half - Math.abs(p.y), taper - Math.hypot(p.x, p.z)),
  );
}
function meshIntoLink(mesh: Mesh, link: (typeof links)[number]) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  meshBox.fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  if (!meshBox.intersectsOBB(link.box)) return 0;
  matrix.copy(link.inverse).multiply(mesh.matrixWorld);
  const vertices = mesh.geometry.getAttribute("position");
  let deepest = 0;
  for (let i = 0; i < vertices.count; i++) {
    point.fromBufferAttribute(vertices, i).applyMatrix4(matrix);
    deepest = Math.max(deepest, bodyDepth(point, link.length));
  }
  return deepest;
}
let failures = 0;
console.log(
  JSON.stringify({
    armLengths: ARM_LENGTHS,
    wristLength: WRIST_LENGTH,
    samplesPerGesture: 64,
    scope:
      "actual hand vertices against both arm bodies; cross-arm bodies; arm-cube envelope; reach; elbow continuity",
  }),
);
const fingerStatic = process.argv.includes("--finger-static");
const cases = fingerStatic ? [{ notation: "", options: {}, label: "static finger grip" }] : motionValidationCases();
for (const { notation, options, label } of cases) {
  const steps = compileMotion(parseAlgorithm(notation), options);
  const times = fingerStatic ? [0] : motionSampleTimes(steps, 64);
  let worst = { depthMM: 0, time: 0, phase: "", hand: "", arm: "", link: "" },
    maxReachError = 0,
    maxElbowJump = 0,
    crossArmDepth = 0,
    cubeDepth = 0;
  const previous = {} as Record<Side, Vector3>;
  for (const time of times) {
    const frame = fingerStatic ? restingFingerFrame() : sampleMotion(steps, time);
    for (const side of sides) {
      hands[side].update(frame[side]);
      hands[side].root.updateMatrixWorld(true);
      arms[side].update(frame[side].position, frame[side].quaternion);
      arms[side].root.updateMatrixWorld(true);
      const origin = new Vector3(
        side === "left" ? -0.355 : 0.355,
        0.155,
        -0.09,
      );
      maxReachError = Math.max(
        maxReachError,
        Math.abs(
          arms[side].elbowPosition.distanceTo(origin) - ARM_LENGTHS.upper,
        ),
        Math.abs(
          arms[side].elbowPosition.distanceTo(arms[side].wristPosition) -
            ARM_LENGTHS.fore,
        ),
      );
      if (previous[side])
        maxElbowJump = Math.max(
          maxElbowJump,
          arms[side].elbowPosition.distanceTo(previous[side]),
        );
      previous[side] = arms[side].elbowPosition.clone();
    }
    for (const link of links) {
      link.box.copy(localBox(link.length)).applyMatrix4(link.root.matrixWorld);
      link.inverse.copy(link.root.matrixWorld).invert();
    }
    for (const link of links) {
      for (const side of sides)
        for (const mesh of handMeshes[side]) {
          const depth = meshIntoLink(mesh, link);
          if (depth * 1000 > worst.depthMM)
            worst = {
              depthMM: depth * 1000,
              time,
              phase: frame.stage,
              hand: mesh.parent?.parent?.name ?? side,
              arm: link.side,
              link: link.part,
            };
        }
      for (const other of links.filter((other) => other.side !== link.side))
        for (const mesh of other.meshes)
          crossArmDepth = Math.max(crossArmDepth, meshIntoLink(mesh, link));
      const inverse = frame.orientation.clone().invert(),
        move = steps[frame.index]?.move;
      const normal = move ? new Vector3(...NORMALS[move.face]) : null;
      const depth = (p: Vector3) =>
        Math.min(
          0.045 - Math.abs(p.x),
          0.045 - Math.abs(p.y),
          0.045 - Math.abs(p.z),
        );
      for (const mesh of link.meshes) {
        const vertices = mesh.geometry.getAttribute("position");
        for (let i = 0; i < vertices.count; i++) {
          point
            .fromBufferAttribute(vertices, i)
            .applyMatrix4(mesh.matrixWorld)
            .sub(CENTER)
            .applyQuaternion(inverse);
          let d = depth(point);
          if (normal && frame.angle) {
            const stationary = Math.min(d, 0.015 - point.dot(normal));
            q.copy(point).applyAxisAngle(normal, -frame.angle);
            d = Math.max(stationary, Math.min(depth(q), q.dot(normal) - 0.015));
          }
          cubeDepth = Math.max(cubeDepth, d);
        }
      }
    }
  }
  console.log(
    JSON.stringify({
      notation: label,
      samples: times.length,
      ...worst,
      maxReachErrorMM: +(maxReachError * 1000).toFixed(2),
      maxElbowJumpMM: +(maxElbowJump * 1000).toFixed(2),
      crossArmDepthMM: +(crossArmDepth * 1000).toFixed(2),
      cubeDepthMM: +(cubeDepth * 1000).toFixed(2),
    }),
  );
  if (
    worst.depthMM > 0.3 ||
    maxReachError > 0.001 ||
    maxElbowJump > 0.04 ||
    crossArmDepth > 0.0003 ||
    cubeDepth > 0.0003
  )
    failures++;
}
if (failures) process.exitCode = 1;
