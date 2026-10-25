import { NORMALS, parseMove, type Face, type Move } from "./cube";
import type { ExecutionMoves } from "./execution-moves";

export interface ReorientationPlan extends ExecutionMoves {
  /** Physical yaw after each executed step, including the initial zero. */
  yawAtBoundary: number[];
  cost: number;
  fixedCost: number;
  rotationCount: number;
  phrases: { start: number; end: number; yaw: number }[];
}
export interface ReorientationOptions {
  /** Complete phrase cost, including entry, exits and retained grips. */
  phraseCost: (moves: readonly Move[]) => number;
  /** Actual calibrated quarter-rotation cost, by direction. */
  rotationCost: (direction: 1 | -1) => number;
}
const mod4 = (n: number) => ((n % 4) + 4) % 4;

/** Express an outer turn after a physical y rotation, preserving signed halves. */
export function moveAtYaw(move: Move, yaw: number): Move {
  if (move.kind || (move.layers && (move.layers.length !== 1 || move.layers[0] !== 1)))
    throw new Error("换面规划需要普通六面动作。");
  let [x, y, z] = NORMALS[move.face];
  for (let i = 0; i < mod4(yaw); i++) [x, z] = [-z, x];
  const face = (Object.keys(NORMALS) as Face[]).find((f) =>
    NORMALS[f][0] === x && NORMALS[f][1] === y && NORMALS[f][2] === z)!;
  const suffix = move.turns === 3 ? "'" : move.turns === 2 ? (move.direction === -1 ? "2'" : "2") : "";
  return parseMove(face + suffix);
}

/**
 * Search four yaw frames and every contiguous phrase boundary. This optimizes
 * only the supplied calibrated library/costs, not all human solutions. Each
 * phrase starts/ends in its known common grip. A rotation is an explicit move;
 * the final return to the original color frame is included in both cost and
 * execution. Source CFOP stages remain separate from these execution indices.
 */
export function planYReorientations(source: readonly Move[], options: ReorientationOptions): ReorientationPlan {
  const mapped = [0, 1, 2, 3].map((yaw) => source.map((move) => moveAtYaw(move, yaw)));
  const turnCosts = [options.rotationCost(1), options.rotationCost(-1)];
  if (turnCosts.some((cost) => !Number.isFinite(cost) || cost <= 0))
    throw new Error("转体成本必须是有限正数。");
  const route = (from: number, to: number) => {
    const forward = mod4(to - from), backward = mod4(from - to);
    return forward * turnCosts[0] <= backward * turnCosts[1]
      ? { count: forward, direction: 1 as const, cost: forward * turnCosts[0] }
      : { count: backward, direction: -1 as const, cost: backward * turnCosts[1] };
  };
  const checkedCost = (moves: readonly Move[]) => {
    const cost = options.phraseCost(moves);
    if (!Number.isFinite(cost) || cost < 0) throw new Error("指法成本必须是有限非负数。");
    return cost;
  };
  const count = source.length, fixedCost = count ? checkedCost(source) : 0;
  type Node = { cost: number; rotations: number; previous: Node | null; start: number; end: number; yaw: number };
  const initial: Node = { cost: 0, rotations: 0, previous: null, start: 0, end: 0, yaw: 0 };
  const nodes: (Node | undefined)[][] = Array.from({ length: count + 1 }, () => Array(4));
  nodes[0][0] = initial;
  const better = (cost: number, rotations: number, before?: Node) => !before ||
    cost < before.cost - 1e-9 || (Math.abs(cost - before.cost) <= 1e-9 && rotations < before.rotations);
  for (let start = 0; start < count; start++) {
    for (let yaw = 0; yaw < 4; yaw++) {
      let entry: Node | undefined, entryCost = Infinity, entryRotations = Infinity;
      for (const previous of nodes[start]) {
        if (!previous || (start > 0 && previous.yaw === yaw)) continue;
        const travel = route(previous.yaw, yaw), cost = previous.cost + travel.cost;
        const rotations = previous.rotations + travel.count;
        if (cost < entryCost - 1e-9 || (Math.abs(cost - entryCost) <= 1e-9 && rotations < entryRotations)) {
          entry = previous; entryCost = cost; entryRotations = rotations;
        }
      }
      if (!entry) continue;
      for (let end = start + 1; end <= count; end++) {
        const cost = entryCost + checkedCost(mapped[yaw].slice(start, end));
        if (better(cost, entryRotations, nodes[end][yaw]))
          nodes[end][yaw] = { cost, rotations: entryRotations, previous: entry, start, end, yaw };
      }
    }
  }
  let best = nodes[count][0] ?? initial, total = best.cost;
  for (const node of nodes[count]) {
    if (!node) continue;
    const exit = route(node.yaw, 0), cost = node.cost + exit.cost;
    const rotations = node.rotations + exit.count;
    const bestRotations = best.rotations + route(best.yaw, 0).count;
    if (cost < total - 1e-9 || (Math.abs(cost - total) <= 1e-9 && rotations < bestRotations)) {
      best = node; total = cost;
    }
  }
  const phrases: ReorientationPlan["phrases"] = [];
  for (let node: Node | null = best; node?.previous; node = node.previous)
    phrases.unshift({ start: node.start, end: node.end, yaw: node.yaw });
  const moves: Move[] = [], sourceIndices: number[] = [], boundaries = [0], yawAtBoundary = [0];
  let yaw = 0, rotationCount = 0;
  const rotateTo = (target: number, owner: number) => {
    const travel = route(yaw, target);
    for (let i = 0; i < travel.count; i++) {
      moves.push(parseMove(travel.direction === 1 ? "y" : "y'"));
      sourceIndices.push(owner); yaw = mod4(yaw + travel.direction);
      yawAtBoundary.push(yaw); rotationCount++;
    }
  };
  for (const phrase of phrases) {
    rotateTo(phrase.yaw, phrase.start);
    for (let index = phrase.start; index < phrase.end; index++) {
      moves.push(mapped[yaw][index]); sourceIndices.push(index);
      yawAtBoundary.push(yaw); boundaries.push(moves.length);
    }
  }
  if (count) { rotateTo(0, count - 1); boundaries[count] = moves.length; }
  return { moves, sourceIndices, boundaries, yawAtBoundary, rotationCount, cost: total, fixedCost, phrases };
}
