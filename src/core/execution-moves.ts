import { parseMove, type Face, type Move } from "./cube";

export interface ExecutionMoves {
  /** Actual state-changing steps; M/wide turns are explicit decompositions. */
  moves: Move[];
  /** Source step i occupies [boundaries[i], boundaries[i + 1]); includes the final boundary. */
  boundaries: number[];
  /** Source step owning each actual move. Length equals moves.length. */
  sourceIndices: number[];
}

const signedTurns = (move: Move) =>
  move.turns === 3
    ? -1
    : move.turns * (move.turns === 2 ? (move.direction ?? 1) : 1);
const token = (symbol: string, turns: number) =>
  symbol + (turns === 1 ? "" : turns === -1 ? "'" : turns === 2 ? "2" : "2'");
const selects = (move: Move, layers: readonly (-1 | 0 | 1)[]) => {
  const selected = move.layers ?? [1];
  return (
    selected.length === layers.length &&
    layers.every((layer) => selected.includes(layer))
  );
};

/**
 * Keep source indices stable while exposing every real execution step.
 * Outer turns pass through unchanged. M = x' R L', Rw = x L, Lw = x' R;
 * signed half turns retain their direction and x half turns use two quarters.
 * This proves state semantics only; the compiler must still require accepted
 * geometry for every emitted move. Adjacent moves are never merged/cancelled.
 */
export function expandExecutionMoves(source: readonly Move[]): ExecutionMoves {
  const moves: Move[] = [],
    boundaries = [0],
    sourceIndices: number[] = [];
  const outer = (face: Face, turns: number) =>
    moves.push(parseMove(token(face, turns)));
  const rotation = (turns: number) => {
    for (let i = 0; i < Math.abs(turns); i++)
      moves.push(parseMove(token("x", Math.sign(turns))));
  };
  source.forEach((move, sourceIndex) => {
    const start = moves.length,
      turns = signedTurns(move);
    if (!move.kind && selects(move, [1])) moves.push(move);
    else if (
      move.kind === "rotation" &&
      move.face === "R" &&
      selects(move, [-1, 0, 1])
    )
      rotation(turns);
    else if (move.kind === "slice" && move.face === "L" && selects(move, [0])) {
      rotation(-turns);
      outer("R", turns);
      outer("L", -turns);
    } else if (
      move.kind === "wide" &&
      selects(move, [0, 1]) &&
      (move.face === "R" || move.face === "L")
    ) {
      rotation(move.face === "R" ? turns : -turns);
      outer(move.face === "R" ? "L" : "R", turns);
    } else
      throw new Error(`动作 ${move.notation} 的执行路径尚未校准，暂不能播放。`);
    for (let i = start; i < moves.length; i++) sourceIndices.push(sourceIndex);
    boundaries.push(moves.length);
  });
  return { moves, boundaries, sourceIndices };
}
