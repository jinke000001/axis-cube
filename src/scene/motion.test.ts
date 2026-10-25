import { describe, expect, it } from "vitest";
import { Quaternion, Vector3, Mesh, MeshStandardMaterial } from "three";
import {
  applyAlgorithm,
  DEFAULT_PALETTE,
  FACES,
  NORMALS,
  parseAlgorithm,
  SOLVED,
} from "../core/cube";
import {
  canonical,
  CENTER,
  compileMotion,
  motionDuration,
  motionPlanCost,
  measureMotionEdge,
  motionSampleTimes,
  sampleMotion,
} from "./motion";
import { gripCandidates, type GripAssignment } from "./grip-planner";
import { ARM_LENGTHS, WRIST_LENGTH, WRIST_BACK_OFFSET } from "./arm";
import { CubeModel } from "./cube-model";

describe("mechanical motion invariants", () => {
  const sequence = FACES.flatMap((f) => [f, f + "2", f + "'"]).join(" ");
  it("keeps the support engaged, the wrists in reach, and the trajectories continuous", () => {
    const steps = compileMotion(parseAlgorithm(sequence));
    let previous = sampleMotion(steps, 0);
    for (const t of motionSampleTimes(steps, 96)) {
      const frame = sampleMotion(steps, t);
      expect(Math.max(frame.left.closed, frame.right.closed)).toBeGreaterThan(
        0.999,
      );
      for (const side of ["left", "right"] as const) {
        const pose = frame[side],
          last = previous[side],
          origin = new Vector3(side === "left" ? -0.355 : 0.355, 0.155, -0.09);
        expect(pose.position.toArray().every(Number.isFinite)).toBe(true);
        // Reach is measured at the arm mount, including the offset adapter,
        // against the actual two link lengths rather than an old wrist-radius guess.
        const mount = pose.position
          .clone()
          .addScaledVector(
            new Vector3(0, 0, 1).applyQuaternion(pose.quaternion),
            -WRIST_LENGTH,
          )
          .addScaledVector(
            new Vector3(1, 0, 0).applyQuaternion(pose.quaternion),
            -WRIST_BACK_OFFSET,
          );
        expect(mount.distanceTo(origin)).toBeLessThan(
          ARM_LENGTHS.upper + ARM_LENGTHS.fore - 0.005,
        );
        expect(mount.distanceTo(origin)).toBeGreaterThan(
          Math.abs(ARM_LENGTHS.upper - ARM_LENGTHS.fore),
        );
        expect(pose.position.distanceTo(last.position)).toBeLessThan(0.022);
        expect(pose.quaternion.angleTo(last.quaternion)).toBeLessThan(0.18);
        expect(Math.abs(pose.closed - last.closed)).toBeLessThan(0.13);
      }
      previous = frame;
    }
  });
  it("aligns the chosen face with the turning hand and finishes at the exact quarter angle", () => {
    for (const step of compileMotion(parseAlgorithm(sequence))) {
      const worldNormal = new Vector3(
        ...NORMALS[step.move.face],
      ).applyQuaternion(step.after);
      expect(
        worldNormal.distanceTo(
          new Vector3(step.active === "left" ? -1 : 1, 0, 0),
        ),
      ).toBeLessThan(1e-6);
    }
    const steps = compileMotion(parseAlgorithm(sequence));
    for (const step of steps) {
      const last = sampleMotion(steps, step.start + step.duration - 1e-7);
      expect(last.angle).toBeCloseTo(
        step.move.turns === 3
          ? Math.PI / 2
          : step.move.turns === 2
            ? -Math.PI
            : -Math.PI / 2,
        8,
      );
    }
    expect(sampleMotion(steps, motionDuration(steps)).complete).toBe(true);
  });
});

const photoSolution =
  "U2 D' F' U R' B' R2 L D R F2 U2 R2 D L2 U B2 U' R2 D2 B2";

