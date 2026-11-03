import { describe, expect, it } from "vitest";
import { COLOR_NAMES, FACES, SOLVED, SLOTS, applyAlgorithm, applyMove, normalizeColors, parseAlgorithm, validateFacelets } from "../core/cube";
import type { Face } from "../core/cube";
import { LESSONS, getLesson } from "./curriculum";

const CASES = LESSONS.flatMap((lesson) => lesson.cases);
const byId = (id: string) => {
  const value = CASES.find((item) => item.id === id);
  if (!value) throw new Error(`Missing published case: ${id}`);
  return value;
};
const start = (id: string) => applyAlgorithm(SOLVED, byId(id).setup);
const finish = (id: string) => applyAlgorithm(start(id), byId(id).algorithm);
const center = (state: string, face: Face) => state[FACES.indexOf(face) * 9 + 4];
const nonzero = (p: readonly number[]) => p.filter(Boolean).length;
const at = (position: readonly number[]) => SLOTS.filter((slot) => slot.position.join() === position.join());
const sticker = (state: string, face: Face, position: readonly number[]) => state[at(position).find((slot) => slot.face === face)!.index];
const colorsAt = (state: string, position: readonly number[]) => at(position).map((slot) => state[slot.index]).sort().join("");
const isHome = (state: string, position: readonly number[]) => at(position).every((slot) => state[slot.index] === center(state, slot.face));
const solvedWhere = (state: string, predicate: (p: readonly number[]) => boolean) => SLOTS.filter((slot) => predicate(slot.position)).every((slot) => state[slot.index] === center(state, slot.face));
const preserved = (before: string, after: string, predicate: (p: readonly number[]) => boolean) => SLOTS.filter((slot) => predicate(slot.position)).every((slot) => before[slot.index] === after[slot.index]);
const crossSolved = (s: string) => solvedWhere(s, (p) => p[1] === -1 && nonzero(p) === 2);
const firstLayerSolved = (s: string) => solvedWhere(s, (p) => p[1] === -1);
const f2lSolved = (s: string) => solvedWhere(s, (p) => p[1] < 1);
const topFaceSolved = (s: string) => SLOTS.filter((slot) => slot.face === "U").every((slot) => s[slot.index] === center(s, "U"));
const topCornersSolved = (s: string) => solvedWhere(s, (p) => p[1] === 1 && nonzero(p) === 3);
const allSolved = (s: string) => solvedWhere(s, () => true);
const topYellowEdges = (s: string) => [1, 3, 5, 7].filter((i) => s[i] === center(s, "U"));
const topWhiteEdges = (s: string) => [1, 3, 5, 7].filter((i) => s[i] === "U");
const topWhitePieces = (s: string) => topWhiteEdges(s).map((i) => colorsAt(s, SLOTS[i].position));
const sideFaces: Face[] = ["F", "R", "B", "L"];
const cornerPairs = (s: string) => sideFaces.filter((face) => {
  const i = FACES.indexOf(face) * 9;
  return s[i] === s[i + 2];
});
const correctSides = (s: string) => sideFaces.filter((face) => {
  const i = FACES.indexOf(face) * 9;
  return s[i + 1] === s[i + 4];
});
const piecePositions = Array.from(new Set(SLOTS.filter((slot) => nonzero(slot.position) > 1).map((slot) => slot.position.join()))).map((p) => p.split(",").map(Number));
const topNonYellowEdges = (s: string) => piecePositions.filter((p) => p[1] === 1 && nonzero(p) === 2 && !colorsAt(s, p).includes("D"));
const WHITE_DOWN = applyAlgorithm(SOLVED, "z2");
const RIGHT = byId("corner-white-front").algorithm;
const CROSS = byId("yellow-line").algorithm;
const CORNERS = byId("corners-one-pair").algorithm;
const EDGES = byId("edges-one-cycle").algorithm;

function orbit(initial: string, generators: string[], key: (state: string) => string, limit: number): string[] {
  const states = [initial];
  const seen = new Set([key(initial)]);
  for (let i = 0; i < states.length; i++) {
    for (const algorithm of generators) {
      const state = applyAlgorithm(states[i], algorithm);
      if (!seen.has(key(state))) {
        seen.add(key(state));
        states.push(state);
        if (states.length > limit) throw new Error("Unexpected orbit size");
      }
    }
  }
  return states;
}

