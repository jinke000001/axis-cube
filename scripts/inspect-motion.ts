import { motionValidationCases } from "./motion-validation-cases";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Mesh, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { DexterousHand } from "../src/scene/hand";
import {
  canonical,
  compileMotion,
  motionSampleTimes,
  sampleMotion,
  type Side,
} from "../src/scene/motion";
import { parseAlgorithm } from "../src/core/cube";

Object.assign(globalThis, { DOMParser, Document, Element });
const hands = {} as Record<Side, DexterousHand>;
const closedProfiles: Record<string, unknown> = {
  modelRevision: "829c9aa27cb12c3a49d5b8d63c9869dd8f656702",
  cubeSize: 0.09,
};
for (const side of ["left", "right"] as const) {
  const path = resolve("public/models/wuji/hand/body/urdf/");
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
  const robot = loader.parse(
    readFileSync(path + "/" + side + ".urdf", "utf8"),
    path + "/",
  );
  hands[side] = new DexterousHand(
    robot,
    side,
    process.argv.includes("--write-calibration"),
  );
  closedProfiles[side] = Object.fromEntries(
    Object.entries(robot.joints)
      .filter(([, j]) => j.jointType !== "fixed")
      .map(([name, j]) => [name, j.angle]),
  );
  console.log(
    side,
    "canonical",
    JSON.stringify({
      tips: hands[side].getGripMetrics(),
      penetration: hands[side].penetration(),
    }),
  );
  const gaps = Array(5).fill(Infinity),
    p = new Vector3();
  hands[side].root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    let ancestor = node.parent;
    while (ancestor && !ancestor.name.includes("finger"))
      ancestor = ancestor.parent;
    const finger = Number(ancestor?.name.match(/finger(\d)/)?.[1]);
    if (!finger) return;
    const vertices = node.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      p.fromBufferAttribute(vertices, i)
        .applyMatrix4(node.matrixWorld)
        .sub(new Vector3(0, 0.34, 0));
      if (Math.abs(p.y) < 0.044 && Math.abs(p.z) < 0.044)
        gaps[finger - 1] = Math.min(gaps[finger - 1], Math.abs(p.x) - 0.045);
    }
  });
  console.log(
    side,
    "contact gaps mm",
    gaps.map((v) => Math.round(v * 10000) / 10),
  );
  for (let t = 0; t <= 1; t += 0.1) {
    hands[side].update(canonical(side, t));
    const p = hands[side].penetration();
    if (p.maxDepthMM > 1) console.log(side, "open", t.toFixed(2), p);
  }
}
if (process.argv.includes("--write-calibration"))
  writeFileSync(
    "src/scene/grips.json",
    JSON.stringify(closedProfiles, null, 2) + "\n",
  );
const boxes = {} as Record<Side, { mesh: Mesh; local: OBB; world: OBB }[]>;
for (const side of ["left", "right"] as const) {
  boxes[side] = [];
  hands[side].root.traverse((node) => {
    if (node instanceof Mesh) {
      node.geometry.computeBoundingBox();
      boxes[side].push({
        mesh: node,
        local: new OBB().fromBox3(node.geometry.boundingBox!),
        world: new OBB(),
      });
    }
  });
}
let failures = 0;
// Sample every gesture at a fixed geometric resolution, even in a five-second score.
for (const { notation, options, label } of motionValidationCases()) {
  const steps = compileMotion(parseAlgorithm(notation), options);
  let worst = { depth: 0, time: 0, phase: "", side: "" },
    minWrist = Infinity,
    firstHandOverlap = "",
    maxJointSpeedRatio = 0;
  const previousAngles: Record<string, number> = {};
  let previousTime = 0;
  const times = motionSampleTimes(steps, 64);
  for (const t of times) {
    const frame = sampleMotion(steps, t);
    for (const side of ["left", "right"] as const) {
      hands[side].update(frame[side]);
      const p = hands[side].penetration(
        frame.orientation,
        steps[frame.index]?.move.face,
        frame.angle,
      );
      if (p.maxDepthMM > worst.depth)
        worst = { depth: p.maxDepthMM, time: t, phase: frame.stage, side };
      for (const [name, joint] of Object.entries(hands[side].robot.joints)) {
        if (joint.jointType === "fixed") continue;
        if (
          joint.angle < joint.limit.lower - 1e-7 ||
          joint.angle > joint.limit.upper + 1e-7
        )
          failures++;
        if (name in previousAngles && t > previousTime) {
          const velocity = Number(
            joint.urdfNode?.querySelector("limit")?.getAttribute("velocity"),
          );
          if (velocity)
            maxJointSpeedRatio = Math.max(
              maxJointSpeedRatio,
              Math.abs(joint.angle - previousAngles[name]) /
                (t - previousTime) /
                velocity,
            );
        }
        previousAngles[name] = joint.angle;
      }
      for (const box of boxes[side])
        box.world.copy(box.local).applyMatrix4(box.mesh.matrixWorld);
    }
    if (!firstHandOverlap)
      for (const a of boxes.left)
        for (const b of boxes.right)
          if (a.world.intersectsOBB(b.world))
            firstHandOverlap = `${frame.stage} at ${t.toFixed(2)}s: ${a.mesh.parent?.parent?.name} / ${b.mesh.parent?.parent?.name}`;
    previousTime = t;
    minWrist = Math.min(
      minWrist,
      frame.left.position.distanceTo(frame.right.position),
    );
  }
  console.log(
    label,
    JSON.stringify({
      ...worst,
      minWristMM: Math.round(minWrist * 1000),
      firstHandOverlap,
      samples: times.length,
      raceJointSpeedRatio: Math.round(maxJointSpeedRatio * 1000) / 1000,
    }),
  );
  if (worst.depth > 0.3 || firstHandOverlap || maxJointSpeedRatio > 1.01)
    failures++;
}
console.log(
  "URDF finger velocity limits are enforced at race timing. This does not verify arm speeds, forces, torque, or hardware feasibility.",
);
if (failures) {
  console.error(`${failures} geometry or joint checks require review.`);
  process.exitCode = 1;
}
