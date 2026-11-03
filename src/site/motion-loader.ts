import { parseAlgorithm, parseMove, type Move } from "../core/cube";
import { expandExecutionMoves } from "../core/execution-moves";
import { retimeFingerProgram } from "../scene/finger-cadence";
import type { FingerProgram } from "../scene/finger-program";

function supported(move: Move) {
  if (!move.kind) return true;
  if (move.kind === "rotation") return move.face === "R" || move.face === "U";
  if (move.kind === "wide") return move.face === "R" || move.face === "L";
  return move.kind === "slice" && move.face === "L";
}
export function canShowMechanicalHands(algorithm: string): boolean {
  try { return parseAlgorithm(algorithm).every(supported); } catch { return false; }
}
export interface MechanicalTimeline {
  program: FingerProgram;
  sourceMoves: Move[];
  /** Original logical step i starts at execution step sourceBoundaries[i]. Includes the end. */
  sourceBoundaries: number[];
  /** Seconds after cadence retiming, never an approximation based on playback percentage. */
  sourceTimes: number[];
}
export function expandMechanicalSource(source: readonly Move[]) {
  if (!source.every(supported)) throw new Error("这一情形包含尚未提供双手演示的换向，请使用魔方视图跟做。");
  const moves: Move[] = [], boundaries = [0];
  source.forEach(move => {
    if (move.kind === "rotation" && move.face === "U") {
      const count = move.turns === 2 ? 2 : 1;
      const negative = move.turns === 3 || move.direction === -1;
      for (let i = 0; i < count; i++) moves.push(parseMove(negative ? "y'" : "y"));
    } else moves.push(...expandExecutionMoves([move]).moves);
    boundaries.push(moves.length);
  });
  return { moves, boundaries };
}
export function completedMechanicalSourceStep(timeline: Pick<MechanicalTimeline, "sourceBoundaries">, executionStep: number): number {
  let completed = 0;
  for (let i = 1; i < timeline.sourceBoundaries.length; i++) {
    if (timeline.sourceBoundaries[i] > executionStep) break;
    completed = i;
  }
  return completed;
}
const cache = new Map<string, Promise<MechanicalTimeline>>();
export function loadMechanicalTimeline(algorithm: string, duration: number, competitive = false): Promise<MechanicalTimeline> {
  const key = `${algorithm}\n${duration}\n${competitive}`;
  const cached = cache.get(key); if (cached) return cached;
  const pending = compileTimeline(algorithm, duration, competitive).catch(error => { cache.delete(key); throw error; });
  cache.set(key, pending);
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return pending;
}
async function compileTimeline(algorithm: string, duration: number, competitive: boolean): Promise<MechanicalTimeline> {
  const sourceMoves = parseAlgorithm(algorithm), expanded = expandMechanicalSource(sourceMoves), moves = expanded.moves;
  let raw: FingerProgram;
  if (competitive || moves.some(move => move.kind === "rotation" && move.face === "U")) {
    const { compileCompetitiveExecution } = await import("../scene/competitive-program");
    raw = compileCompetitiveExecution(moves, duration);
  } else if (moves.every(move => !move.kind && ["U", "R", "L"].includes(move.face))) {
    const { compileFingerProgram } = await import("../scene/finger-program");
    raw = compileFingerProgram(moves, undefined, duration);
  } else {
    const { compileFingerSolve } = await import("../scene/finger-solve-program");
    raw = compileFingerSolve(moves, duration);
  }
  const program = retimeFingerProgram(raw);
  if (program.steps.length !== moves.length || program.steps.some((step, index) => step.move.notation !== moves[index].notation)) {
    throw new Error("机械动作与原始公式的步骤未能对应，请使用魔方演示。");
  }
  const sourceTimes = expanded.boundaries.map(index => index === program.steps.length ? program.duration : program.steps[index].start);
  return { program, sourceMoves, sourceBoundaries: expanded.boundaries, sourceTimes };
}
/** Existing consumers keep receiving just the deterministic playback program. */
export async function loadMechanicalProgram(algorithm: string, duration: number, competitive = false) {
  return (await loadMechanicalTimeline(algorithm, duration, competitive)).program;
}