describe("published beginner curriculum", () => {
  it("has twelve complete, addressable lessons with unique case ids and valid segment boundaries", () => {
    expect(LESSONS.map((lesson) => lesson.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(12);
    expect(new Set(CASES.map((item) => item.id)).size).toBe(CASES.length);
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    expect(getLesson("not-a-lesson")).toBeUndefined();
    for (const lesson of LESSONS) {
      expect(getLesson(lesson.id)).toBe(lesson);
      expect(lesson.goal.length).toBeGreaterThan(10);
      expect(lesson.prepare.length).toBeGreaterThan(0);
      expect(lesson.checklist.length).toBeGreaterThan(0);
      expect(lesson.pitfalls.length).toBeGreaterThan(0);
      for (const item of lesson.cases) {
        const count = parseAlgorithm(item.algorithm).length;
        expect(count, item.id).toBeGreaterThan(0);
        expect(item.steps.at(-1)?.end, item.id).toBe(count);
        let previous = 0;
        for (const step of item.steps) {
          expect(step.end, item.id).toBeGreaterThan(previous);
          expect(step.end, item.id).toBeLessThanOrEqual(count);
          previous = step.end;
        }
        expect(item.when.length, item.id).toBeGreaterThan(10);
        expect(item.explanation.length, item.id).toBeGreaterThanOrEqual(2);
        expect(item.check.length, item.id).toBeGreaterThan(10);
      }
    }
  });

  it.each(CASES.map((item) => [item.id, item] as const))("%s has a legal start and every displayed intermediate state is legal", (_id, item) => {
    let state = applyAlgorithm(SOLVED, item.setup);
    expect(validateFacelets(normalizeColors(state).facelets).valid).toBe(true);
    for (const move of parseAlgorithm(item.algorithm)) {
      state = applyMove(state, move);
      expect(validateFacelets(normalizeColors(state).facelets).valid, move.notation).toBe(true);
    }
  });

  it("does not disguise every lesson as an inverse algorithm ending in a solved cube", () => {
    const partial = CASES.filter((item) => !allSolved(finish(item.id)));
    expect(partial.length).toBeGreaterThan(CASES.length * 0.7);
  });

  // Independent geometric start/destination expectations: these are positions,
  // whereas the published focusPieces values must remain fixed colour ids.
  const focusPaths: [string, number[][], number[][]][] = [
    ["daisy-bottom", [[0, -1, 1]], [[0, 1, 1]]],
    ["daisy-middle-front", [[1, 0, 1]], [[1, 1, 0]]],
    ["daisy-middle-right", [[1, 0, 1]], [[0, 1, 1]]],
    ["daisy-bottom-side", [[0, -1, 1]], [[1, 1, 0]]],
    ["daisy-top-side", [[0, 1, 1]], [[1, 1, 0]]],
    ["daisy-make-room", [[1, 0, 1]], [[1, 1, 0]]],
    ["cross-aligned", [[0, 1, 1]], [[0, -1, 1]]],
    ["cross-align-first", [[-1, 1, 0]], [[0, -1, 1]]],
    ["corner-white-front", [[1, 1, 1]], [[1, -1, 1]]],
    ["corner-white-up", [[1, 1, 1]], [[1, -1, 1]]],
    ["corner-white-right", [[1, 1, 1]], [[1, -1, 1]]],
    ["corner-take-out", [[1, -1, 1]], [[1, 1, 1]]],
    ["middle-insert-right", [[0, 1, 1]], [[1, 0, 1]]],
    ["middle-insert-left", [[0, 1, 1]], [[-1, 0, 1]]],
    ["middle-take-out", [[1, 0, 1]], [[0, 1, -1]]],
    ["independent-start", [[1, 0, 1]], [[1, 1, 0]]],
    ["f2l-ready-pair", [[1, 1, 1], [1, 1, 0]], [[1, -1, 1], [1, 0, 1]]],
    ["f2l-separated", [[1, 1, 1], [0, 1, -1]], [[1, -1, 1], [1, 0, 1]]],
    ["f2l-white-up", [[1, 1, 1], [1, 1, 0]], [[1, -1, 1], [1, 0, 1]]],
  ];
  it.each(focusPaths)("%s highlights the actual target piece(s), which remain uniquely trackable through every move", (id, origins, destinations) => {
    const item = byId(id), before = start(id), after = finish(id);
    expect(item.focusPieces).toHaveLength(origins.length);
    expect(item.focusLabel?.length).toBeGreaterThan(4);
    const keys = item.focusPieces!.map((colors) => [...colors].sort().join(""));
    expect(new Set(keys).size).toBe(keys.length);
    for (const [index, colors] of item.focusPieces!.entries()) {
      expect([2, 3]).toContain(colors.length);
      expect(new Set(colors).size).toBe(colors.length);
      for (const color of colors) {
        expect(FACES).toContain(color);
        expect(item.focusLabel).toContain(COLOR_NAMES[color]);
      }
      expect(colorsAt(before, origins[index])).toBe(keys[index]);
      expect(colorsAt(after, destinations[index])).toBe(keys[index]);
    }
    let state = before;
    const assertWholePieces = () => {
      for (const key of keys) {
        const matches = piecePositions.filter((position) => colorsAt(state, position) === key);
        expect(matches, `${id}: target ${key}`).toHaveLength(1);
        expect(at(matches[0])).toHaveLength(key.length);
      }
    };
    assertWholePieces();
    for (const move of parseAlgorithm(item.algorithm)) { state = applyMove(state, move); assertWholePieces(); }
  });

  const yellowCornerCases = ["yellow-three-corners", "yellow-two-corners", "yellow-four-corners", "yellow-face-ready"];
  it.each(yellowCornerCases)("%s follows all four physical yellow corners through whole-cube rotations, never the white corners", (id) => {
    const item = byId(id);
    expect(item.focusPieces).toHaveLength(4);
    expect(item.focusLabel).toContain("四个黄色角");
    const keys = item.focusPieces!.map((colors) => [...colors].sort().join("")).sort();
    expect(new Set(keys).size).toBe(4);
    for (const colors of item.focusPieces!) {
      expect(colors).toHaveLength(3);
      expect(colors).toContain("D");
      expect(colors).not.toContain("U");
    }
    let state = start(id);
    const matchingCorners = () => piecePositions.filter((p) => keys.includes(colorsAt(state, p)));
    const assertYellowCorners = () => {
      const actual = piecePositions.filter((p) => nonzero(p) === 3 && colorsAt(state, p).includes("D"));
      expect(actual.map((p) => colorsAt(state, p)).sort()).toEqual(keys);
      expect(matchingCorners()).toHaveLength(4);
      for (const p of matchingCorners()) expect(colorsAt(state, p)).not.toContain("U");
    };
    expect(matchingCorners().every((p) => p[1] === 1)).toBe(true);
    assertYellowCorners();
    for (const [index, move] of parseAlgorithm(item.algorithm).entries()) {
      state = applyMove(state, move);
      assertYellowCorners();
      if (index === 0 && id !== "yellow-face-ready") {
        expect(move.notation).toBe("x2");
        expect(center(state, "D")).toBe("D");
        expect(matchingCorners().every((p) => p[1] === -1)).toBe(true);
      }
    }
    expect(center(state, "U")).toBe("D");
    expect(matchingCorners().every((p) => p[1] === 1)).toBe(true);
  });

  it("keeps the remaining whole-face observation cases separate from explicit physical-piece targets", () => {
    expect(CASES.filter((item) => item.focusPieces).map((item) => item.id).sort()).toEqual([...focusPaths.map(([id]) => id), ...yellowCornerCases].sort());
    for (const lesson of LESSONS.filter((item) => [7, 9, 10].includes(item.number))) {
      for (const item of lesson.cases) {
        expect(item.focusFace).toBeDefined();
        expect(item.focusPieces).toBeUndefined();
        expect(item.focusLabel).toBeUndefined();
      }
    }
  });

  it("distinguishes a monochrome face from an aligned layer and reverses notation exercises", () => {
    const falseLayer = start("face-is-not-layer");
    expect(SLOTS.filter((slot) => slot.face === "D").every((slot) => falseLayer[slot.index] === "U")).toBe(true);
    expect(firstLayerSolved(falseLayer)).toBe(false);
    expect(firstLayerSolved(finish("face-is-not-layer"))).toBe(true);
    expect(finish("six-faces")).toBe(start("six-faces"));
    expect(finish("quarter-half-rotation")).toBe(start("quarter-half-rotation"));
  });

  const daisyConditions: [string, Face, number[], string][] = [
    ["daisy-bottom", "D", [0, -1, 1], "F2"],
    ["daisy-middle-front", "F", [1, 0, 1], "R"],
    ["daisy-middle-right", "R", [1, 0, 1], "F'"],
    ["daisy-bottom-side", "F", [0, -1, 1], "F' R"],
    ["daisy-top-side", "F", [0, 1, 1], "F R"],
    ["daisy-make-room", "F", [1, 0, 1], "U R"],
  ];
  it.each(daisyConditions)("%s starts in the stated white-edge orientation and adds a petal without losing old ones", (id, face, position, algorithm) => {
    const before = start(id), after = finish(id);
    expect(sticker(before, face, position)).toBe("U");
    expect(byId(id).algorithm).toBe(algorithm);
    expect(topWhiteEdges(before).length).toBeGreaterThan(0);
    expect(topWhiteEdges(after).length).toBe(topWhiteEdges(before).length + 1);
    for (const piece of topWhitePieces(before)) expect(topWhitePieces(after)).toContain(piece);
    if (id === "daisy-make-room") {
      expect(before[5]).toBe("U");
      expect(before[1]).not.toBe("U");
    }
  });

  it("converts actual daisy petals into aligned white cross edges while leaving white corners unfinished", () => {
    for (const id of ["cross-aligned", "cross-align-first", "cross-all-four"]) expect(topWhiteEdges(start(id))).toHaveLength(4);
    for (const id of ["cross-aligned", "cross-align-first"]) {
      expect(isHome(finish(id), [0, -1, 1])).toBe(true);
      expect(topWhiteEdges(finish(id))).toHaveLength(3);
    }
    expect(sticker(start("cross-align-first"), "F", [0, 1, 1])).not.toBe(center(start("cross-align-first"), "F"));
    expect(crossSolved(finish("cross-all-four"))).toBe(true);
    expect(firstLayerSolved(finish("cross-all-four"))).toBe(false);
  });

  it.each([
    ["corner-white-front", "F"], ["corner-white-up", "U"], ["corner-white-right", "R"],
  ] as const)("%s inserts the stated corner and preserves the cross and unrelated bottom corners", (id, face) => {
    const before = start(id), after = finish(id);
    expect(crossSolved(before)).toBe(true);
    expect(sticker(before, face, [1, 1, 1])).toBe("U");
    expect(colorsAt(before, [1, 1, 1])).toBe(colorsAt(WHITE_DOWN, [1, -1, 1]));
    expect(isHome(after, [1, -1, 1])).toBe(true);
    expect(crossSolved(after)).toBe(true);
    expect(preserved(before, after, (p) => p[1] === -1 && (p[0] !== 1 || p[2] !== 1))).toBe(true);
    expect(firstLayerSolved(after)).toBe(false); // a second white corner still needs work
  });

  it("extracts a white corner that is in the wrong slot, instead of inventing an already-correct corner", () => {
    const before = start("corner-take-out"), after = finish("corner-take-out");
    expect(crossSolved(before)).toBe(true);
    expect(colorsAt(before, [1, -1, 1])).not.toBe(colorsAt(WHITE_DOWN, [1, -1, 1]));
    expect(colorsAt(after, [1, 1, 1])).toBe(colorsAt(before, [1, -1, 1]));
    expect(crossSolved(after)).toBe(true);
    expect(preserved(before, after, (p) => p[1] === -1 && (p[0] !== 1 || p[2] !== 1))).toBe(true);
  });

  it.each([["middle-insert-right", "R", 1], ["middle-insert-left", "L", -1]] as const)("%s aligns and inserts the correct edge without changing the first layer or unrelated slots", (id, face, x) => {
    const before = start(id), after = finish(id);
    expect(firstLayerSolved(before)).toBe(true);
    expect(sticker(before, "F", [0, 1, 1])).toBe(center(before, "F"));
    expect(sticker(before, "U", [0, 1, 1])).toBe(center(before, face));
    expect(isHome(after, [x, 0, 1])).toBe(true);
    expect(firstLayerSolved(after)).toBe(true);
    expect(preserved(before, after, (p) => p[1] === 0 && (p[0] !== x || p[2] !== 1))).toBe(true);
    expect(f2lSolved(after)).toBe(false); // an independent back slot remains unfinished
  });

  it("handles the no-usable-top-edge fallback with an actually flipped middle edge", () => {
    const before = start("middle-take-out"), after = finish("middle-take-out");
    expect(firstLayerSolved(before)).toBe(true);
    expect(topNonYellowEdges(before)).toHaveLength(0);
    expect(colorsAt(before, [1, 0, 1])).toBe(colorsAt(WHITE_DOWN, [1, 0, 1]));
    expect(isHome(before, [1, 0, 1])).toBe(false);
    expect(topNonYellowEdges(after)).toHaveLength(1);
    expect(topNonYellowEdges(after).map((p) => colorsAt(after, p))).toContain(colorsAt(before, [1, 0, 1]));
    expect(firstLayerSolved(after)).toBe(true);
    expect(preserved(before, after, (p) => p[1] === 0 && (p[0] !== 1 || p[2] !== 1))).toBe(true);
  });

  it.each([
    ["yellow-line", [3, 5]], ["yellow-elbow", [1, 3]], ["yellow-dot", []], ["yellow-cross-ready", [1, 3, 5, 7]],
  ] as const)("%s has the advertised edge pattern and finishes the yellow cross without damaging F2L", (id, pattern) => {
    expect(f2lSolved(start(id))).toBe(true);
    expect(topYellowEdges(start(id))).toEqual(pattern);
    expect(f2lSolved(finish(id))).toBe(true);
    expect(topYellowEdges(finish(id))).toEqual([1, 3, 5, 7]);
  });

  it.each([
    ["yellow-three-corners", 1], ["yellow-two-corners", 2], ["yellow-four-corners", 0],
  ] as const)("%s temporarily disturbs the protected layers, then restores them and orients every yellow corner", (id, orientedCorners) => {
    const before = start(id), after = finish(id);
    expect(f2lSolved(before)).toBe(true);
    expect(topYellowEdges(before)).toHaveLength(4);
    expect([0, 2, 6, 8].filter((i) => before[i] === "D")).toHaveLength(orientedCorners);
    let state = before;
    let temporarilyBroken = false;
    for (const move of parseAlgorithm(byId(id).algorithm)) {
      state = applyMove(state, move);
      if (center(state, "D") === "D" && !solvedWhere(state, (p) => p[1] > -1)) temporarilyBroken = true;
    }
    expect(temporarilyBroken).toBe(true);
    expect(topFaceSolved(after)).toBe(true);
    expect(f2lSolved(after)).toBe(true);
    expect(preserved(before, after, (p) => p[1] < 1)).toBe(true);
    for (const p of piecePositions.filter((p) => p[1] === 1)) expect(colorsAt(after, p)).toBe(colorsAt(before, p));
    expect(allSolved(after)).toBe(false); // orientation does not claim permutation is solved
  });

  it("covers 0, 1 and 4 same-colour corner pairs and preserves every edge during the corner algorithm", () => {
    expect(cornerPairs(start("corners-one-pair"))).toEqual(["B"]);
    expect(cornerPairs(start("corners-no-pair"))).toHaveLength(0);
    expect(cornerPairs(finish("corners-no-pair"))).toHaveLength(1);
    expect(cornerPairs(start("corners-align-only"))).toHaveLength(4);
    for (const id of ["corners-one-pair", "corners-align-only"]) {
      expect(topCornersSolved(finish(id))).toBe(true);
      expect(allSolved(finish(id))).toBe(false);
    }
    for (const id of ["corners-one-pair", "corners-no-pair"]) {
      expect(f2lSolved(start(id))).toBe(true);
      expect(topFaceSolved(start(id))).toBe(true);
      expect(f2lSolved(finish(id))).toBe(true);
      expect(topFaceSolved(finish(id))).toBe(true);
      expect(preserved(start(id), finish(id), (p) => nonzero(p) === 2)).toBe(true);
    }
  });

  it("handles both last-edge cycles and no fixed side, with corners already correctly positioned", () => {
    expect(correctSides(start("edges-one-cycle"))).toEqual(["B"]);
    expect(correctSides(start("edges-two-cycles"))).toEqual(["B"]);
    expect(correctSides(start("edges-no-side"))).toHaveLength(0);
    expect(sticker(start("edges-one-cycle"), "F", [0, 1, 1])).toBe(center(start("edges-one-cycle"), "R"));
    expect(sticker(start("edges-two-cycles"), "F", [0, 1, 1])).toBe(center(start("edges-two-cycles"), "L"));
    for (const id of ["edges-one-cycle", "edges-two-cycles", "edges-no-side"]) {
      expect(topCornersSolved(start(id))).toBe(true);
      expect(topFaceSolved(start(id))).toBe(true);
      expect(f2lSolved(start(id))).toBe(true);
      expect(allSolved(finish(id))).toBe(true);
    }
  });

  it("uses meaningful independent checkpoints and an exactly reversible known mistake", () => {
    expect(topWhiteEdges(finish("independent-start")).length).toBe(topWhiteEdges(start("independent-start")).length + 1);
    expect(f2lSolved(start("independent-checkpoint"))).toBe(true);
    expect(topYellowEdges(start("independent-checkpoint"))).toHaveLength(2);
    expect(topYellowEdges(finish("independent-checkpoint"))).toHaveLength(4);
    expect(f2lSolved(start("independent-known-mistake"))).toBe(false);
    expect(f2lSolved(finish("independent-known-mistake"))).toBe(true);
  });

  it.each(["f2l-ready-pair", "f2l-separated", "f2l-white-up"])("%s inserts an actual corner-edge pair, protecting the cross and the other three slots", (id) => {
    const before = start(id), after = finish(id);
    expect(crossSolved(before)).toBe(true);
    expect(isHome(before, [1, -1, 1])).toBe(false);
    expect(isHome(before, [1, 0, 1])).toBe(false);
    expect(solvedWhere(before, (p) => p[1] < 1 && (p[0] !== 1 || p[2] !== 1))).toBe(true);
    expect(f2lSolved(after)).toBe(true);
    expect(allSolved(after)).toBe(false);
    expect(preserved(before, after, (p) => p[1] < 1 && (p[0] !== 1 || p[2] !== 1))).toBe(true);
  });

  it("F2L white-up preparation really becomes the previous three-move case, and six rhythm groups restore the start", () => {
    const preparation = parseAlgorithm(byId("f2l-white-up").algorithm).slice(0, 4);
    expect(applyAlgorithm(start("f2l-white-up"), preparation)).toBe(start("f2l-separated"));
    expect(finish("finger-rhythm")).toBe(start("finger-rhythm"));
  });
});

describe("beginner branches beyond the fixed illustrations", () => {
  it("the published human decision rules complete 40 unfamiliar legal scrambles, including a daisy with only one empty exit", () => {
    let seed = 20261101;
    const random = (bound: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor(seed / 0x100000000 * bound);
    };
    const seenDaisyEntries = new Set<string>();
    let singleSpaceTransfers = 0;
    let cornerExtractions = 0;
    let middleExtractions = 0;
    for (let trial = 0; trial < 40; trial++) {
      const scramble = Array.from({ length: 23 }, () => FACES[random(6)] + ["", "'", "2"][random(3)]).join(" ");
      let state = applyAlgorithm(WHITE_DOWN, scramble);
      const move = (algorithm: string) => { state = applyAlgorithm(state, algorithm); };
      const locate = (piece: string) => piecePositions.find((p) => colorsAt(state, p) === piece)!;
      const turnUntil = (condition: () => boolean, algorithm: string) => {
        for (let n = 0; n < 4 && !condition(); n++) move(algorithm);
        expect(condition(), `unable to position with ${algorithm}; trial ${trial}`).toBe(true);
      };
      const place = (piece: string, target: number[], algorithm: string) => turnUntil(() => locate(piece).join() === target.join(), algorithm);
      // Collect petals. This encodes the written exit checks, not a search for
      // a computed solution. A top-layer turn is allowed between the two lifts.
      for (let n = 0; n < 4 && topWhiteEdges(state).length < 4; n++) {
        const oldPetals = topWhitePieces(state);
        const position = piecePositions.find((p) => nonzero(p) === 2 && colorsAt(state, p).includes("U") && !(p[1] === 1 && sticker(state, "U", p) === "U"))!;
        const whiteFace = at(position).find((slot) => state[slot.index] === "U")!.face;
        seenDaisyEntries.add(`${position.join()}:${whiteFace}`);
        const piece = colorsAt(state, position);
        if (position[1] === -1) {
          place(piece, [0, -1, 1], "y");
          turnUntil(() => state[7] !== "U", "U");
          if (sticker(state, "D", [0, -1, 1]) === "U") move("F2");
          else {
            if (oldPetals.length === 3) singleSpaceTransfers++;
            move("F'");
            turnUntil(() => state[5] !== "U", "U");
            move("R");
          }
        } else if (position[1] === 0) {
          place(piece, [1, 0, 1], "y");
          if (sticker(state, "F", [1, 0, 1]) === "U") {
            turnUntil(() => state[5] !== "U", "U");
            move("R");
          } else {
            turnUntil(() => state[7] !== "U", "U");
            move("F'");
          }
        } else {
          place(piece, [0, 1, 1], "y");
          if (oldPetals.length === 3) singleSpaceTransfers++;
          move("F");
          turnUntil(() => state[5] !== "U", "U");
          move("R");
        }
        expect(topWhitePieces(state).length).toBeGreaterThanOrEqual(oldPetals.length + 1);
        expect(topWhitePieces(state)).toContain(piece);
        for (const petal of oldPetals) expect(topWhitePieces(state)).toContain(petal);
      }
      expect(topWhiteEdges(state)).toHaveLength(4);
      // Align each petal's side colour before its half turn.
      for (let n = 0; n < 4; n++) {
        const index = topWhiteEdges(state)[0];
        const position = SLOTS[index].position;
        const piece = colorsAt(state, position);
        const sideColor = at(position).map((slot) => state[slot.index]).find((color) => color !== "U")!;
        turnUntil(() => center(state, "F") === sideColor, "y");
        place(piece, [0, 1, 1], "U");
        move("F2");
      }
      expect(crossSolved(state)).toBe(true);
      // Insert each top white corner; when none is on top, extract a wrong one.
      for (let n = 0; n < 12 && !firstLayerSolved(state); n++) {
        const top = piecePositions.find((p) => p[1] === 1 && nonzero(p) === 3 && colorsAt(state, p).includes("U"));
        if (top) {
          const piece = colorsAt(state, top);
          turnUntil(() => ["U", center(state, "F"), center(state, "R")].sort().join("") === piece, "y");
          place(piece, [1, 1, 1], "U");
          const face = at([1, 1, 1]).find((slot) => state[slot.index] === "U")!.face;
          const count = { F: 1, U: 3, R: 5 }[face as "F" | "U" | "R"];
          expect(count).toBeDefined();
          move(Array(count).fill(RIGHT).join(" "));
          expect(isHome(state, [1, -1, 1])).toBe(true);
        } else {
          const wrong = piecePositions.find((p) => p[1] === -1 && nonzero(p) === 3 && !isHome(state, p))!;
          place(colorsAt(state, wrong), [1, -1, 1], "y");
          move(RIGHT);
          cornerExtractions++;
        }
        expect(crossSolved(state)).toBe(true);
      }
      expect(firstLayerSolved(state)).toBe(true);
      // Middle-layer insertion and the no-usable-edge fallback.
      for (let n = 0; n < 16 && !f2lSolved(state); n++) {
        const top = topNonYellowEdges(state)[0];
        if (top) {
          const piece = colorsAt(state, top);
          const frontColor = state[at(top).find((slot) => slot.face !== "U")!.index];
          turnUntil(() => center(state, "F") === frontColor, "y");
          place(piece, [0, 1, 1], "U");
          const upColor = sticker(state, "U", [0, 1, 1]);
          expect([center(state, "R"), center(state, "L")]).toContain(upColor);
          const right = upColor === center(state, "R");
          move(byId(right ? "middle-insert-right" : "middle-insert-left").algorithm);
          expect(isHome(state, [right ? 1 : -1, 0, 1])).toBe(true);
        } else {
          const wrong = piecePositions.find((p) => p[1] === 0 && !isHome(state, p))!;
          place(colorsAt(state, wrong), [1, 0, 1], "y");
          move(byId("middle-take-out").algorithm);
          middleExtractions++;
        }
        expect(firstLayerSolved(state)).toBe(true);
      }
      expect(f2lSolved(state)).toBe(true);
      // The remaining four stages follow the same fixed grip/order as lessons 7–10.
      if (topYellowEdges(state).length === 0) move(CROSS);
      if (topYellowEdges(state).length === 2) {
        const indices = topYellowEdges(state);
        const line = indices[0] + indices[1] === 8;
        turnUntil(() => topYellowEdges(state).join() === (line ? "3,5" : "1,3"), "U");
        move(CROSS);
        if (!line) move(CROSS);
      }
      expect(topYellowEdges(state)).toHaveLength(4);
      move("x2");
      for (let position = 0; position < 4; position++) {
        let count = 0;
        while (sticker(state, "D", [1, -1, 1]) !== "D" && count < 6) { move(RIGHT); count++; }
        expect([0, 2, 4]).toContain(count);
        move("D");
      }
      move("x2");
      expect(f2lSolved(state)).toBe(true);
      expect(topFaceSolved(state)).toBe(true);
      if (cornerPairs(state).length === 0) move(CORNERS);
      if (cornerPairs(state).length !== 4) {
        turnUntil(() => cornerPairs(state).includes("B"), "y");
        move(CORNERS);
      }
      turnUntil(() => topCornersSolved(state), "U");
      if (correctSides(state).length === 0) move(EDGES);
      if (correctSides(state).length !== 4) {
        turnUntil(() => correctSides(state).includes("B"), "y");
        const count = sticker(state, "F", [0, 1, 1]) === center(state, "R") ? 1 : 2;
        move(Array(count).fill(EDGES).join(" "));
      }
      expect(allSolved(state), `failed unfamiliar scramble ${trial}: ${scramble}`).toBe(true);
    }
    expect(seenDaisyEntries.size).toBe(20); // every non-petal white-edge position/orientation
    expect(singleSpaceTransfers).toBeGreaterThan(0);
    expect(cornerExtractions).toBeGreaterThan(0);
    expect(middleExtractions).toBeGreaterThan(0);
  });

  it("the dot / elbow / line decision procedure handles all 8 legal top-edge orientation patterns", () => {
    const states = orbit(WHITE_DOWN, [CROSS, "U"], (s) => [1, 3, 5, 7].map((i) => s[i] === "D" ? "1" : "0").join(""), 8);
    expect(states).toHaveLength(8);
    for (const initial of states) {
      let s = initial;
      if (topYellowEdges(s).length === 0) s = applyAlgorithm(s, CROSS);
      if (topYellowEdges(s).length === 2) {
        const indices = topYellowEdges(s);
        const opposite = indices[0] + indices[1] === 8;
        const expected = opposite ? "3,5" : "1,3";
        for (let i = 0; i < 4 && topYellowEdges(s).join() !== expected; i++) s = applyAlgorithm(s, "U");
        expect(topYellowEdges(s).join()).toBe(expected);
        s = applyAlgorithm(s, CROSS);
        if (!opposite) s = applyAlgorithm(s, CROSS);
      }
      expect(topYellowEdges(s)).toHaveLength(4);
      expect(f2lSolved(s)).toBe(true);
    }
  });

  it("fixed-front, four-position yellow-down teaching restores F2L for all 27 legal corner orientations", () => {
    const topCorners = piecePositions.filter((p) => p[1] === 1 && nonzero(p) === 3);
    const orientationKey = (s: string) => topCorners.map((p) => at(p).find((slot) => s[slot.index] === "D")!.face).join("");
    const states = orbit(WHITE_DOWN, ["R U R' U R U2 R'", "U"], orientationKey, 27);
    expect(states).toHaveLength(27);
    for (const initial of states) {
      let s = applyAlgorithm(initial, "x2");
      let groups = 0;
      for (let position = 0; position < 4; position++) {
        let count = 0;
        while (sticker(s, "D", [1, -1, 1]) !== "D" && count < 6) {
          s = applyAlgorithm(s, RIGHT);
          count++;
        }
        expect([0, 2, 4]).toContain(count);
        expect(sticker(s, "D", [1, -1, 1])).toBe("D");
        groups += count;
        s = applyAlgorithm(s, "D");
      }
      s = applyAlgorithm(s, "x2");
      expect(groups % 6).toBe(0);
      expect(topFaceSolved(s)).toBe(true);
      expect(f2lSolved(s)).toBe(true);
      expect(preserved(initial, s, (p) => p[1] < 1)).toBe(true);
      for (const p of topCorners) expect(colorsAt(s, p)).toBe(colorsAt(initial, p));
    }
  });

  it("the 0 / 1 / 4 corner-pair procedure places all 24 oriented top-corner permutations", () => {
    const key = (s: string) => SLOTS.filter((slot) => slot.position[1] === 1 && nonzero(slot.position) === 3).map((slot) => s[slot.index]).join("");
    const states = orbit(WHITE_DOWN, [CORNERS, "U"], key, 24);
    expect(states).toHaveLength(24);
    for (const initial of states) {
      let s = initial;
      if (cornerPairs(s).length === 0) s = applyAlgorithm(s, CORNERS);
      if (cornerPairs(s).length !== 4) {
        for (let i = 0; i < 4 && !cornerPairs(s).includes("B"); i++) s = applyAlgorithm(s, "y");
        expect(cornerPairs(s)).toEqual(["B"]);
        s = applyAlgorithm(s, CORNERS);
      }
      expect(cornerPairs(s)).toHaveLength(4);
      for (let i = 0; i < 4 && !topCornersSolved(s); i++) s = applyAlgorithm(s, "U");
      expect(topCornersSolved(s)).toBe(true);
      expect(topFaceSolved(s)).toBe(true);
      expect(f2lSolved(s)).toBe(true);
    }
  });

  it("the no-side fallback and one/two-cycle direction choice solve all 12 legal final edge permutations", () => {
    const key = (s: string) => sideFaces.map((face) => s[FACES.indexOf(face) * 9 + 1]).join("");
    const states = orbit(WHITE_DOWN, [EDGES, `y ${EDGES} y'`], key, 12);
    expect(states).toHaveLength(12);
    for (const initial of states) {
      let s = initial;
      if (correctSides(s).length === 0) s = applyAlgorithm(s, EDGES);
      if (correctSides(s).length !== 4) {
        for (let i = 0; i < 4 && !correctSides(s).includes("B"); i++) s = applyAlgorithm(s, "y");
        expect(correctSides(s)).toEqual(["B"]);
        const destination = sticker(s, "F", [0, 1, 1]);
        expect([center(s, "R"), center(s, "L")]).toContain(destination);
        const count = destination === center(s, "R") ? 1 : 2;
        s = applyAlgorithm(s, Array(count).fill(EDGES).join(" "));
      }
      expect(allSolved(s)).toBe(true);
    }
  });
});
