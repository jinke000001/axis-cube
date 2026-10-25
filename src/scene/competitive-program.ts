import { parseMove, type Move } from "../core/cube";
import { expandExecutionMoves } from "../core/execution-moves";
import { planYReorientations } from "../core/reorientation-plan";
import { compileFingerProgram, type FingerProgram } from "./finger-program";
import { compileDirectFingerProgram } from "./finger-direct-program";
import { compileRotationProgram } from "./finger-rotation-program";
import { assembleFingerPrograms } from "./finger-program-assembly";
import { compileRecordedFingerMove, type RecordedFingerPrimitive } from "./recorded-finger-program";
import { getCompetitivePrimitives } from "./competitive-library";

type JoinedProgram = ReturnType<typeof assembleFingerPrograms>;
const primitiveCache = new WeakMap<RecordedFingerPrimitive, FingerProgram>();
const phraseCache = new Map<string, FingerProgram>();
const transitionCache = new WeakMap<FingerProgram, WeakMap<FingerProgram, number>>();
const text = (moves: readonly Move[]) => moves.map((move) => move.notation).join(" ");

function recorded(move: Move, primitive: RecordedFingerPrimitive) {
  if (!primitiveCache.has(primitive)) primitiveCache.set(primitive, compileRecordedFingerMove(move, primitive));
  return primitiveCache.get(primitive)!;
}
function plain(moves: readonly Move[], upper: boolean) {
  const key = (upper ? "upper:" : "direct:") + text(moves);
  const existing = phraseCache.get(key); if (existing) return existing;
  const raw = upper ? compileFingerProgram(moves) : compileDirectFingerProgram(moves);
  const program = assembleFingerPrograms([raw], 5, true);
  phraseCache.set(key, program);
  if (phraseCache.size > 512) phraseCache.delete(phraseCache.keys().next().value!);
  return program;
}
function candidates(source: readonly Move[]): FingerProgram[][] {
  const moves = source.flatMap((move) => move.kind === "rotation" && move.face === "U"
    ? [move] : expandExecutionMoves([move]).moves);
  const blocks: FingerProgram[][] = [];
  for (let first = 0; first < moves.length;) {
    const move = moves[first], variants = getCompetitivePrimitives(move.notation);
    if (variants.length) {
      blocks.push(variants.map((primitive) => recorded(move, primitive))); first++; continue;
    }
    if (move.kind === "rotation") {
      // Existing calibrated x remains available to explicit study/import paths.
      blocks.push([compileRotationProgram(move)]); first++; continue;
    }
    const upper = ["U", "R", "L"].includes(move.face);
    let end = first + 1;
    while (end < moves.length && !moves[end].kind &&
      !getCompetitivePrimitives(moves[end].notation).length &&
      ["U", "R", "L"].includes(moves[end].face) === upper) end++;
    blocks.push([plain(moves.slice(first, end), upper)]); first = end;
  }
  return blocks;
}
function joinedCost(left: FingerProgram, right: FingerProgram) {
  if (!transitionCache.has(left)) transitionCache.set(left, new WeakMap());
  const cache = transitionCache.get(left)!;
  if (!cache.has(right)) cache.set(right, assembleFingerPrograms([left, right], 1, true).cost);
  return cache.get(right)!;
}

/** Choose calibrated finger variants by the cost of the complete joining path.
 * All candidates have the same low entry/exit. Eliminating a return affects
 * only PREPARE tails/heads, never a TURN, so adjacent savings compose without
 * introducing a new geometric trajectory or unmeasured intermediate pose.
 */
function chooseBlocks(source: readonly Move[]) {
  type Node = { program: FingerProgram; cost: number; previous: Node | null };
  let previous: Node[] = [];
  for (const choices of candidates(source)) {
    const next: Node[] = [];
    for (const program of choices) {
      let best: Node = { program, cost: program.cost, previous: null };
      if (previous.length) {
        best.cost = Infinity;
        for (const before of previous) {
          const cost = before.cost + joinedCost(before.program, program) - before.program.cost;
          if (cost < best.cost - 1e-9) best = { program, cost, previous: before };
        }
      }
      next.push(best);
    }
    previous = next;
  }
  previous.sort((a, b) => a.cost - b.cost);
  const best = previous[0], blocks: FingerProgram[] = [];
  for (let node: Node | null = best; node; node = node.previous) blocks.unshift(node.program);
  return { blocks, cost: best?.cost ?? 0 };
}

export function competitivePhraseCost(source: readonly Move[]) {
  return chooseBlocks(source).cost;
}
export function compileCompetitiveExecution(source: readonly Move[], duration = 5): JoinedProgram {
  const selected = chooseBlocks(source);
  const result = assembleFingerPrograms(selected.blocks, duration, true);
  if (Math.abs(result.cost - selected.cost) > 1e-7)
    throw new Error("连续指法成本与实际编排不一致。");
  return result;
}
export function planCompetitiveExecution(source: readonly Move[]) {
  const rotationCosts = new Map<1 | -1, number>();
  const costs = new Map<string, number>();
  return planYReorientations(source, {
    phraseCost: (moves) => {
      const key = text(moves);
      if (!costs.has(key)) costs.set(key, competitivePhraseCost(moves));
      return costs.get(key)!;
    },
    rotationCost: (direction) => {
      if (!rotationCosts.has(direction)) rotationCosts.set(direction,
        competitivePhraseCost([parseMove(direction === 1 ? "y" : "y'")]));
      return rotationCosts.get(direction)!;
    },
  });
}
