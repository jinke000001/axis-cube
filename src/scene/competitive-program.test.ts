import { describe, expect, it } from "vitest";
import { applyAlgorithm, parseAlgorithm, snapshots, SOLVED } from "../core/cube";
import { compileCompetitiveExecution, competitivePhraseCost, planCompetitiveExecution } from "./competitive-program";
import { sameHandPose } from "./finger-program-assembly";
import { hasMeasuredSupport, measureContact } from "./finger-contact";
import { retimeFingerProgram } from "./finger-cadence";

describe("five-finger competitive execution", () => {
  it.each([
    "y F D' L D R D F D2' F' y D R' D' F D U' L' U L U' L' U' L U2' L U L' U' L U L' R U R' U R U' R' U' R' U R L F' L' U' L F L' F' U F R2 U R U R' y U' F' U' F' U F' y",
    "D2 F D2 U2 F2' D2 R' D2' R F' U F U R' U R U' L U2' L' U' L U L' U2 R U R' U2 L' U L U2 L' U L L U F U' F' L' F R U R' U' F' B L' B R2 B' L B R2 B2",
  ])("keeps the final step open until the exact deadline: %s", (algorithm) => {
    const source = compileCompetitiveExecution(parseAlgorithm(algorithm));
    const last = source.segments.at(-1)!;
    expect(last.start + last.duration).toBe(source.duration);
    const program = retimeFingerProgram(source);
    for (const at of [5 - 1e-10, 5 - Number.EPSILON * 4]) {
      expect(program.sample(at).index).toBe(program.steps.length - 1);
      expect(program.sample(at).complete).toBe(false);
    }
    expect(program.sample(5).index).toBe(program.steps.length);
    expect(program.sample(5).complete).toBe(true);
  });
  it("uses all five drive fingers in one continuous and independently supported phrase", () => {
    const moves = parseAlgorithm("F' D2 U2 R U R' F");
    const program = compileCompetitiveExecution(moves);
    expect(program.steps.map(step => step.move.notation)).toEqual(moves.map(move => move.notation));
    expect(new Set(program.segments.filter(segment => segment.stage === "TURN").map(segment => segment.finger).filter(Boolean))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(program.cost).toBeCloseTo(competitivePhraseCost(moves), 8);
    for (const segment of program.segments) for (const p of [0, .125, .5, .875, 1]) {
      const frame = segment.sample(p), move = segment.stage === "TURN" ? program.steps[segment.index].move : undefined;
      expect(hasMeasuredSupport(frame, frame.contacts, move, frame.angle)).toBe(true);
      for (const contact of frame.contacts)
        expect(measureContact(frame[contact.side], contact, move, frame.angle).valid).toBe(true);
    }
    for (let i = 1; i < program.segments.length; i++) {
      const a = program.segments[i - 1].sample(1), b = program.segments[i].sample(0);
      expect(sameHandPose(a.left,b.left)).toBe(true);
      expect(sameHandPose(a.right,b.right)).toBe(true);
    }
  });
  it("compiles all outer turns, meaningful y rotations, and completes the original cube state", () => {
    const moves = parseAlgorithm("U U' U2 U2' R R' R2 R2' L L' L2 L2' F F' F2 F2' B B' B2 B2' D D' D2 D2' y y'");
    const program = compileCompetitiveExecution(moves);
    expect(program.steps).toHaveLength(moves.length);
    expect(program.sample(5).complete).toBe(true);
    expect(program.sample(5).index).toBe(moves.length);
    const expected = snapshots(SOLVED,moves), actual = snapshots(SOLVED,program.steps.map(step=>step.move));
    expect(actual).toEqual(expected);
  });
  it("plans only beneficial physical changes and accounts for restoring the original orientation", () => {
    const source = parseAlgorithm("B U B' U B U2 B' L U L' U L U2 L'");
    const plan = planCompetitiveExecution(source);
    const program = compileCompetitiveExecution(plan.moves);
    expect(plan.cost).toBeLessThanOrEqual(plan.fixedCost + 1e-8);
    expect(plan.rotationCount).toBe(2);
    expect(program.cost).toBeCloseTo(plan.cost, 7);
    expect(applyAlgorithm(SOLVED,plan.moves.map(move=>move.notation).join(" "))).toBe(applyAlgorithm(SOLVED,source.map(move=>move.notation).join(" ")));
    expect(program.sample(5).complete).toBe(true);
  });
});
