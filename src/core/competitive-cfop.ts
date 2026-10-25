import { applyAlgorithm, parseAlgorithm, SOLVED, validateFacelets } from "./cube";
import { CFOP_PHASES, isCFOPPhaseSolved, solveCFOPCandidate, type CFOPPhase, type CFOPOptions } from "./cfop";

export interface CompetitiveCFOPResult {
  solution: string;
  phases: CFOPPhase[];
  cost: number;
  /** Bounded search diagnostics, not a claim of global optimality. */
  search: { beamWidth: number; expanded: number; frames: number[] };
}

/**
 * Retain alternative completed states at each CFOP stage. Choosing a cross
 * need not also commit to that candidate's F2L/OLL/PLL. All resulting stage
 * boundaries are checked independently against real cube state, and the
 * original CFOP solver remains unchanged for the comparison mode.
 */
export function solveCompetitiveCFOP(facelets: string, options: CFOPOptions = {}): CompetitiveCFOPResult {
  const validation = validateFacelets(facelets);
  if (!validation.valid) throw new Error(validation.message);
  const score = (algorithm: string) => {
    const cost = options.gestureCost ? options.gestureCost(algorithm) : parseAlgorithm(algorithm).length;
    if (!Number.isFinite(cost) || cost < 0) throw new Error("竞速指法成本无效。");
    return cost;
  };
  const beamWidth = 6;
  let expanded = 0;
  type Candidate = { solution: string; phases: CFOPPhase[]; state: string; cost: number; frames: number[] };
  let beam: Candidate[] = [{ solution: "", phases: [], state: facelets, cost: 0, frames: [] }];
  for (const name of CFOP_PHASES) {
    const next: Candidate[] = [];
    for (const before of beam) for (let yaw = 0; yaw < 4; yaw++) {
      const candidate = solveCFOPCandidate(before.state, yaw), phase = candidate.phases.find((phase) => phase.name === name)!;
      expanded++;
      // The reusable stage must really start at this node, not at a state
      // reached by silently replaying earlier stages of the candidate solve.
      const earlier = candidate.phases.slice(0, candidate.phases.indexOf(phase)).map((phase) => phase.algorithm).join(" ");
      if (applyAlgorithm(before.state, earlier) !== before.state) continue;
      const state = applyAlgorithm(before.state, phase.algorithm);
      if (!isCFOPPhaseSolved(state, name)) continue;
      const start = parseAlgorithm(before.solution).length, shift = start - phase.start;
      const copied = { ...phase, start, end: phase.end + shift,
        segments: phase.segments.map((segment) => ({ ...segment, start: segment.start + shift, end: segment.end + shift })),
      };
      const solution = [before.solution, phase.algorithm].filter(Boolean).join(" ");
      next.push({ solution, state, cost: score(solution), phases: [...before.phases, copied], frames: [...before.frames, yaw] });
    }
    next.sort((a, b) => a.cost - b.cost || parseAlgorithm(a.solution).length - parseAlgorithm(b.solution).length || a.solution.localeCompare(b.solution));
    const seen = new Set<string>();
    beam = next.filter((candidate) => {
      // Keep distinct endings for the same cube state, since the final grip
      // and next phase can make a different ending faster to join.
      const ending = parseAlgorithm(candidate.solution).slice(-2).map((move) => move.notation).join(" ");
      const key = candidate.state + "|" + ending;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, beamWidth);
    if (!beam.length) throw new Error(`竞速${name}阶段没有通过独立局面验证的路径。`);
  }
  const best = beam[0];
  const moves = parseAlgorithm(best.solution);
  let cost = best.cost;
  if (options.gestureCost) for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 0; i < moves.length; i++) if (moves[i].turns === 2) {
      const previous = moves[i];
      moves[i] = parseAlgorithm(previous.face + (previous.direction === -1 ? "2" : "2'"))[0];
      const value = score(moves.map((move) => move.notation).join(" "));
      if (value < cost - 1e-9) { cost = value; changed = true; } else moves[i] = previous;
    }
    if (!changed) break;
  }
  const solution = moves.map((move) => move.notation).join(" ");
  const phases = best.phases.map((phase) => ({ ...phase,
    algorithm: moves.slice(phase.start, phase.end).map((move) => move.notation).join(" "),
    segments: phase.segments.map((segment) => ({ ...segment,
      algorithm: moves.slice(segment.start, segment.end).map((move) => move.notation).join(" "),
    })),
  }));
  if (applyAlgorithm(facelets, solution) !== SOLVED || phases.some((phase) =>
    !isCFOPPhaseSolved(applyAlgorithm(facelets, moves.slice(0, phase.end).map((move) => move.notation).join(" ")), phase.name)))
    throw new Error("竞速编排未通过最终局面校验。");
  return { solution, phases, cost, search: { beamWidth, expanded, frames: best.frames } };
}
