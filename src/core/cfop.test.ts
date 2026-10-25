import { describe, expect, it } from "vitest";
import { CFOP_PHASES, isCFOPPhaseSolved, solveCFOP } from "./cfop";
import type { CFOPResult } from "./cfop";
import {
  applyAlgorithm,
  FACES,
  parseAlgorithm,
  SOLVED,
  validateFacelets,
} from "./cube";

// Accepted, manually corrected six-photo state, also recorded in
// evidence/real-photo-session.json. Keep the test independent of mutable demos.
const REAL_PHOTO = "LBBUURDDRDDLBRFRBDLLFRFRBLURFFLDLDBLURFULFBUUUDFDBFBUR";

// These facelet groups are the cube's physical URF/UFL/ULB/UBR corners and
// UR/UF/UL/UB edges. Last-layer coverage below constructs legal cubie states;
// it does not invert the vendor's own algorithm table to manufacture its input.
const TOP_CORNERS = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
];
const TOP_EDGES = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
];
const CROSS = [28, 30, 32, 34, 16, 25, 43, 52];
const F2L = [
  ...Array.from({ length: 9 }, (_, i) => i + 27),
  ...[9, 18, 36, 45].flatMap((offset) =>
    [3, 4, 5, 6, 7, 8].map((i) => i + offset),
  ),
];
const inverse = (algorithm: string) =>
  parseAlgorithm(algorithm)
    .reverse()
    .map(
      (move) =>
        move.face + (move.turns === 2 ? "2" : move.turns === 1 ? "'" : ""),
    )
    .join(" ");

function expectPlan(state: string, result: CFOPResult) {
  const moves = parseAlgorithm(result.solution);
  expect(moves.every((move) => /^[URFDLB](2|')?$/.test(move.notation))).toBe(
    true,
  );
  expect(result.crossFace).toBe("D");
  expect(result.phases.map((phase) => phase.name)).toEqual(CFOP_PHASES);
  let current = state;
  let cursor = 0;
  for (const phase of result.phases) {
    expect(phase.start).toBe(cursor);
    expect(phase.algorithm).toBe(
      moves
        .slice(phase.start, phase.end)
        .map((move) => move.notation)
        .join(" "),
    );
    for (const segment of phase.segments) {
      expect(segment.start).toBe(cursor);
      expect(segment.before).toBe(current);
      expect(segment.algorithm).toBe(
        moves
          .slice(segment.start, segment.end)
          .map((move) => move.notation)
          .join(" "),
      );
      current = applyAlgorithm(current, segment.algorithm);
      expect(segment.after).toBe(current);
      expect(applyAlgorithm(segment.before, segment.nativeAlgorithm)).toBe(
        current,
      );
      cursor = segment.end;
    }
    expect(phase.end).toBe(cursor);
    // Independently expressed physical postconditions, not the adapter's helper.
    for (const index of CROSS) expect(current[index]).toBe(SOLVED[index]);
    if (phase.name !== "cross") {
      for (const index of F2L) expect(current[index]).toBe(SOLVED[index]);
    }
    if (phase.name === "oll" || phase.name === "pll")
      expect(current.slice(0, 9)).toBe("U".repeat(9));
  }
  expect(cursor).toBe(moves.length);
  expect(current).toBe(SOLVED);
}

function seededScrambles(count: number) {
  let seed = 0xc0ffee;
  const next = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
  return Array.from({ length: count }, () => {
    let previous = -1;
    return Array.from({ length: 25 }, () => {
      let face: number;
      do {
        face = Math.floor(next() * 6);
      } while (face === previous);
      previous = face;
      return FACES[face] + ["", "'", "2"][Math.floor(next() * 3)];
    }).join(" ");
  });
}

function permutations(values: number[]): number[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, i) =>
    permutations(values.filter((_, j) => i !== j)).map((tail) => [
      value,
      ...tail,
    ]),
  );
}
function parity(values: number[]) {
  return (
    values.reduce(
      (sum, value, i) =>
        sum + values.slice(i + 1).filter((other) => other < value).length,
      0,
    ) % 2
  );
}

