import { describe, expect, it } from "vitest";
import { parseAlgorithm } from "../core/cube";
import { compileDirectFingerProgram } from "./finger-direct-program";
import { compileFingerProgram } from "./finger-program";
import { assembleFingerPrograms, sameHandPose } from "./finger-program-assembly";
import { hasMeasuredSupport, measureContact } from "./finger-contact";

describe("continuous calibrated phrase assembly", () => {
  it("removes the out-and-back neutral trip between compatible front turns", () => {
    const moves = parseAlgorithm("F F F'");
    const source = compileDirectFingerProgram(moves);
    const result = assembleFingerPrograms([source], 5, true);
    expect(result.removedSegments).toBeGreaterThan(0);
    expect(result.cost).toBeLessThan(source.cost);
    expect(result.steps.map((step) => step.move.notation)).toEqual(moves.map((move) => move.notation));
    expect(result.duration).toBe(5);
    expect(result.sample(5).index).toBe(moves.length);
    for (let i = 1; i < result.segments.length; i++) {
      const before = result.segments[i - 1].sample(1), after = result.segments[i].sample(0);
      expect(sameHandPose(before.left, after.left)).toBe(true);
      expect(sameHandPose(before.right, after.right)).toBe(true);
    }
    // The eliminated excursions cannot remove support or change drive bodies.
    for (const segment of result.segments) for (const progress of [0, .25, .5, .75, 1]) {
      const pose = segment.sample(progress), move = segment.stage === "TURN" ? moves[segment.index] : undefined;
      expect(hasMeasuredSupport(pose, pose.contacts, move, pose.angle)).toBe(true);
      for (const contact of pose.contacts)
        expect(measureContact(pose[contact.side], contact, move, pose.angle).valid).toBe(true);
    }
  });
  it("keeps physical turn boundaries and deterministic reverse seeking across families", () => {
    const blocks = [compileFingerProgram(parseAlgorithm("R U R'")), compileDirectFingerProgram(parseAlgorithm("F D2'"))];
    const result = assembleFingerPrograms(blocks, 5, true);
    expect(result.steps).toHaveLength(5);
    for (const [index, step] of result.steps.entries()) {
      expect(step.duration).toBeGreaterThan(0);
      expect(result.sample(step.start + 1e-9).index).toBe(index);
    }
    const times = [0, .25, 2, 4.8, 1.1];
    const poses = times.map((at) => result.sample(at));
    for (const [i, at] of times.entries()) {
      expect(sameHandPose(result.sample(at).left, poses[i].left)).toBe(true);
      expect(sameHandPose(result.sample(at).right, poses[i].right)).toBe(true);
    }
    expect(result.sample(5).complete).toBe(true);
  });
});
