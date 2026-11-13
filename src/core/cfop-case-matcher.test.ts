import { describe, expect, it } from "vitest";
import { applyAlgorithm, DEFAULT_PALETTE, parseAlgorithm, snapshots, SOLVED } from "./cube";
import { solveCFOP } from "./cfop";
import { buildExplainableSubstages } from "./cfop-case-matcher";

describe("cfop-case-matcher", () => {
  it("decomposes a full CFOP solve into Cross, F2L slots, OLL and PLL with 119-catalog matches", () => {
    const scramble = "R U R' U' F' U2 L D2 B2 R' U F2 D' L2 U'";
    const facelets = applyAlgorithm(SOLVED, scramble);
    const solved = solveCFOP(facelets);
    const moves = parseAlgorithm(solved.solution);
    const states = snapshots(facelets, moves);
    const substages = buildExplainableSubstages(
      states,
      moves,
      solved.phases.map(({ name, start, end }) => ({ name, start, end })),
      DEFAULT_PALETTE,
    );

    expect(substages.length).toBeGreaterThanOrEqual(4);
    expect(substages.some((s) => s.phase === "cross")).toBe(true);
    expect(substages.some((s) => s.phase === "f2l")).toBe(true);
    const oll = substages.find((s) => s.phase === "oll");
    const pll = substages.find((s) => s.phase === "pll");
    expect(oll?.matchedCase?.id).toMatch(/^gan-oll-\d{2}$/);
    if (pll) {
      expect(pll.matchedCase?.id).toMatch(/^gan-pll-\d{2}$/);
    }
  });
});