describe("true CFOP solver", () => {
  it("returns four empty verified stages for a solved cube", () => {
    const result = solveCFOP(SOLVED);
    expect(result.solution).toBe("");
    expect(
      result.phases.every((phase) => phase.start === 0 && phase.end === 0),
    ).toBe(true);
    expectPlan(SOLVED, result);
  });

  it("solves the accepted real-photo facelets with real cross, pair and LL boundaries", () => {
    const result = solveCFOP(REAL_PHOTO);
    expectPlan(REAL_PHOTO, result);
    expect(result.phases.every((phase) => phase.end > phase.start)).toBe(true);
    expect(new Set(result.phases[0].segments.flatMap(segment => segment.targets)).size).toBe(4);
    expect(new Set(result.phases[1].segments.flatMap(segment => segment.targets)).size).toBe(8);
    expect(
      result.phases[0].segments.every(
        (segment) =>
          segment.targets.every(target => target.length === 2 && target.includes("D")),
      ),
    ).toBe(true);
    expect(
      result.phases[1].segments.every(
        (segment) =>
          segment.targets.filter(piece => piece.length === 3).length ===
          segment.targets.filter(piece => piece.length === 2).length,
      ),
    ).toBe(true);
    expect(result.candidateCount).toBe(4);
    expect(result.score).toBe(
      Math.min(...result.candidates.map((candidate) => candidate.moveCount)),
    );
  });

  it("removes cancelling pair seams without inventing intermediate solved states", () => {
    const result = solveCFOP(REAL_PHOTO);
    expectPlan(REAL_PHOTO, result);
    for (const phase of result.phases) {
      const moves = parseAlgorithm(phase.algorithm);
      for (let i = 1; i < moves.length; i++) expect(moves[i].face).not.toBe(moves[i-1].face);
    }
    // At least one original partition boundary was absorbed. Its targets are
    // still recorded at a real state, and nativeAlgorithm reaches that state.
    expect(result.phases.some(phase => phase.segments.some(segment => segment.caseId.includes(" / ")))).toBe(true);
  });

  it("recognizes already finished phases rather than assigning proportional labels", () => {
    const fixtures = [
      { algorithm: "R U R' U'", phase: "f2l" },
      { algorithm: "R U R' U R U2 R'", phase: "oll" },
      { algorithm: "R U R' U' R' F R2 U' R' U' R U R' F'", phase: "pll" },
    ];
    for (const fixture of fixtures) {
      const state = applyAlgorithm(SOLVED, inverse(fixture.algorithm));
      const result = solveCFOP(state);
      expectPlan(state, result);
      const active = CFOP_PHASES.indexOf(
        fixture.phase as (typeof CFOP_PHASES)[number],
      );
      expect(result.phases[active].end).toBeGreaterThan(
        result.phases[active].start,
      );
      expect(
        result.phases
          .slice(0, active)
          .every((phase) => phase.start === phase.end),
      ).toBe(true);
    }
  });

  it("validates each stage on 128 deterministic legal 25-move scrambles", () => {
    for (const scramble of seededScrambles(128)) {
      const state = applyAlgorithm(SOLVED, scramble);
      expect(validateFacelets(state).valid, scramble).toBe(true);
      expectPlan(state, solveCFOP(state));
    }
  }, 30000);

  it("covers all 216 legal last-layer corner/edge orientation assignments", () => {
    let cases = 0;
    for (let cornerCode = 0; cornerCode < 27; cornerCode++) {
      const turns = [
        cornerCode % 3,
        Math.floor(cornerCode / 3) % 3,
        Math.floor(cornerCode / 9),
      ];
      turns.push((3 - (turns.reduce((sum, turn) => sum + turn, 0) % 3)) % 3);
      for (let edgeCode = 0; edgeCode < 8; edgeCode++) {
        const flips = [edgeCode & 1, (edgeCode >> 1) & 1, (edgeCode >> 2) & 1];
        flips.push(flips.reduce((sum, flip) => sum + flip, 0) % 2);
        const stickers = SOLVED.split("");
        TOP_CORNERS.forEach((slots, piece) =>
          slots.forEach(
            (slot, i) =>
              (stickers[slot] = SOLVED[slots[(i + turns[piece]) % 3]]),
          ),
        );
        TOP_EDGES.forEach((slots, piece) =>
          slots.forEach(
            (slot, i) =>
              (stickers[slot] = SOLVED[slots[(i + flips[piece]) % 2]]),
          ),
        );
        const state = stickers.join("");
        expect(
          validateFacelets(state).valid,
          `OLL ${cornerCode}/${edgeCode}`,
        ).toBe(true);
        const result = solveCFOP(state);
        expect(result.phases[1].end).toBe(0);
        expectPlan(state, result);
        cases++;
      }
    }
    expect(cases).toBe(216);
  }, 30000);

  it("covers all 288 parity-valid last-layer permutations, including AUF and skips", () => {
    let cases = 0;
    const permutations4 = permutations([0, 1, 2, 3]);
    for (const corners of permutations4) {
      for (const edges of permutations4) {
        if (parity(corners) !== parity(edges)) continue;
        const stickers = SOLVED.split("");
        TOP_CORNERS.forEach((slots, piece) =>
          slots.forEach(
            (slot, i) =>
              (stickers[slot] = SOLVED[TOP_CORNERS[corners[piece]][i]]),
          ),
        );
        TOP_EDGES.forEach((slots, piece) =>
          slots.forEach(
            (slot, i) => (stickers[slot] = SOLVED[TOP_EDGES[edges[piece]][i]]),
          ),
        );
        const state = stickers.join("");
        expect(validateFacelets(state).valid, `PLL ${corners}/${edges}`).toBe(
          true,
        );
        const result = solveCFOP(state);
        expect(result.phases[2].end).toBe(0);
        expectPlan(state, result);
        cases++;
      }
    }
    expect(cases).toBe(288);
  }, 30000);

  it("lets gesture cost choose a different verified candidate while preserving determinism", () => {
    const alternatives: string[] = [];
    const ordinary = solveCFOP(REAL_PHOTO, {
      gestureCost: (algorithm) => {
        alternatives.push(algorithm);
        return parseAlgorithm(algorithm).length;
      },
    });
    // The four coordinate choices also inspect equal-state half-turn directions.
    const coordinateAlternatives = [...new Set(alternatives.map((algorithm) => algorithm.replaceAll("2'", "2")))];
    expect(coordinateAlternatives).toHaveLength(4);
    const preferred = coordinateAlternatives.find(
      (algorithm) => algorithm !== ordinary.solution,
    )!;
    expect(preferred).toBeTruthy();
    const options = {
      gestureCost: (algorithm: string) => (algorithm === preferred ? 0 : 1000),
    };
    const selected = solveCFOP(REAL_PHOTO, options);
    expect(selected.solution).toBe(preferred);
    expect(selected.score).toBe(0);
    expect(selected.selectedFrame).not.toBe(ordinary.selectedFrame);
    expectPlan(REAL_PHOTO, selected);
    expect(solveCFOP(REAL_PHOTO, options)).toEqual(selected);
    expect(solveCFOP(REAL_PHOTO)).toEqual(ordinary);
  });

  it("rejects illegal input and non-finite or negative gesture scores", () => {
    expect(() => solveCFOP(SOLVED.slice(1))).toThrow();
    const singleFlip = SOLVED.split("");
    [singleFlip[5], singleFlip[10]] = [singleFlip[10], singleFlip[5]];
    expect(() => solveCFOP(singleFlip.join(""))).toThrow();
    for (const score of [Number.NaN, Infinity, -1]) {
      expect(() => solveCFOP(SOLVED, { gestureCost: () => score })).toThrow(
        "成本",
      );
    }
  });

  it("does not confuse completed cross, F2L, orientation and permutation invariants", () => {
    const pair = applyAlgorithm(SOLVED, "R U R' U'");
    const sune = applyAlgorithm(SOLVED, "R U R' U R U2 R'");
    const auf = applyAlgorithm(SOLVED, "U");
    expect(isCFOPPhaseSolved(pair, "cross")).toBe(true);
    expect(isCFOPPhaseSolved(pair, "f2l")).toBe(false);
    expect(isCFOPPhaseSolved(sune, "f2l")).toBe(true);
    expect(isCFOPPhaseSolved(sune, "oll")).toBe(false);
    expect(isCFOPPhaseSolved(auf, "oll")).toBe(true);
    expect(isCFOPPhaseSolved(auf, "pll")).toBe(false);
    expect(isCFOPPhaseSolved("", "cross")).toBe(false);
    expect(CFOP_PHASES.every((phase) => isCFOPPhaseSolved(SOLVED, phase))).toBe(
      true,
    );
  });
});
