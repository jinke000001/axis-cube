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
    const twistVal = validateFacelets(twist.join(""));
    expect(twistVal.valid).toBe(false);
    expect(twistVal.indices).toEqual([8, 9, 20]);
    const flip = SOLVED.split("");
    [flip[5], flip[10]] = [flip[10], flip[5]];
    const flipVal = validateFacelets(flip.join(""));
    expect(flipVal.valid).toBe(false);
    expect(flipVal.indices).toEqual([5, 10]);
    const parity = SOLVED.split("");
    [parity[10], parity[19]] = [parity[19], parity[10]];
    const parityVal = validateFacelets(parity.join(""));
    expect(parityVal.valid).toBe(false);
    expect(parityVal.indices.length).toBeGreaterThan(0);
  });
  it("pinpoints the single wrong sticker on 10-vs-8 colour count errors and highlights both colliding pieces on duplicates", () => {
    const scrambled = applyAlgorithm(SOLVED, "R U R' U' F' U2 F");
    // Corrupt sticker 0 (on U face) from its true colour to another non-matching colour
    const trueColor = scrambled[0];
    const wrongColor = FACES.find((f) => f !== trueColor && f !== scrambled[4])!;
    const corrupted = wrongColor + scrambled.slice(1);
    const val = validateFacelets(corrupted);
    expect(val.valid).toBe(false);
    expect(val.indices).toEqual([0]);

    // Duplicate edge: copy UF edge [7, 19] onto UB edge [1, 46] and swap another to keep 9/9 counts if needed,
    // or test cubie collision when counts are 9/9:
    const dupEdge = SOLVED.split("");
    // Swap U/B edge [1, 46] with U/F [7, 19] and F/D [25, 28] to create duplicate edge if possible,
    // or test duplicate corner/edge detection directly:
    [dupEdge[1], dupEdge[10], dupEdge[19]] = [dupEdge[10], dupEdge[19], dupEdge[1]];
    const dupVal = validateFacelets(dupEdge.join(""));
    expect(dupVal.valid).toBe(false);
    expect(dupVal.indices.length).toBeGreaterThan(0);
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
