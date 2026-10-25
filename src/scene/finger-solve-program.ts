import type { Move } from "../core/cube";
import { compileFingerProgram, type FingerProgram } from "./finger-program";
import { compileFaceProgram } from "./finger-face-program";
import { compileRotationProgram } from "./finger-rotation-program";
import { expandExecutionMoves } from "../core/execution-moves";
import { compileDirectFingerProgram, hasDirectFingerPath } from "./finger-direct-program";

/** Compile the complete solve, retaining grip within each continuous phrase. */
export function compileFingerSolve(source:readonly Move[],duration=5):FingerProgram {
  const {moves}=expandExecutionMoves(source);
  if(!moves.length)return compileFingerProgram([]);
  const blocks:{program:FingerProgram;first:number;start:number;duration:number}[]=[];
  for(let first=0;first<moves.length;) {
    if(moves[first].kind==='rotation') {
      const program=compileRotationProgram(moves[first]);
      blocks.push({program,first,start:0,duration:program.cost});first++;continue;
    }
    const family=(move:Move)=>hasDirectFingerPath(move)?'finger':['U','R','L'].includes(move.face)?'upper':'wrist';
    const kind=family(moves[first]);let end=first+1;
    while(end<moves.length&&!moves[end].kind&&family(moves[end])===kind)end++;
    const group=moves.slice(first,end),program=kind==='finger'?compileDirectFingerProgram(group):kind==='upper'?compileFingerProgram(group):compileFaceProgram(group);
    blocks.push({program,first,start:0,duration:program.cost});first=end;
  }
  const cost=blocks.reduce((sum,b)=>sum+b.duration,0),scale=duration/cost;
  let time=0;
  for(const block of blocks){block.start=time;block.duration*=scale;time+=block.duration;}
  const steps=blocks.flatMap((b)=>b.program.steps.map((step)=>({...step,start:b.start+step.start/b.program.duration*b.duration,duration:step.duration/b.program.duration*b.duration})));
  const segments=blocks.flatMap((b)=>b.program.segments.map((s)=>({...s,index:s.index+b.first,start:b.start+s.start/b.program.duration*b.duration,duration:s.duration/b.program.duration*b.duration})));
  const statistics=blocks.reduce((sum,b)=>{
    for(const key of Object.keys(sum) as (keyof typeof sum)[])sum[key]+=b.program.statistics[key];return sum;
  },{fingerTurns:0,wristTurns:0,retainedWrists:0,regrips:0,reorientations:0});
  const sample=(time:number)=>{
    if(time>=duration){
      const last=blocks.at(-1)!;
      return {...last.program.sample(last.program.duration),index:moves.length,complete:true};
    }
    let lo=0,hi=blocks.length-1;
    while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(blocks[mid].start<=time)lo=mid;else hi=mid-1;}
    const block=blocks[lo],local=Math.max(0,Math.min(block.program.duration,(time-block.start)/block.duration*block.program.duration));
    const frame=block.program.sample(local);
    return {...frame,index:frame.index+block.first,complete:false};
  };
  return {steps,segments,cost,duration,sample,statistics};
}
