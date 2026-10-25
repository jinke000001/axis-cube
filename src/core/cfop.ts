import { Solver as FridrichSolver } from "../../vendor/rubiks-cube-solver/index.js";
import type { Partition } from "../../vendor/rubiks-cube-solver/index.js";
import {
  applyAlgorithm,
  FACES,
  NORMALS,
  parseAlgorithm,
  SLOTS,
  SOLVED,
  validateFacelets,
} from "./cube";
import type { Face, Move, Vec3 } from "./cube";

import { CFOP_PHASES, isCFOPPhaseSolved, type CFOPPhaseName } from "./cfop-state";
export { CFOP_PHASES, isCFOPPhaseSolved, type CFOPPhaseName } from "./cfop-state";

export interface CFOPSegment {
  /** Zero-based, half-open indices into parseAlgorithm(result.solution). */
  start: number;
  end: number;
  algorithm: string;
  /** Same operation before wide/slice turns are expressed as outer-face turns. */
  nativeAlgorithm: string;
  /** Upstream recognition key, NOT a GAN / standard OLL or PLL case number. */
  caseId: string;
  /** Solved piece identities in the application's fixed URFDLB color frame. */
  targets: string[];
  before: string;
  after: string;
}

export interface CFOPPhase {
  name: CFOPPhaseName;
  start: number;
  end: number;
  algorithm: string;
  segments: CFOPSegment[];
}

export interface CFOPCandidateScore {
  /** A computational coordinate choice, not an animated cube rotation. */
  frame: number;
  score: number;
  moveCount: number;
}

export interface CFOPResult {
  solution: string;
  phases: CFOPPhase[];
  crossFace: "D";
  score: number;
  selectedFrame: number;
  candidateCount: number;
  candidates: CFOPCandidateScore[];
}

export interface CFOPOptions {
  /** Pure score for a complete candidate; also compares equivalent half-turn directions. Lower is better. */
  gestureCost?: (algorithm: string) => number;
}

type Frame = [Vec3, Vec3, Vec3];
const OPPOSITE: Record<Face, Face> = {
  U: "D",
  D: "U",
  R: "L",
  L: "R",
  F: "B",
  B: "F",
};
const UPSTREAM_FACE_ORDER: Face[] = ["F", "R", "U", "D", "L", "B"];
const SLICE_AXIS: Record<string, Face> = { M: "L", E: "D", S: "F" };
const slotKey = (p: Vec3, n: Vec3) => `${p.join(",")}/${n.join(",")}`;
const slotIndices = new Map(
  SLOTS.map((slot) => [slotKey(slot.position, slot.normal), slot.index]),
);
const faceOfNormal = (normal: Vec3): Face =>
  FACES.find((face) => NORMALS[face].every((value, i) => value === normal[i]))!;
const transform = (v: Vec3, frame: Frame): Vec3 =>
  [0, 1, 2].map((i) =>
    v.reduce((sum, value, j) => sum + value * frame[j][i], 0),
  ) as Vec3;
const mapFace = (face: Face, frame: Frame) =>
  faceOfNormal(transform(NORMALS[face], frame));

function quarter(v: Vec3, axis: Vec3): Vec3 {
  const dot = v.reduce((sum, value, i) => sum + value * axis[i], 0);
  const cross = [
    axis[1] * v[2] - axis[2] * v[1],
    axis[2] * v[0] - axis[0] * v[2],
    axis[0] * v[1] - axis[1] * v[0],
  ];
  return axis.map((value, i) => value * dot - cross[i]) as Vec3;
}

/** Source U maps to application D; four yaw choices change the pair order. */
function frameFor(yaw: number): Frame {
  let frame: Frame = [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < yaw; i++) {
    frame = frame.map((column) => quarter(column, NORMALS.U)) as Frame;
  }
  return frame;
}

function toUpstreamState(state: string, frame: Frame): string {
  const inverseFaces = Object.fromEntries(
    FACES.map((face) => [mapFace(face, frame), face.toLowerCase()]),
  );
  return UPSTREAM_FACE_ORDER.map((face) =>
    SLOTS.filter((slot) => slot.face === face)
      .map((slot) => {
        const index = slotIndices.get(
          slotKey(
            transform(slot.position, frame),
            transform(slot.normal, frame),
          ),
        )!;
        return inverseFaces[state[index]];
      })
      .join(""),
  ).join("");
}

const notation = (face: string, turns: number) =>
  face + (turns === 2 ? "2" : turns === 3 ? "'" : "");

/** Combine equal outer-face moves, including across commuting opposite faces. */
function appendMove(moves: Move[], face: Face, turns: number) {
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].face === face) {
      const combined = (moves[i].turns + turns) % 4;
      if (combined) {
        moves[i] = {
          face,
          turns: combined as Move["turns"],
          notation: notation(face, combined),
        };
      } else {
        moves.splice(i, 1);
      }
      return;
    }
    if (moves[i].face !== OPPOSITE[face]) break;
  }
  moves.push({
    face,
    turns: turns as Move["turns"],
    notation: notation(face, turns),
  });
}

