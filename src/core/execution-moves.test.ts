import { describe, expect, it } from "vitest";
import {
  applyAlgorithm,
  applyMove,
  FACES,
  moveAffects,
  moveAngle,
  NORMALS,
  parseAlgorithm,
  parseMove,
  snapshots,
  SOLVED,
  type Move,
} from "./cube";
import { expandExecutionMoves } from "./execution-moves";

const labelled = Array.from({ length: 54 }, (_, i) =>
  String.fromCharCode(0x100 + i),
).join("");
const variants = [
  ["M", "x' R L'"],
  ["M'", "x R' L"],
  ["M2", "x' x' R2 L2'"],
  ["M2'", "x x R2' L2"],
  ["Rw", "x L"],
  ["Rw'", "x' L'"],
  ["Rw2", "x x L2"],
  ["Rw2'", "x' x' L2'"],
  ["Lw", "x' R"],
  ["Lw'", "x R'"],
  ["Lw2", "x' x' R2"],
  ["Lw2'", "x x R2'"],
  ["x", "x"],
  ["x'", "x'"],
  ["x2", "x x"],
  ["x2'", "x' x'"],
] as const;
const orientations = [labelled],
  seen = new Set(orientations);
for (let i = 0; i < orientations.length; i++)
  for (const token of ["x", "y", "z"]) {
    const next = applyMove(orientations[i], token);
    if (!seen.has(next)) {
      seen.add(next);
      orientations.push(next);
    }
  }
const states = [
  ...orientations,
  SOLVED,
  applyAlgorithm(SOLVED, "R U2 F' L D B2 R' F2 U L2 D' B"),
];
const asText = (moves: readonly Move[]) =>
  moves.map((move) => move.notation).join(" ");
const xDegrees = (moves: readonly Move[]) =>
  [-1, 0, 1].map((layer) =>
    moves.reduce(
      (sum, move) =>
        sum +
        (moveAffects(move, [layer, 0, 0])
          ? (moveAngle(move) * NORMALS[move.face][0] * 180) / Math.PI
          : 0),
      0,
    ),
  );

