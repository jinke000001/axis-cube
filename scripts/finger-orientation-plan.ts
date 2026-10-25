/** Bounded four-x-orientation planning evidence; never changes application code. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Quaternion, Vector3 } from "three";
import { applyAlgorithm, FACES, NORMALS, parseAlgorithm, SLOTS, SOLVED, type Face, type Move } from "../src/core/cube";
import { compileFingerSolve } from "../src/scene/finger-solve-program";
import { compileRotationProgram } from "../src/scene/finger-rotation-program";

const arg=(name:string,fallback:string)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const width=Number(arg("--beam","2")),quickDivisions=Number(arg("--quick","8"));
const sourcePath="evidence/finger-solve-full.json",source=JSON.parse(readFileSync(sourcePath,"utf8"));
const study=source.studies.find((s:any)=>s.id==="demo-cfop"),original=parseAlgorithm(study.algorithm),phases=study.phases as {name:string;start:number;end:number}[];
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const sourceFiles=["src/scene/finger-solve-program.ts","src/scene/finger-rotation-program.ts","src/scene/finger-rotations.json","src/scene/finger-program.ts","src/scene/finger-face-program.ts","src/scene/finger-data.ts","src/scene/finger-library.json","src/scene/finger-paths.json","src/scene/finger-faces.json","src/core/cube.ts","src/core/execution-moves.ts","evidence/finger-whole-x-primitives.json"];
const sources=sourceFiles.map(path=>({path,sha256:sha(path)}));
const xAxis=new Vector3(1,0,0),upper=new Set<Face>(["U","R","L"]);
const mapping=Array.from({length:4},(_,orientation)=>Object.fromEntries(FACES.map(face=>{
  const world=new Vector3(...NORMALS[face]).applyAxisAngle(xAxis,-orientation*Math.PI/2);
  return [face,FACES.find(f=>NORMALS[f].every((n,i)=>n===Math.round(world.getComponent(i))))!];
})) as Record<Face,Face>);
function mapMove(move:Move,orientation:number) {
  if(move.kind)throw new Error("The comparison source must contain outer-face moves only.");
  return mapping[orientation][move.face]+move.notation.slice(1);
}
function turnTo(from:number,to:number) {
  const delta=(to-from+4)%4;
  return delta===0?[]:delta===1?["x"]:delta===2?["x","x"]:["x'"];
}
function pathLength(program:ReturnType<typeof compileFingerSolve>,divisions:number) {
  let left=0,right=0,largestSingleSegment=0;
  for(const segment of program.segments) {
    let prev=segment.sample(0),local=0;
    for(let i=1;i<=divisions;i++) {
      const next=segment.sample(i/divisions),dl=next.left.position.distanceTo(prev.left.position),dr=next.right.position.distanceTo(prev.right.position);
      left+=dl;right+=dr;local+=dl+dr;prev=next;
    }
    largestSingleSegment=Math.max(largestSingleSegment,local);
  }
  return {leftM:left,rightM:right,totalM:left+right,largestSingleSegmentM:largestSingleSegment};
}
type Measure={cost:number;quickPath?:number};
const measurements=new Map<string,Measure>();
function measure(algorithm:string,needPath:boolean):Measure {
  const cached=measurements.get(algorithm);if(cached&&(!needPath||cached.quickPath!==undefined))return cached;
  const program=compileFingerSolve(parseAlgorithm(algorithm)),result={cost:program.cost,quickPath:needPath?pathLength(program,quickDivisions).totalM:cached?.quickPath};
  measurements.set(algorithm,result);return result;
}
type Mode="cost"|"path"|"rul-min-rotations";
type Checkpoint={name:string;originalEnd:number;tokenEnd:number};
type State={orientation:number;tokens:string[];rotations:number;cost:number;quickPath:number;checkpoints:Checkpoint[];orientations:number[]};
function compare(a:State,b:State,mode:Mode) {
  const score=mode==="cost"?[a.cost-b.cost,a.rotations-b.rotations]:mode==="path"?[a.quickPath-b.quickPath,a.rotations-b.rotations,a.cost-b.cost]:[a.rotations-b.rotations,a.cost-b.cost];
  return score.find(n=>Math.abs(n)>1e-9)??a.tokens.join(" ").localeCompare(b.tokens.join(" "));
}
function search(mode:Mode) {
  let states:State[]=[{orientation:0,tokens:[],rotations:0,cost:0,quickPath:0,checkpoints:[],orientations:[]}];
  for(let i=0;i<original.length;i++) {
    const boundary=phases.find(p=>p.end===i+1),buckets=new Map<number,State[]>();
    for(const state of states)for(let orientation=0;orientation<4;orientation++) {
      const mapped=mapMove(original[i],orientation);
      if(mode==="rul-min-rotations"&&!upper.has(mapped[0] as Face))continue;
      const entry=turnTo(state.orientation,orientation),exit=boundary?turnTo(orientation,0):[],tokens=[...state.tokens,...entry,mapped,...exit];
      const metrics=measure(tokens.join(" "),mode==="path"),next:State={orientation:boundary?0:orientation,tokens,rotations:state.rotations+entry.length+exit.length,cost:metrics.cost,quickPath:metrics.quickPath??0,checkpoints:boundary?[...state.checkpoints,{name:boundary.name,originalEnd:i+1,tokenEnd:tokens.length}]:state.checkpoints,orientations:[...state.orientations,orientation]};
      const bucket=buckets.get(next.orientation)??[];bucket.push(next);buckets.set(next.orientation,bucket);
    }
    states=[...buckets.values()].flatMap(bucket=>{
      bucket.sort((a,b)=>compare(a,b,mode));const unique=new Map<string,State>();
      for(const state of bucket){const key=state.tokens.join(" ");if(!unique.has(key))unique.set(key,state);if(unique.size>=width)break;}
      return [...unique.values()];
    });
    if(boundary||i%12===11)console.log(JSON.stringify({mode,originalMoves:i+1,beamStates:states.length,bestCost:Math.min(...states.map(s=>s.cost)),fewestRotations:Math.min(...states.map(s=>s.rotations)),phase:boundary?.name}));
  }
  states.sort((a,b)=>compare(a,b,mode));return states[0];
}
// Independent sticker transport uses unique labels, physical coordinates, and
// Rodrigues quarter rotations; it does not call cube.ts applyMove for the plan.
const unique54="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01";
const slotIndex=new Map(SLOTS.map(s=>[`${s.position.join(",")}/${s.normal.join(",")}`,s.index]));
function independentApply(state:string,moves:readonly Move[]) {
  let labels=state.split("");
  for(const move of moves) {
    if(move.kind&&move.kind!=="rotation")throw new Error("This verifier covers outer faces and physical rotations.");
    const axis=new Vector3(...NORMALS[move.face]),layers=move.kind==="rotation"?[-1,0,1]:[1];
    for(let turn=0;turn<move.turns;turn++) {
      const next=labels.slice();
      for(const slot of SLOTS) {
        const p=new Vector3(...slot.position),n=new Vector3(...slot.normal);
        if(!layers.includes(Math.round(p.dot(axis))))continue;
        p.applyAxisAngle(axis,-Math.PI/2);n.applyAxisAngle(axis,-Math.PI/2);
        const a=p.toArray().map(Math.round),b=n.toArray().map(Math.round),index=slotIndex.get(`${a.join(",")}/${b.join(",")}`);
        if(index===undefined)throw new Error("Independent sticker geometry did not land in a slot.");next[index]=labels[slot.index];
      }
      labels=next;
    }
  }
  return labels.join("");
}
for(let o=0;o<4;o++)for(const face of FACES)for(const suffix of ["","'","2","2'"]) {
  const move=parseAlgorithm(face+suffix)[0],expanded=[...turnTo(0,o),mapMove(move,o),...turnTo(o,0)].join(" ");
  if(independentApply(unique54,parseAlgorithm(expanded))!==applyAlgorithm(unique54,[move]))throw new Error(`Bad 54-sticker conjugation ${expanded}`);
}
function analyze(id:string,algorithm:string,checkpoints:Checkpoint[],extra:Record<string,unknown>={}) {
  const moves=parseAlgorithm(algorithm),program=compileFingerSolve(moves),path64=pathLength(program,64),path128=pathLength(program,128);
  const directions=Object.fromEntries(FACES.map(f=>[f,0])),rotations={x:0,xPrime:0};
  for(const m of moves)if(m.kind==="rotation")rotations[m.notation==="x"?"x":"xPrime"]++;else directions[m.face]++;
  const checks=checkpoints.map(checkpoint=>{
    const planned=independentApply(unique54,moves.slice(0,checkpoint.tokenEnd)),expected=applyAlgorithm(unique54,original.slice(0,checkpoint.originalEnd));
    return {...checkpoint,equivalent54:planned===expected,canonicalCenters:[4,13,22,31,40,49].every(i=>planned[i]===expected[i])};
  });
  const equivalent54=independentApply(unique54,moves)===applyAlgorithm(unique54,original);
  const solvesOriginal=independentApply(study.sourceState??study.state,moves)===SOLVED;
  if(!equivalent54||!solvesOriginal||checks.some(c=>!c.equivalent54||!c.canonicalCenters))throw new Error(`Invalid orientation plan ${id}`);
  return {id,algorithm,...extra,cost:program.cost,executionMoves:moves.length,originalMoves:original.length,rotations,totalQuarterRotations:rotations.x+rotations.xPrime,directions,segments:program.segments.length,statistics:program.statistics,wristPath:path128,pathSamplingDifferenceM:Math.abs(path128.totalM-path64.totalM),checkpoints:checks,equivalent54,solvesOriginal};
}
function exactMinimumQuarterRotations() {
  let costs=[0,Infinity,Infinity,Infinity];
  for(let i=0;i<original.length;i++) {
    const next=[Infinity,Infinity,Infinity,Infinity],boundary=phases.some(p=>p.end===i+1);
    for(let from=0;from<4;from++)for(let to=0;to<4;to++)if(upper.has(mapping[to][original[i].face])) {
      const target=boundary?0:to,cost=costs[from]+turnTo(from,to).length+(boundary?turnTo(to,0).length:0);
      next[target]=Math.min(next[target],cost);
    }
    costs=next;
  }
  return costs[0];
}
const strictRulMinimumQuarterRotations=exactMinimumQuarterRotations();
const baseline=analyze("fixed-frame",study.algorithm,phases.map(p=>({name:p.name,originalEnd:p.end,tokenEnd:p.end})));
const xMetrics=["x","x'"].map(notation=>{const p=compileRotationProgram(parseAlgorithm(notation)[0]);return {notation,cost:p.cost,segments:p.segments.length,wristPath:pathLength(p,128)};});
const plans:any[]=[];
for(const mode of ["cost","path","rul-min-rotations"] as Mode[]) {
  const state=search(mode),plan=analyze(mode,state.tokens.join(" "),state.checkpoints,{beamWidthPerOrientation:width,rankingQuickSamplesPerSegment:quickDivisions+1,orientationBeforeEachOriginalMove:state.orientations});
  const comparison={costDelta:plan.cost-baseline.cost,costPercent:(plan.cost/baseline.cost-1)*100,pathDeltaM:plan.wristPath.totalM-baseline.wristPath.totalM,pathPercent:(plan.wristPath.totalM/baseline.wristPath.totalM-1)*100};
  plans.push({...plan,comparison});console.log(JSON.stringify({id:mode,cost:plan.cost,rotations:plan.totalQuarterRotations,directions:plan.directions,pathM:plan.wristPath.totalM,comparison}));
  writeFileSync("evidence/finger-orientation-plan-comparison.json",JSON.stringify({date:new Date().toISOString(),input:{path:sourcePath,sha256:sha(sourcePath),algorithm:study.algorithm,phases},sources,changedSources:sources.filter(s=>sha(s.path)!==s.sha256),mapping,xMetrics,strictRulMinimumQuarterRotations,baseline,plans,scope:"Planning only. Four physical x orientations; shortest verified x/x-prime quarter transitions; each CFOP stage ends at orientation0. Every prefix candidate is priced by the real compiler, including its actual hand-history and low resets. Beam pruning is bounded and not a global optimum claim. Path ranking uses actual compiler wrist positions at a coarse progress grid; final route lengths use128 subdivisions/segment and report64-to128 convergence.",limitations:["R/U/L alone are not claimed to solve arbitrary cube states. Explicit verified whole-cube x/x-prime moves change which original face is physically accessible.","Rewritten algorithms preserve every original face turn and its order; no move cancellation or unverified y/z primitive inflates the savings.","The 54-sticker equivalence test transports unique labels independently and checks every phase checkpoint and the complete solution.","No new mesh/collision or visual-fluidity claim is made for the whole planned sequence. Physical geometry still depends on consuming verified primitives and correct logical rebase."]},null,2)+"\n");
}