describe("flow choreography", () => {
  it("spends most of the score on visible turns and omits redundant regrips", () => {
    const steps = compileMotion(parseAlgorithm(photoSolution));
    expect(motionDuration(steps)).toBeCloseTo(5, 12);
    const previousPolicy = compileMotion(parseAlgorithm(photoSolution), {
      reorientHands: ["right"],
    });
    expect(steps.filter((s) => s.exitReleased).length).toBeGreaterThanOrEqual(
      previousPolicy.filter((s) => s.exitReleased).length,
    );
    const turnTime = steps
      .flatMap((s) => s.segments)
      .filter((s) => s.stage === "TURN")
      .reduce((sum, s) => sum + s.duration, 0);
    expect(turnTime / motionDuration(steps)).toBeGreaterThan(0.4);
    for (const [i, step] of steps.entries()) {
      expect(step.segments.filter((s) => s.stage === "TURN")).toHaveLength(1);
      if (step.exitReleased) {
        expect(step.segments.at(-1)?.stage).toBe("RELEASE");
        expect(steps[i + 1].segments[0].stage).toBe("REORIENT");
        expect(
          sampleMotion(steps, steps[i + 1].start)[step.active].closed,
        ).toBeCloseTo(0.96, 10);
      }
    }
  });

  it("has a calibrated support attachment, not just closed fingers in the air", () => {
    const steps = compileMotion(parseAlgorithm(photoSolution + " L2 R2"));
    for (const time of motionSampleTimes(steps, 16)) {
      const frame = sampleMotion(steps, time),
        side = frame.support!;
      const expected = canonical(side);
      if (frame.stage === "REORIENT" || frame.stage === "RECEIVE") {
        const rotation = frame.orientation
          .clone()
          .multiply(steps[frame.index].before.clone().invert());
        expected.position.sub(CENTER).applyQuaternion(rotation).add(CENTER);
        expected.quaternion.premultiply(rotation);
      }
      expect(frame[side].closed).toBe(1);
      expect(frame[side].position.distanceTo(expected.position)).toBeLessThan(
        1e-9,
      );
      expect(frame[side].quaternion.angleTo(expected.quaternion)).toBeLessThan(
        1e-7,
      );
    }
  });

  it("keeps both poses and endpoint velocities continuous, including seeks and carry-open boundaries", () => {
    const steps = compileMotion(parseAlgorithm(photoSolution + " L2 R2"));
    const boundaries = steps
      .flatMap((s) => s.segments.map((p) => p.start))
      .slice(1)
      .concat(motionDuration(steps));
    const epsilon = 1e-7;
    for (const time of boundaries) {
      const before = sampleMotion(steps, time - epsilon),
        at = sampleMotion(steps, time),
        after = sampleMotion(steps, time + epsilon);
      expect(sampleMotion(steps, time)).toEqual(at);
      for (const side of ["left", "right"] as const) {
        expect(
          before[side].position.distanceTo(after[side].position),
        ).toBeLessThan(1e-7);
        expect(
          before[side].quaternion.angleTo(after[side].quaternion),
        ).toBeLessThan(1e-7);
        expect(Math.abs(before[side].closed - after[side].closed)).toBeLessThan(
          1e-7,
        );
        // Nonzero endpoint slopes in the old radial arc created a visible jerk.
        const incoming = at[side].position
          .clone()
          .sub(before[side].position)
          .divideScalar(epsilon);
        const outgoing = after[side].position
          .clone()
          .sub(at[side].position)
          .divideScalar(epsilon);
        expect(incoming.distanceTo(outgoing)).toBeLessThan(0.001);
      }
    }
    for (const [i, step] of steps.entries()) {
      expect(sampleMotion(steps, step.start).index).toBe(i);
      expect(sampleMotion(steps, step.start).angle).toBeCloseTo(0, 12);
    }
  });

  it("keeps the hand attached to the turning layer throughout a single continuous half turn", () => {
    for (const notation of ["R2", "L2", "U2", "F2", "D2", "B2"]) {
      const steps = compileMotion(parseAlgorithm(notation)),
        step = steps[0];
      const turn = step.segments.find((s) => s.stage === "TURN")!;
      const start = sampleMotion(steps, turn.start),
        expected = start[step.active];
      let previousAngle = 0;
      for (let i = 0; i <= 100; i++) {
        const frame = sampleMotion(
          steps,
          turn.start + (turn.duration * i) / 100,
        );
        const undo = new Quaternion().setFromAxisAngle(
          new Vector3(1, 0, 0),
          -frame.angle * (step.active === "left" ? -1 : 1),
        );
        const pose = frame[step.active];
        expect(
          pose.position
            .clone()
            .sub(CENTER)
            .applyQuaternion(undo)
            .add(CENTER)
            .distanceTo(expected.position),
        ).toBeLessThan(1e-8);
        expect(
          undo.clone().multiply(pose.quaternion).angleTo(expected.quaternion),
        ).toBeLessThan(1e-7);
        expect(pose.closed).toBeCloseTo(1, 10);
        expect(frame.angle).toBeLessThanOrEqual(previousAngle + 1e-12);
        previousAngle = frame.angle;
      }
      expect(previousAngle).toBeCloseTo(-Math.PI, 10);
    }
  });

  it("preserves continuity for every neighboring move pair", () => {
    const turns = FACES.flatMap((f) => [f, f + "2", f + "'"]);
    for (const first of turns)
      for (const second of turns) {
        const steps = compileMotion(parseAlgorithm(first + " " + second)),
          boundary = steps[1].start;
        const before = sampleMotion(steps, boundary - 1e-7),
          after = sampleMotion(steps, boundary);
        for (const side of ["left", "right"] as const) {
          expect(
            before[side].position.distanceTo(after[side].position),
          ).toBeLessThan(1e-7);
          expect(
            before[side].quaternion.angleTo(after[side].quaternion),
          ).toBeLessThan(1e-7);
          expect(
            Math.abs(before[side].closed - after[side].closed),
          ).toBeLessThan(1e-7);
        }
        expect(after.index).toBe(1);
      }
  });
});

