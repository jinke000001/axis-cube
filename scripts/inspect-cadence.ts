import { writeFileSync } from "node:fs";
import { parseAlgorithm } from "../src/core/cube";
import * as current from "../src/scene/motion";
import * as accepted from "../evidence/accepted-before-flow/src/scene/motion";
import { MechanicalArm } from "../src/scene/arm";
const solution = "U2 D' F' U R' B' R2 L D R F2 U2 R2 D L2 U B2 U' R2 D2 B2";
const moves = parseAlgorithm(solution);
const scenarios = [
  {
    name: "accepted",
    steps: accepted.compileMotion(moves),
    sample: accepted.sampleMotion,
    duration: accepted.motionDuration,
  },
  {
    name: "flow",
    steps: current.compileMotion(moves),
    sample: current.sampleMotion,
    duration: current.motionDuration,
  },
];
const records = [];
for (const scenario of scenarios) {
  const steps = scenario.steps as current.MotionStep[];
  const total = scenario.duration(steps);
  for (const seconds of [5, 20])
    for (const fps of [60, 120]) {
      const distances: number[] = [],
        elbows: number[] = [];
      const arms = {
        left: new MechanicalArm("left"),
        right: new MechanicalArm("right"),
      };
      let worst = { mm: 0, time: 0, side: "", from: "", to: "" };
      // Vary frame alignment: a lucky render phase must not hide a short gesture.
      for (let offset = 0; offset < 16; offset++) {
        let last = scenario.sample(
          steps,
          (offset / 16 / fps / seconds) * total,
        );
        const lastElbow = {
          left: arms.left.elbowPosition.clone(),
          right: arms.right.elbowPosition.clone(),
        };
        for (const side of ["left", "right"] as const) {
          arms[side].update(last[side].position, last[side].quaternion);
          lastElbow[side].copy(arms[side].elbowPosition);
        }
        for (
          let wall = (1 + offset / 16) / fps;
          wall <= seconds + 1 / fps;
          wall += 1 / fps
        ) {
          const frame = scenario.sample(
            steps,
            (Math.min(seconds, wall) / seconds) * total,
          );
          for (const side of ["left", "right"] as const) {
            const mm =
              frame[side].position.distanceTo(last[side].position) * 1000;
            distances.push(mm);
            if (mm > worst.mm)
              worst = {
                mm,
                time: wall,
                side,
                from: last.stage,
                to: frame.stage,
              };
            arms[side].update(frame[side].position, frame[side].quaternion);
            elbows.push(
              arms[side].elbowPosition.distanceTo(lastElbow[side]) * 1000,
            );
            lastElbow[side].copy(arms[side].elbowPosition);
          }
          last = frame;
        }
      }
      distances.sort((a, b) => a - b);
      elbows.sort((a, b) => a - b);
      records.push({
        version: scenario.name,
        seconds,
        fps,
        frameOffsets: 16,
        maxWristMM: +worst.mm.toFixed(2),
        p95WristMM: +distances[Math.floor(distances.length * 0.95)].toFixed(2),
        p99WristMM: +distances[Math.floor(distances.length * 0.99)].toFixed(2),
        wristFramesAboveCubeWidth: distances.filter((mm) => mm > 90).length,
        maxElbowMM: +elbows.at(-1)!.toFixed(2),
        p95ElbowMM: +elbows[Math.floor(elbows.length * 0.95)].toFixed(2),
        worst,
      });
    }
}
const steps = current.compileMotion(moves);
const turnSeconds = steps
  .flatMap((s) => s.segments)
  .filter((s) => s.stage === "TURN")
  .map((s) => s.duration);
const result = {
  date: new Date().toISOString(),
  scope:
    "Deterministic trajectory sampling at nominal display cadence, not measured renderer performance or hardware feasibility.",
  solution,
  moves: moves.length,
  carryBoundaries: steps.filter((s) => s.exitReleased).length,
  turnShare:
    turnSeconds.reduce((a, b) => a + b, 0) / current.motionDuration(steps),
  shortestTurnFramesAt60: Math.min(...turnSeconds) * 60,
  records,
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--save"))
  writeFileSync(
    "evidence/flow-cadence.json",
    JSON.stringify(result, null, 2) + "\n",
  );
