import { describe, expect, it } from "vitest";
import { applyAlgorithm, parseAlgorithm, snapshots, SOLVED } from "./cube";
import { CFOP_PHASES, isCFOPPhaseSolved } from "./cfop-state";
import { solveCompetitiveCFOP } from "./competitive-cfop";

describe("competitive CFOP stage selection", () => {
  it("solves diverse legal inputs with real independently verifiable stage boundaries", () => {
    const scrambles = ["", "R", "R U R' U'", "R U2 F' L D B2 R' F2 U L2 D' B R2 U' F",
      "B2 L2 D F' L2 U F2 R2 B U2 L' U2 B D R' D' B2 U F2"];
    for (const scramble of scrambles) {
      const state = applyAlgorithm(SOLVED, scramble), result = solveCompetitiveCFOP(state);
      const moves = parseAlgorithm(result.solution), states = snapshots(state, moves);
      expect(states.at(-1)).toBe(SOLVED);
      expect(result.phases.map((phase) => phase.name)).toEqual(CFOP_PHASES);
      let boundary = 0;
      for (const phase of result.phases) {
        expect(phase.start).toBe(boundary);
        expect(isCFOPPhaseSolved(states[phase.end], phase.name)).toBe(true);
        for (const segment of phase.segments) {
          expect(states[segment.start]).toBe(segment.before);
          expect(states[segment.end]).toBe(segment.after);
          expect(applyAlgorithm(segment.before, segment.algorithm)).toBe(segment.after);
        }
        boundary = phase.end;
      }
      expect(boundary).toBe(moves.length);
      expect(result.search.frames).toHaveLength(4);
      expect(result.search.expanded).toBeGreaterThanOrEqual(16);
    }
  });
  it("uses the supplied gesture objective and rejects invalid costs", () => {
    const state = applyAlgorithm(SOLVED, "R2 U2 F2 L2 B2 D2 R2 U F' L");
    const result = solveCompetitiveCFOP(state, { gestureCost: (algorithm) => parseAlgorithm(algorithm).reduce((sum, move) =>
      sum + (move.face === "B" ? 20 : move.direction === -1 ? .9 : 1), 0) });
    expect(applyAlgorithm(state, result.solution)).toBe(SOLVED);
    expect(parseAlgorithm(result.solution).some((move) => move.direction === -1)).toBe(true);
    expect(() => solveCompetitiveCFOP(state, { gestureCost: () => Infinity })).toThrow("成本");
  });
});