describe("whole-sequence hand planning", () => {
  it("finds the least-cost complete path with measured simultaneous hand travel", () => {
    for (const algorithm of [
      "U F U' R B2 L2",
      "F U D B R F",
      "U2 D' F' U R' B'",
    ]) {
      const moves = parseAlgorithm(algorithm),
        alternatives: GripAssignment[][] = [];
      const visit = (path: GripAssignment[]) => {
        if (path.length === moves.length) {
          alternatives.push(path);
          return;
        }
        for (const choice of gripCandidates(
          moves[path.length],
          path.at(-1)?.after ?? new Quaternion(),
        ))
          visit([...path, choice]);
      };
      visit([]);
      const concentration = (plan: readonly GripAssignment[]) => {
        const runs: number[] = [];
        plan.forEach((step, i) => {
          if (i > 0 && step.active === plan[i - 1].active)
            runs[runs.length - 1]++;
          else runs.push(1);
        });
        return runs.reduce((sum, n) => sum + n * n, 0);
      };
      const costs = alternatives.map((plan) => ({
          ...motionPlanCost(plan),
          concentration: concentration(plan),
        })),
        minimumDuration = Math.min(...costs.map((c) => c.duration));
      const sameDuration = costs.filter(
        (c) => Math.abs(c.duration - minimumDuration) < 1e-8,
      );
      const minimumConcentration = Math.min(
        ...sameDuration.map((c) => c.concentration),
      );
      const minimumTravel = Math.min(
        ...sameDuration
          .filter((c) => c.concentration === minimumConcentration)
          .map((c) => c.travel),
      );
      const chosenPlan = compileMotion(moves),
        chosen = motionPlanCost(chosenPlan);
      expect(concentration(chosenPlan)).toBe(minimumConcentration);
      expect(chosen.duration).toBeCloseTo(minimumDuration, 8);
      expect(chosen.travel).toBeCloseTo(minimumTravel, 8);
    }
  });
  it("charges recovery once, shares active turns, and preserves the prior gesture budget", () => {
    const moves = parseAlgorithm(photoSolution),
      optimized = compileMotion(moves),
      previous = compileMotion(moves, { reorientHands: ["right"] });
    const optimizedCost = motionPlanCost(optimized),
      previousCost = motionPlanCost(previous);
    expect(optimizedCost.duration).toBeLessThanOrEqual(
      previousCost.duration + 1e-8,
    );
    expect(
      optimized.filter((s) => s.active === "left").length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      optimized.filter((s) => s.active === "right").length,
    ).toBeGreaterThanOrEqual(5);
    const end = measureMotionEdge(optimized.at(-1)!, null);
    expect(end.duration).toBeCloseTo(0.6 + 0.18 + 1.5, 8);
    expect(motionDuration(optimized)).toBeCloseTo(5, 12);
    expect(compileMotion(moves)).toEqual(optimized);
  });
});

describe("visible cube and authoritative state agree", () => {
  it("preserves all 54 sticker positions and colors across every completed turn", () => {
    const cube = new CubeModel(),
      state = applyAlgorithm(SOLVED, "R U F2 D' B L2");
    const orientation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 2, 3).normalize(),
      0.71,
    );
    const snapshot = () => {
      const result: string[] = [];
      cube.root.updateMatrixWorld(true);
      cube.root.traverse((node) => {
        if (!(node instanceof Mesh) || !node.name.startsWith("sticker-"))
          return;
        const p = node.getWorldPosition(new Vector3());
        const key = p
          .toArray()
          .map((v) => v.toFixed(5))
          .join(",");
        result.push(
          key +
            ":" +
            (node.material as MeshStandardMaterial).color.getHexString(),
        );
      });
      return result.sort();
    };
    for (const f of FACES)
      for (const suffix of ["", "'", "2"]) {
        const move = parseAlgorithm(f + suffix)[0];
        cube.update(
          state,
          DEFAULT_PALETTE,
          orientation,
          f,
          move.turns === 3 ? Math.PI / 2 : (-Math.PI / 2) * move.turns,
        );
        const animated = snapshot();
        cube.update(
          applyAlgorithm(state, move.notation),
          DEFAULT_PALETTE,
          orientation,
        );
        expect(snapshot()).toEqual(animated);
        expect(animated).toHaveLength(54);
      }
    cube.dispose();
  });
});