describe("explicit execution moves", () => {
  it("has one zero boundary for an empty source", () => {
    expect(expandExecutionMoves([])).toEqual({
      moves: [],
      boundaries: [0],
      sourceIndices: [],
    });
  });

  it("preserves every outer move, including reverse halves, without merging source steps", () => {
    const source = FACES.flatMap((face) =>
      ["", "'", "2", "2'"].map((suffix) => parseMove(face + suffix)),
    );
    source.forEach(Object.freeze);
    Object.freeze(source);
    const result = expandExecutionMoves(source);
    expect(result.moves).toEqual(source);
    result.moves.forEach((move, i) => expect(move).toBe(source[i]));
    expect(result.boundaries).toEqual(
      Array.from({ length: source.length + 1 }, (_, i) => i),
    );
    expect(result.sourceIndices).toEqual(
      Array.from({ length: source.length }, (_, i) => i),
    );
    expect(
      asText(expandExecutionMoves(parseAlgorithm("R R' U2 U2'")).moves),
    ).toBe("R R' U2 U2'");
  });

  it.each(variants)(
    "%s keeps all 54 sticker identities and signed layer rotation",
    (source, expected) => {
      expect(orientations).toHaveLength(24);
      const original = parseMove(source),
        result = expandExecutionMoves([original]);
      expect(asText(result.moves)).toBe(expected);
      expect(result.boundaries).toEqual([0, result.moves.length]);
      expect(result.sourceIndices).toEqual(result.moves.map(() => 0));
      for (const state of states)
        expect(applyAlgorithm(state, result.moves)).toBe(
          applyMove(state, original),
        );
      expect(xDegrees(result.moves)).toEqual(xDegrees([original]));
      expect(
        result.moves.every(
          (move) =>
            !move.kind ||
            (move.kind === "rotation" && move.face === "R" && move.turns !== 2),
        ),
      ).toBe(true);
    },
  );

  it("preserves lowercase wide aliases and Unicode reverse-half notation", () => {
    for (const [alias, canonical] of [
      ["r", "Rw"],
      ["l", "Lw"],
    ])
      for (const suffix of ["", "'", "2", "2'"]) {
        expect(expandExecutionMoves([parseMove(alias + suffix)])).toEqual(
          expandExecutionMoves([parseMove(canonical + suffix)]),
        );
      }
    expect(
      asText(expandExecutionMoves(parseAlgorithm("M2′ r2’ l′ x2′")).moves),
    ).toBe("x x R2' L2 x' x' L2' x R' x' x'");
  });

  it("maps every mixed source boundary to its exact real state without rewriting the source", () => {
    const source = parseAlgorithm("M U Rw2' x2 Lw' F2'");
    source.forEach((move) => {
      if (move.layers) Object.freeze(move.layers);
      Object.freeze(move);
    });
    Object.freeze(source);
    const before = JSON.stringify(source),
      result = expandExecutionMoves(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.boundaries).toEqual([0, 3, 4, 7, 9, 11, 12]);
    expect(result.sourceIndices).toEqual([0, 0, 0, 1, 2, 2, 2, 3, 3, 4, 4, 5]);
    const sourceStates = snapshots(labelled, source),
      actualStates = snapshots(labelled, result.moves);
    sourceStates.forEach((state, i) =>
      expect(actualStates[result.boundaries[i]]).toBe(state),
    );
    // A source phase [1, 4) maps to actual steps [3, 9), including an empty boundary.
    expect([result.boundaries[1], result.boundaries[4]]).toEqual([3, 9]);
    expect([result.boundaries[1], result.boundaries[1]]).toEqual([3, 3]);
    expect(actualStates[1]).not.toBe(sourceStates[1]);
    expect(actualStates[2]).not.toBe(sourceStates[1]);
  });

  it("keeps contextual moves in the same 54-slot frame after expanded rotations", () => {
    for (const algorithm of [
      "M2 U M2 U2 M2 U M2",
      "Rw U Rw' U' F R U R' F'",
      "Lw' U' Lw U B L' U L B'",
      "x R U R' U' x' F U2' F'",
      "R U M U' Rw2' F Lw' D x2 B2' M2' x'",
    ]) {
      const source = parseAlgorithm(algorithm),
        result = expandExecutionMoves(source);
      const original = snapshots(labelled, source),
        actual = snapshots(labelled, result.moves);
      original.forEach((state, i) =>
        expect(actual[result.boundaries[i]]).toBe(state),
      );
    }
  });

  it("does not mistake state-equivalent halves for the requested physical direction", () => {
    const source = parseAlgorithm("M2"),
      wrongDirection = parseAlgorithm("x2 R2 L2");
    expect(applyAlgorithm(labelled, source)).toBe(
      applyAlgorithm(labelled, wrongDirection),
    );
    expect(xDegrees(source)).toEqual([0, 180, 0]);
    expect(xDegrees(wrongDirection)).toEqual([0, -180, -360]);
    expect(xDegrees(expandExecutionMoves(source).moves)).toEqual(
      xDegrees(source),
    );
    expect(asText(expandExecutionMoves(parseAlgorithm("x x'")).moves)).toBe(
      "x x'",
    );
  });

  it("rejects uncalibrated axes, wide/slice paths and mismatched layer selectors explicitly", () => {
    for (const symbol of [
      "E",
      "S",
      "y",
      "z",
      "Uw",
      "Fw",
      "Dw",
      "Bw",
      "u",
      "f",
      "d",
      "b",
    ]) {
      for (const suffix of ["", "'", "2", "2'"]) {
        expect(() =>
          expandExecutionMoves([parseMove(symbol + suffix)]),
        ).toThrow(/尚未校准/);
      }
    }
    expect(() =>
      expandExecutionMoves([{ ...parseMove("M"), layers: [1] }]),
    ).toThrow(/尚未校准/);
    expect(() =>
      expandExecutionMoves([{ ...parseMove("R"), layers: [0] }]),
    ).toThrow(/尚未校准/);
    expect(() =>
      expandExecutionMoves([{ ...parseMove("x"), layers: undefined }]),
    ).toThrow(/尚未校准/);
  });
});