/**
 * Expand a wide/slice move into outer turns plus a virtual whole rotation.
 * The rotation is absorbed into the coordinate frame, never emitted as a
 * physical regrip: r = x L; M = x' R L'. Tracking the inverse rotation maps
 * subsequent moves back to the unchanged application centers.
 */
function convertPartition(raw: string[], initialFrame: Frame) {
  let frame = initialFrame.map((column) => [...column]) as Frame;
  const moves: Move[] = [];
  const native: string[] = [];
  for (const token of raw) {
    if (!token) continue;
    // Upstream orientation transforms sometimes capitalize the PRIME suffix.
    const normalized = token[0] + token.slice(1).toLowerCase();
    const match = /^([URFDLBurfdlbMES])(2|prime|prime2|2prime)?$/.exec(
      normalized,
    );
    if (!match) throw new Error(`CFOP 算法包含未知动作：${token}`);
    const symbol = match[1];
    const turns = match[2]?.includes("2") ? 2 : match[2] === "prime" ? 3 : 1;
    const sliceAxis = SLICE_AXIS[symbol];
    const axis = sliceAxis ?? (symbol.toUpperCase() as Face);
    const mappedAxis = mapFace(axis, initialFrame);
    if (sliceAxis) {
      const nativeSlice = Object.entries(SLICE_AXIS).find(
        ([, reference]) =>
          reference === mappedAxis || reference === OPPOSITE[mappedAxis],
      )!;
      native.push(
        notation(
          nativeSlice[0],
          nativeSlice[1] === mappedAxis ? turns : 4 - turns,
        ),
      );
    } else {
      native.push(
        notation(
          symbol === axis ? mappedAxis : mappedAxis.toLowerCase(),
          turns,
        ),
      );
    }
    if (!sliceAxis && symbol === axis) {
      appendMove(moves, mapFace(axis, frame), turns);
      continue;
    }
    if (sliceAxis) appendMove(moves, mapFace(axis, frame), 4 - turns);
    appendMove(moves, mapFace(OPPOSITE[axis], frame), turns);
    // frame' = frame * Q^-1, where Q is the removed source-space rotation.
    const inverseRotation = (vector: Vec3) => {
      for (let i = 0; i < 4 - turns; i++)
        vector = quarter(vector, NORMALS[axis]);
      return transform(vector, frame);
    };
    frame = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ].map((basis) => inverseRotation(basis as Vec3)) as Frame;
  }
  // Every upstream CFOP partition returns the centers to the original frame.
  // Reject a future algorithm that changes this contract instead of quietly
  // losing a rotation at a stage or pair boundary.
  if (
    frame.some((column, i) =>
      column.some((value, j) => value !== initialFrame[i][j]),
    )
  ) {
    throw new Error("CFOP 配对算法未恢复中心朝向。");
  }
  return {
    algorithm: moves.map((move) => move.notation).join(" "),
    nativeAlgorithm: native.join(" "),
  };
}

const sameAsSolved = (state: string, indices: number[]) =>
  indices.every((index) => state[index] === SOLVED[index]);
function pieceSolved(state: string, colors: string): boolean {
  const position = [0, 0, 0] as Vec3;
  for (const color of colors)
    NORMALS[color as Face].forEach((value, i) => (position[i] += value));
  const indices = SLOTS.filter((slot) =>
    slot.position.every((value, i) => value === position[i]),
  ).map((slot) => slot.index);
  return indices.length === colors.length && sameAsSolved(state, indices);
}

function targetsOf(partition: Partition, frame: Frame): string[] {
  return [partition.cubies.corner, partition.cubies.edge].flatMap((cubie) =>
    cubie
      ? [
          cubie
            .colors()
            .map((color) => mapFace(color.toUpperCase() as Face, frame))
            .sort()
            .join(""),
        ]
      : [],
  );
}

/** A pair boundary is only kept when it is an observable completed state.
 * If a neighbouring algorithm immediately undoes its last move, join those
 * chunks and retain their combined targets at the new, verified endpoint. */
function joinRedundantBoundaries(segments: CFOPSegment[], start: number) {
  const joined: CFOPSegment[] = [];
  for (const segment of segments) {
    let current = { ...segment };
    while (joined.length) {
      const previous = joined.at(-1)!;
      const input = [...parseAlgorithm(previous.algorithm), ...parseAlgorithm(current.algorithm)];
      const reduced: Move[] = [];
      for (const move of input) appendMove(reduced, move.face, move.turns);
      if (reduced.length === input.length) break;
      const algorithm = reduced.map(move => move.notation).join(" ");
      if (applyAlgorithm(previous.before, algorithm) !== current.after)
        throw new Error("CFOP 相邻动作简化未通过独立状态校验。");
      joined.pop();
      current = { ...current, before: previous.before, algorithm,
        nativeAlgorithm: [previous.nativeAlgorithm, current.nativeAlgorithm].filter(Boolean).join(" "),
        caseId: `${previous.caseId} / ${current.caseId}`,
        targets: [...new Set([...previous.targets, ...current.targets])],
      };
    }
    joined.push(current);
  }
  let cursor = start;
  for (const segment of joined) {
    segment.start = cursor;
    cursor += parseAlgorithm(segment.algorithm).length;
    segment.end = cursor;
  }
  return joined;
}

