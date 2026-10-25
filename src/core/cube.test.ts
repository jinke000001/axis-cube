import { describe, it, expect } from "vitest";
import Cube from "cubejs";
import {
  FACES,
  SOLVED,
  applyAlgorithm,
  applyMove,
  validateFacelets,
  normalizeColors,
  randomScramble,
  rotateFace,
} from "./cube";
describe("independent geometric cube state", () => {
  it("matches the solver model for every face and turn from scrambled inputs", () => {
    for (let i = 0; i < 30; i++) {
      const scramble = randomScramble();
      const ours = applyAlgorithm(SOLVED, scramble),
        theirs = new Cube().move(scramble).asString();
      expect(ours).toBe(theirs);
      for (const f of FACES)
        for (const suffix of ["", "'", "2"])
          expect(applyMove(ours, f + suffix)).toBe(
            Cube.fromString(theirs)
              .move(f + suffix)
              .asString(),
          );
      expect(validateFacelets(ours).valid).toBe(true);
    }
  });
  it("preserves state through inverse moves and four face rotations", () => {
    for (const f of FACES) {
      expect(applyAlgorithm(SOLVED, [f, f, f, f].join(" "))).toBe(SOLVED);
      const s = applyAlgorithm(SOLVED, randomScramble());
      expect(
        rotateFace(rotateFace(rotateFace(rotateFace(s, f), f), f), f),
      ).toBe(s);
    }
  });
  it("rejects impossible twists, flips and parity even when colour counts are correct", () => {
    const twist = SOLVED.split("");
    [twist[8], twist[9], twist[20]] = [twist[20], twist[8], twist[9]];
    expect(validateFacelets(twist.join("")).valid).toBe(false);
    const flip = SOLVED.split("");
    [flip[5], flip[10]] = [flip[10], flip[5]];
    expect(validateFacelets(flip.join("")).valid).toBe(false);
    const parity = SOLVED.split("");
    [parity[10], parity[19]] = [parity[19], parity[10]];
    expect(validateFacelets(parity.join("")).valid).toBe(false);
  });
  it("normalizes custom center color mapping without assuming a color scheme", () => {
    const map = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
    const s = applyAlgorithm(SOLVED, randomScramble());
    const raw = [...s].map((c) => map[c as keyof typeof map]).join("");
    expect(normalizeColors(raw).facelets).toBe(s);
  });
  it("solves unrelated legal states and verifies results through independent permutations", () => {
    Cube.initSolver();
    for (let i = 0; i < 5; i++) {
      const state = Cube.random().asString();
      expect(validateFacelets(state).valid).toBe(true);
      const solution = Cube.fromString(state).solve();
      expect(applyAlgorithm(state, solution)).toBe(SOLVED);
    }
  }, 30000);
});
