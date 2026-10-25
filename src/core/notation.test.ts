import { describe, expect, it } from "vitest";
import Cube from "cubejs";
import { applyAlgorithm, applyMove, moveAngle, parseAlgorithm, parseMove, SOLVED, validateFacelets } from "./cube";

describe("finger-trick notation and independent cube permutations", () => {
  it("preserves opposite U2 execution directions without changing the final state", () => {
    expect(moveAngle(parseMove("U2"))).toBe(-Math.PI);
    expect(moveAngle(parseMove("U2'"))).toBe(Math.PI);
    expect(applyMove(SOLVED, "U2")).toBe(applyMove(SOLVED, "U2'"));
    expect(parseMove("U2′").notation).toBe("U2'");
  });
  it("matches an independently implemented cubie model for slices, wide turns and rotations", () => {
    const scramble = "R U2 F' L D B2 R' F2 U L2 D' B";
    const state = applyAlgorithm(SOLVED, scramble);
    for (const base of ["M", "E", "S", "x", "y", "z", "u", "r", "f", "d", "l", "b"])
      for (const suffix of ["", "'", "2"]) {
        const notation = base + suffix;
        expect(applyMove(state, notation), notation).toBe(Cube.fromString(state).move(notation).asString());
        if (/^[urfdlb]$/.test(base))
          expect(applyMove(state, base.toUpperCase() + "w" + suffix)).toBe(applyMove(state, notation));
      }
  });
  it("honors whole-cube, wide and slice algebra without silently renaming centers", () => {
    const state = applyAlgorithm(SOLVED, "U F R2 B D'");
    for (const [lhs, rhs] of [["x", "R M' L'"], ["y", "U E' D'"], ["z", "F S B'"], ["Rw", "R M'"], ["Lw", "L M"], ["Uw", "U E'"], ["Dw", "D E"], ["Fw", "F S"], ["Bw", "B S'"]])
      expect(applyAlgorithm(state, lhs), lhs).toBe(applyAlgorithm(state, rhs));
    expect(applyAlgorithm(state, "x y z z' y' x'")).toBe(state);
    expect(validateFacelets(applyMove(SOLVED, "x")).valid).toBe(false);
  });
  it("reads formula chunks and rejects malformed groups or unsupported symbols", () => {
    expect(parseAlgorithm("(R U R’ U’)2").map((m) => m.notation)).toEqual(["R", "U", "R'", "U'", "R", "U", "R'", "U'"]);
    for (const text of ["(R U", "R U)", "Q", "R3", "M2''", "((R)9)9)9"])
      expect(() => parseAlgorithm(text), text).toThrow();
  });
});