export function solveCFOPCandidate(facelets: string, yaw: number) {
  const frame = frameFor(yaw);
  const solver = new FridrichSolver(toUpstreamState(facelets, frame), {});
  solver.solve();
  const phases: CFOPPhase[] = [];
  const allMoves: string[] = [];
  const completedPieces = new Set<string>();
  let state = facelets;
  for (const name of CFOP_PHASES) {
    const start = allMoves.length;
    const segments: CFOPSegment[] = [];
    for (const partition of solver.progress[name]) {
      const { algorithm, nativeAlgorithm } = convertPartition(
        partition.moves,
        frame,
      );
      const before = state;
      state = applyAlgorithm(state, algorithm);
      const targets = targetsOf(partition, frame);
      targets.forEach((piece) => completedPieces.add(piece));
      if (![...completedPieces].every((piece) => pieceSolved(state, piece))) {
        throw new Error(`CFOP ${name} 配对验证失败：已完成的块被破坏。`);
      }
      const segmentStart = allMoves.length;
      allMoves.push(...parseAlgorithm(algorithm).map((move) => move.notation));
      segments.push({
        start: segmentStart,
        end: allMoves.length,
        algorithm,
        nativeAlgorithm,
        caseId: String(partition.caseNumber),
        targets,
        before,
        after: state,
      });
    }
    if (!isCFOPPhaseSolved(state, name)) {
      throw new Error(`CFOP ${name} 阶段未通过独立局面验证。`);
    }
    const compact = joinRedundantBoundaries(segments, start);
    allMoves.splice(start, allMoves.length - start, ...compact.flatMap(segment =>
      parseAlgorithm(segment.algorithm).map(move => move.notation)));
    phases.push({
      name,
      start,
      end: allMoves.length,
      algorithm: allMoves.slice(start).join(" "),
      segments: compact,
    });
  }
  return { solution: allMoves.join(" "), phases, selectedFrame: yaw };
}

/**
 * Genuine Cross -> F2L -> OLL -> PLL, with a fixed D cross / U last layer.
 * Each of four source frames runs those algorithms in its own pair order.
 * Choose among verified candidates with a caller's gesture cost, or HTM count.
 * No cubejs solution is used, and no physical rotations are added by the frame
 * search. The bounded candidate set does not imply a globally optimal solution.
 */
export function solveCFOP(
  facelets: string,
  options: CFOPOptions = {},
): CFOPResult {
  const validation = validateFacelets(facelets);
  if (!validation.valid) throw new Error(validation.message);
  const candidates = [0, 1, 2, 3].map((yaw) => {
    const plan = solveCFOPCandidate(facelets, yaw);
    if (options.gestureCost) {
      // The solver generates half turns without a prescribed hand direction.
      // Two bounded coordinate-descent passes choose an equal-state execution
      // direction using the same real gesture library as the final playback.
      const moves=parseAlgorithm(plan.solution);
      let best=options.gestureCost(plan.solution);
      for(let pass=0;pass<2;pass++) {
        let changed=false;
        for(let i=0;i<moves.length;i++)if(moves[i].turns===2) {
          const original=moves[i],candidate=parseAlgorithm(original.face+(original.direction===-1?"2":"2'"))[0];
          moves[i]=candidate;
          const score=options.gestureCost(moves.map((m)=>m.notation).join(" "));
          if(Number.isFinite(score)&&score<best-1e-9){best=score;changed=true;}else moves[i]=original;
        }
        if(!changed)break;
      }
      plan.solution=moves.map((move)=>move.notation).join(" ");
      for(const phase of plan.phases) {
        phase.algorithm=moves.slice(phase.start,phase.end).map((move)=>move.notation).join(" ");
        for(const segment of phase.segments)segment.algorithm=moves.slice(segment.start,segment.end).map((move)=>move.notation).join(" ");
      }
    }
    const moveCount = parseAlgorithm(plan.solution).length;
    const score = options.gestureCost
      ? options.gestureCost(plan.solution)
      : moveCount;
    if (!Number.isFinite(score) || score < 0)
      throw new Error("CFOP 动作成本必须是有限的非负数。");
    return { ...plan, score, moveCount };
  });
  candidates.sort(
    (a, b) =>
      a.score - b.score ||
      a.moveCount - b.moveCount ||
      a.selectedFrame - b.selectedFrame,
  );
  const best = candidates[0];
  return {
    solution: best.solution,
    phases: best.phases,
    crossFace: "D",
    score: best.score,
    selectedFrame: best.selectedFrame,
    candidateCount: candidates.length,
    candidates: candidates.map(({ selectedFrame, score, moveCount }) => ({
      frame: selectedFrame,
      score,
      moveCount,
    })),
  };
}
