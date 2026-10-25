import Cube from "cubejs";
import { applyAlgorithm, parseAlgorithm, SOLVED, validateFacelets } from "./cube";
import { solveCFOP } from "./cfop";
import { compileFingerSolve } from "../scene/finger-solve-program";
import type { SolveMethod } from "./solver";
import { solveCompetitiveCFOP } from "./competitive-cfop";
import { competitivePhraseCost, planCompetitiveExecution } from "../scene/competitive-program";
import { competitionVariant } from "./competition";
let initialized = false;
self.onmessage = (event: MessageEvent<{ id: number; state: string; method?: SolveMethod }>) => {
  const { id, state, method = "cfop" } = event.data;
  try {
    const validation = validateFacelets(state);
    if (!validation.valid) throw new Error(validation.message);
    const start = performance.now();
    if (method === "competitive") {
      self.postMessage({ id, phase: "planning" });
      const result = solveCompetitiveCFOP(state, { gestureCost: (algorithm) => competitivePhraseCost(parseAlgorithm(algorithm)) });
      self.postMessage({ id, phase: "choreographing" });
      const plan = planCompetitiveExecution(parseAlgorithm(result.solution));
      const competition = competitionVariant(state, result, plan);
      self.postMessage({ id, method, solution: result.solution, phases: competition.phases, competition,
        elapsed: performance.now() - start });
      return;
    }
    if (method === "cfop") {
      self.postMessage({ id, phase: "planning" });
      const result = solveCFOP(state, { gestureCost:(algorithm)=>compileFingerSolve(parseAlgorithm(algorithm)).cost });
      if (applyAlgorithm(state, result.solution) !== SOLVED)
        throw new Error("CFOP结果未通过独立校验。");
      self.postMessage({ id, solution: result.solution, phases: result.phases.map(({name, start, end}) => ({name, start, end})), method, elapsed: performance.now() - start });
      return;
    }
    if (state === SOLVED) {
      self.postMessage({ id, solution: "", method, elapsed: 0 });
      return;
    }
    if (!initialized) {
      self.postMessage({ id, phase: "preparing" });
      Cube.initSolver();
      initialized = true;
    }
    self.postMessage({ id, phase: "solving" });
    const solution = Cube.fromString(state).solve();
    if (applyAlgorithm(state, solution) !== SOLVED)
      throw new Error("求解结果未通过独立校验，请重试。");
    self.postMessage({ id, solution, method, elapsed: performance.now() - start });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "求解失败，请重试。",
    });
  }
};
