/** Read-only semantic proof for explicit outer-turn + x expansion. No motion is certified here. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import {
  applyAlgorithm,
  applyMove,
  DEFAULT_PALETTE,
  moveAffects,
  moveAngle,
  NORMALS,
  parseAlgorithm,
  parseMove,
  snapshots,
  SOLVED,
  type Move,
} from "../src/core/cube";
import { CubeModel } from "../src/scene/cube-model";
import { expandExecutionMoves } from "../src/core/execution-moves";

const quarter = (move: Move) => Math.round(-moveAngle(move) / (Math.PI / 2));
function notation(symbol: string, signed: number) {
  assert([1, -1, 2, -2].includes(signed));
  return (
    symbol +
    (signed === 1 ? "" : signed === -1 ? "'" : signed === 2 ? "2" : "2'")
  );
}
function expansion(move: Move) {
  const q = quarter(move);
  let compact: string[];
  if (!move.kind) compact = [move.notation];
  else if (move.kind === "slice" && move.face === "L")
    compact = [notation("x", -q), notation("R", q), notation("L", -q)];
  else if (move.kind === "wide" && move.face === "R")
    compact = [notation("x", q), notation("L", q)];
  else if (move.kind === "wide" && move.face === "L")
    compact = [notation("x", -q), notation("R", q)];
  else if (move.kind === "rotation" && move.face === "R")
    compact = [notation("x", q)];
  else throw new Error(`Outside this bounded probe: ${move.notation}`);
  // The pending x path is 90°. Two complete quarter-turn paths are explicit
  // steps; a half turn is never given a hidden second state transition.
  const actual = compact.flatMap((token) => {
    const parsed = parseMove(token);
    return parsed.kind === "rotation" && parsed.turns === 2
      ? [
          notation("x", Math.sign(quarter(parsed))),
          notation("x", Math.sign(quarter(parsed))),
        ]
      : [token];
  });
  return { compact, actual };
}
function plan(algorithm: string) {
  const original = parseAlgorithm(algorithm),
    actual: Move[] = [];
  const sourceBoundary = [0];
  const groups = original.map((move, sourceIndex) => {
    const values = expansion(move),
      start = actual.length;
    actual.push(...values.actual.map(parseMove));
    sourceBoundary.push(actual.length);
    return {
      sourceIndex,
      sourceNotation: move.notation,
      start,
      end: actual.length,
      compact: values.compact.join(" "),
      actual: values.actual.join(" "),
      realization:
        move.kind === "slice" || move.kind === "wide" ? "decomposed" : "direct",
    };
  });
  return { original, actual, sourceBoundary, groups };
}

const labelled = Array.from({ length: 54 }, (_, i) =>
  String.fromCharCode(0x100 + i),
).join("");
const asIndices = (state: string) =>
  [...state].map((character) => character.charCodeAt(0) - 0x100);
const mismatches = (a: string, b: string) =>
  [...a].flatMap((value, i) => (value === b[i] ? [] : [i]));
const orientationQueue = [{ state: labelled, algorithm: "" }],
  orientationKeys = new Set([labelled]);
for (let i = 0; i < orientationQueue.length; i++) {
  for (const move of ["x", "y", "z"]) {
    const state = applyMove(orientationQueue[i].state, move);
    if (!orientationKeys.has(state)) {
      orientationKeys.add(state);
      orientationQueue.push({
        state,
        algorithm: `${orientationQueue[i].algorithm} ${move}`.trim(),
      });
    }
  }
}
assert.equal(orientationQueue.length, 24);
const colored = [
  "",
  "R U2 F' L D B2 R' F2 U L2 D' B R2 U' F",
  "L2 D2 R2 B2 U' F R' U L D'",
  "R U R' U' F2 B D2 L' U2'",
].map((algorithm) => ({ state: applyAlgorithm(SOLVED, algorithm), algorithm }));
const inputs = [...orientationQueue, ...colored];
// Exact signed world-X rotation, not just a modulo-360 final state check.
// All primitives in these expansions commute around X and preserve the layer x coordinate.
function layerDegrees(moves: readonly Move[]) {
  return [-1, 0, 1].map((layer) =>
    moves.reduce((sum, move) => {
      assert.equal(Math.abs(NORMALS[move.face][0]), 1);
      return (
        sum +
        (moveAffects(move, [layer, 0, 0])
          ? (moveAngle(move) * NORMALS[move.face][0] * 180) / Math.PI
          : 0)
      );
    }, 0),
  );
}
const variants = ["M", "Rw", "Lw", "x", "r", "l"].flatMap((symbol) =>
  ["", "'", "2", "2'"].map((suffix) => symbol + suffix),
);
let comparisons = 0;
const rows = variants.map((source) => {
  const move = parseMove(source),
    values = expansion(move),
    actual = expandExecutionMoves([move]).moves;
  assert.equal(
    actual.map((step) => step.notation).join(" "),
    values.actual.join(" "),
  );
  assert(
    actual.every(
      (m) =>
        !m.kind || (m.kind === "rotation" && m.face === "R" && m.turns !== 2),
    ),
  );
  for (const { state } of inputs) {
    for (const expanded of [
      values.compact.join(" "),
      values.actual.join(" "),
    ]) {
      const wanted = applyMove(state, move),
        obtained = applyAlgorithm(state, expanded);
      assert.deepEqual(
        mismatches(wanted, obtained),
        [],
        `${source} = ${expanded}`,
      );
      comparisons++;
    }
  }
  const expectedDegrees = layerDegrees([move]),
    actualDegrees = layerDegrees(actual);
  assert.deepEqual(
    actualDegrees,
    expectedDegrees,
    `${source} half-turn direction`,
  );
  return {
    source,
    compact: values.compact.join(" "),
    actual: values.actual.join(" "),
    kind: move.kind,
    direction: move.direction ?? 1,
    sourceQuarterTurns: quarter(move),
    expectedWorldXDegreesByLayer: expectedDegrees,
    actualWorldXDegreesByLayer: actualDegrees,
    permutationDestinationToSource: asIndices(applyMove(labelled, move)),
    mismatchedSlots: [],
    testedInputCount: inputs.length,
    exact54: true,
  };
});
const unicodeAliases = ["M′", "Rw’", "x2′", "l2’"].map((token) => {
  const parsed = parseMove(token),
    values = expansion(parsed);
  assert.equal(
    applyMove(labelled, parsed),
    applyAlgorithm(labelled, values.actual.join(" ")),
  );
  return {
    token,
    normalized: parsed.notation,
    actual: values.actual.join(" "),
  };
});
const contextAlgorithms = [
  "M U",
  "M2 U M2 U2 M2 U M2",
  "Rw U Rw' U' F R U R' F'",
  "Lw' U' Lw U B L' U L B'",
  "x R U R' U' x' F U2' F'",
  "R U M U' Rw2' F Lw' D x2 B2' M2' x'",
  variants.join(" "),
];
let sourceBoundaryChecks = 0;
const contexts = contextAlgorithms.map((algorithm) => {
  const expanded = plan(algorithm),
    execution = expandExecutionMoves(expanded.original),
    sourceStates = snapshots(labelled, expanded.original),
    actualStates = snapshots(labelled, execution.moves);
  assert.deepEqual(execution.boundaries, expanded.sourceBoundary);
  assert.deepEqual(
    execution.sourceIndices,
    expanded.groups.flatMap((group) =>
      Array.from({ length: group.end - group.start }, () => group.sourceIndex),
    ),
  );
  for (let i = 0; i < sourceStates.length; i++) {
    assert.equal(
      actualStates[expanded.sourceBoundary[i]],
      sourceStates[i],
      `${algorithm} source boundary ${i}`,
    );
    sourceBoundaryChecks++;
  }
  assert.equal(actualStates.length, expanded.actual.length + 1);
  assert.equal(actualStates.at(-1), sourceStates.at(-1));
  return {
    algorithm,
    actual: expanded.actual.map((move) => move.notation).join(" "),
    sourceStepCount: expanded.original.length,
    actualStepCount: expanded.actual.length,
    sourceBoundary: expanded.sourceBoundary,
    groups: expanded.groups,
    allSourceBoundariesExact54: true,
    actualStepToSource: expanded.groups.flatMap((group) =>
      Array.from({ length: group.end - group.start }, () => group.sourceIndex),
    ),
  };
});

// Actual Three.js CubeModel transforms, no WebGL/browser. Check the rendering
// contract: pre-state + current move angle == post-state + identity frame.
const cube = new CubeModel(),
  identity = new Quaternion(),
  worldPosition = new Vector3(),
  worldNormal = new Vector3(),
  worldQuaternion = new Quaternion();
function visual() {
  cube.root.updateMatrixWorld(true);
  const values: string[] = [];
  cube.root.traverse((node) => {
    if (!(node instanceof Mesh) || !node.name.startsWith("sticker-")) return;
    node.getWorldPosition(worldPosition);
    node.getWorldQuaternion(worldQuaternion);
    worldNormal.set(0, 0, 1).applyQuaternion(worldQuaternion);
    const vector = [...worldPosition.toArray(), ...worldNormal.toArray()].map(
      (value) => Math.round(value * 1e6),
    );
    values.push(
      `${vector.join(",")}:${(node.material as MeshStandardMaterial).color.getHexString()}`,
    );
  });
  assert.equal(values.length, 54);
  return values.sort();
}
let visualBoundaries = 0;
for (const { algorithm } of colored) {
  for (const row of rows) {
    let state = applyAlgorithm(SOLVED, algorithm);
    for (const move of parseAlgorithm(row.actual)) {
      cube.update(state, DEFAULT_PALETTE, identity, move, moveAngle(move));
      const end = visual();
      state = applyMove(state, move);
      cube.update(state, DEFAULT_PALETTE, identity);
      assert.deepEqual(
        visual(),
        end,
        `${row.source} / ${move.notation} render boundary`,
      );
      visualBoundaries++;
    }
  }
}
const counterState = colored[1].state,
  x = parseMove("x"),
  xQuaternion = new Quaternion().setFromAxisAngle(
    new Vector3(...NORMALS.R),
    moveAngle(x),
  );
cube.update(counterState, DEFAULT_PALETTE, identity, x, moveAngle(x));
const beforeBake = visual();
cube.update(applyMove(counterState, x), DEFAULT_PALETTE, xQuaternion);
const doubleRotated = visual();
assert.notDeepEqual(
  doubleRotated,
  beforeBake,
  "negative control: a baked x plus persistent frame must disagree",
);
const doubleRotationDifferentRows = beforeBake.filter(
  (value, i) => value !== doubleRotated[i],
).length;
cube.dispose();
// A state-only equality check cannot distinguish opposite half-turn paths.
const naiveHalf = parseAlgorithm("x2 R2 L2");
assert.equal(applyAlgorithm(labelled, naiveHalf), applyMove(labelled, "M2"));
assert.notDeepEqual(layerDegrees(naiveHalf), layerDegrees([parseMove("M2")]));

const files = [
  "src/core/cube.ts",
  "src/scene/cube-model.ts",
  "src/scene/Studio.ts",
  "src/App.tsx",
  "src/core/follow.ts",
  "src/core/execution-moves.ts",
  "src/core/execution-moves.test.ts",
  "scripts/finger-extended-semantics.ts",
];
const sourceHashes = Object.fromEntries(
  files.map((path) => [
    path,
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  ]),
);
const result = {
  date: new Date().toISOString(),
  sourceHashes,
  scope:
    "Pure equivalence and indexing/render-frame contract only. No x hand geometry, collision, duration, hardware, or implementation readiness claim.",
  policy:
    "Keep original solution and source metadata; derive explicit real steps. M/wide are marked decomposed; x2 is two x quarter-turn steps. Do not normalize away half-turn direction.",
  orientations: orientationQueue.map(
    ({ algorithm }) => algorithm || "identity",
  ),
  inputs: {
    uniquelyLabelledOrientations: orientationQueue.length,
    coloredStates: colored.map(({ algorithm }) => algorithm || "SOLVED"),
  },
  rows,
  unicodeAliases,
  contexts,
  summary: {
    variants: rows.length,
    comparisons,
    sourceBoundaryChecks,
    visualBoundaries,
    stickerCount: 54,
    passed: true,
  },
  negativeControl: {
    bakedStateAndPersistentOrientationDoubleRotate: true,
    differentVisualRows: doubleRotationDifferentRows,
    stateOnlyCannotProtectHalfTurnDirection: {
      source: "M2",
      stateEquivalentButWrongPath: "x2 R2 L2",
      expectedWorldXDegreesByLayer: layerDegrees([parseMove("M2")]),
      wrongWorldXDegreesByLayer: layerDegrees(naiveHalf),
    },
  },
};
writeFileSync(
  "evidence/finger-extended-semantics.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ...result.summary,
    negativeControl: result.negativeControl,
    evidence: "evidence/finger-extended-semantics.json",
  }),
);
