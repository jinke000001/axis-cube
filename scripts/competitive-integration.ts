import { writeFileSync } from "node:fs";
import { applyAlgorithm, parseAlgorithm, SOLVED } from "../src/core/cube";
import { solveCFOP } from "../src/core/cfop";
import { solveCompetitiveCFOP } from "../src/core/competitive-cfop";
import { competitionVariant } from "../src/core/competition";
import { compileFingerSolve } from "../src/scene/finger-solve-program";
import { compileCompetitiveExecution, competitivePhraseCost, planCompetitiveExecution } from "../src/scene/competitive-program";
import { retimeFingerProgram } from "../src/scene/finger-cadence";
import type { FingerProgram } from "../src/scene/finger-program";

const state = applyAlgorithm(SOLVED,"R U2 F' L D B2 R' F2 U L2 D' B R2 U' F");
const start = performance.now();
const baseline = solveCFOP(state,{gestureCost:(algorithm)=>compileFingerSolve(parseAlgorithm(algorithm)).cost});
const baselineDone = performance.now();
const source = solveCompetitiveCFOP(state,{gestureCost:(algorithm)=>competitivePhraseCost(parseAlgorithm(algorithm))});
const sourceDone = performance.now();
const plan = planCompetitiveExecution(parseAlgorithm(source.solution));
const planDone = performance.now();
const program = retimeFingerProgram(compileCompetitiveExecution(plan.moves));
const variant = competitionVariant(state,source,plan);
function metrics(program:FingerProgram) {
 let wristMM=0;
 for(const segment of program.segments) {
  let before=segment.sample(0);
  for(let i=1;i<=64;i++) {const after=segment.sample(i/64);wristMM+=1000*(before.left.position.distanceTo(after.left.position)+before.right.position.distanceTo(after.right.position));before=after;}
 }
 return {wristMM,segments:program.segments.length,cost:program.cost,fingers:[...new Set(program.segments.map(s=>s.finger).filter(Boolean))].sort(),duration:program.duration};
}
const output={timingMS:{baseline:baselineDone-start,source:sourceDone-baselineDone,planning:planDone-sourceDone},
 baseline:{solution:baseline.solution,...metrics(compileFingerSolve(parseAlgorithm(baseline.solution)))},
 competitive:{variant,search:source.search,rotationCount:plan.rotationCount,...metrics(program)},
 sameSourceBaseline:metrics(compileFingerSolve(parseAlgorithm(source.solution))),
 sameSourceFixed:metrics(compileCompetitiveExecution(parseAlgorithm(source.solution))),
};
writeFileSync("evidence/competitive-integration.json",JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({...output,competitive:{...output.competitive,variant:undefined}},null,2));
