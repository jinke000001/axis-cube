import { applyAlgorithm, applyMove, parseAlgorithm, SOLVED, snapshots } from "./cube";
import { CFOP_PHASES, isCFOPPhaseSolved, type CFOPPhaseName } from "./cfop-state";
import { moveAtYaw, type ReorientationPlan } from "./reorientation-plan";

export interface CompetitionPhase { name: CFOPPhaseName; start: number; end: number; }
/** A second presentation of the same input. The original solution is retained. */
export interface CompetitionVariant {
  version: 1;
  solution: string;
  phases: CompetitionPhase[];
  execution: { algorithm: string; boundaries: number[] };
}
export type PresentationMode = "cfop" | "competitive";

export function readCompetitionVariant(facelets: string, value: unknown): CompetitionVariant {
  const variant = value as Partial<CompetitionVariant> | null;
  if (!variant || variant.version !== 1 || typeof variant.solution !== "string" || variant.solution.length > 1500 ||
    applyAlgorithm(facelets, variant.solution) !== SOLVED)
    throw new Error("竞速解法与输入局面不一致。");
  const source = parseAlgorithm(variant.solution), states = snapshots(facelets, source);
  if (source.some((move) => move.kind) || !Array.isArray(variant.phases) || variant.phases.length !== 4)
    throw new Error("竞速CFOP阶段不完整。");
  let boundary = 0;
  const phases = variant.phases.map((phase, index) => {
    if (!phase || phase.name !== CFOP_PHASES[index] || phase.start !== boundary ||
      !Number.isInteger(phase.end) || phase.end < phase.start || phase.end > source.length ||
      !isCFOPPhaseSolved(states[phase.end], phase.name)) throw new Error("竞速阶段与局面不一致。");
    boundary = phase.end; return { name: phase.name, start: phase.start, end: phase.end };
  });
  if (boundary !== source.length) throw new Error("竞速阶段没有覆盖完整解法。");
  const execution = variant.execution;
  if (!execution || typeof execution.algorithm !== "string" || execution.algorithm.length > 1500 ||
    !Array.isArray(execution.boundaries) || execution.boundaries.length !== source.length + 1)
    throw new Error("竞速执行记录不完整。");
  const moves = parseAlgorithm(execution.algorithm), boundaries = execution.boundaries.slice();
  if (boundaries[0] !== 0 || boundaries.at(-1) !== moves.length || boundaries.some((at, i) =>
    !Number.isInteger(at) || at < 0 || at > moves.length || (i > 0 && at <= boundaries[i - 1])))
    throw new Error("竞速执行步骤对应关系无效。");
  let state = facelets, yaw = 0;
  for (let index = 0; index < source.length; index++) {
    let outerTurns = 0;
    for (let at = boundaries[index]; at < boundaries[index + 1]; at++) {
      const move = moves[at];
      if (move.kind === "rotation" && (move.notation === "y" || move.notation === "y'"))
        yaw = (yaw + (move.turns === 3 ? 3 : 1)) % 4;
      else {
        if (move.kind || ++outerTurns !== 1 || move.notation !== moveAtYaw(source[index], yaw).notation)
          throw new Error("竞速换面后的转层与原解法不一致。");
      }
      state = applyMove(state, move);
    }
    if (outerTurns !== 1) throw new Error("竞速执行遗漏了转层。");
    const expected = applyAlgorithm(states[index + 1], Array.from({ length: yaw }, () => "y").join(" "));
    if (state !== expected) throw new Error("竞速执行边界未通过独立局面校验。");
  }
  if (yaw !== 0 || state !== SOLVED || (!source.length && moves.length))
    throw new Error("竞速执行没有还原并恢复中心朝向。");
  return { version: 1, solution: variant.solution, phases, execution: { algorithm: execution.algorithm, boundaries } };
}

export function competitionVariant(
  facelets: string, source: { solution: string; phases: CompetitionPhase[] }, plan: ReorientationPlan,
) {
  return readCompetitionVariant(facelets, { version: 1, solution: source.solution,
    phases: source.phases.map(({ name, start, end }) => ({ name, start, end })),
    execution: { algorithm: plan.moves.map((move) => move.notation).join(" "), boundaries: plan.boundaries },
  });
}
