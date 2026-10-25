/** Timing-only experiment: every emitted pose is sampled from the original accepted path. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { compileFingerSolve } from "../src/scene/finger-solve-program";
import { parseAlgorithm, applyAlgorithm, SOLVED } from "../src/core/cube";
import type { FingerProgram, FingerSegment } from "../src/scene/finger-program";
import type { HandPose } from "../src/scene/motion";

const divisionArgument=process.argv.indexOf('--divisions');
const duration=5, divisions=divisionArgument>=0?Number(process.argv[divisionArgument+1]):512, ramp=.15, turnFloor=2.05/60;
if(!Number.isInteger(divisions)||divisions<16)throw new Error('Invalid arc lookup resolution');
const outputStem=divisions===512?'evidence/finger-cadence-probe':`evidence/finger-cadence-probe-${divisions}`;
const sourcePaths=[
  "src/scene/finger-solve-program.ts","src/scene/finger-program.ts","src/scene/finger-face-program.ts",
  "src/scene/finger-rotation-program.ts","src/scene/finger-data.ts","src/scene/finger-library.json",
  "src/scene/finger-paths.json","src/scene/finger-faces.json","src/scene/finger-rotations.json",
  "src/core/execution-moves.ts","evidence/finger-solve-full.json","evidence/real-photo-session.json",
];
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const sources=sourcePaths.map(path=>({path,sha256:sha(path)}));
type Pose=ReturnType<FingerSegment['sample']>;
interface Arc { cumulative:number[];length:number;wristLength:number; }
interface TimedSegment { source:FingerSegment;arc:Arc;start:number;duration:number; }
type Variant="baseline"|"arc-original-budget"|"arc-length-budget"|"arc-turn-floor";
const variants:Variant[]=["baseline","arc-original-budget","arc-length-budget","arc-turn-floor"];
const quantile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
const median=(values:number[])=>{const a=[...values].sort((a,b)=>a-b),i=(a.length-1)/2;return(a[Math.floor(i)]+a[Math.ceil(i)])/2;};

function handDistance(a:HandPose,b:HandPose) {
  const joint=Math.max(0,...Object.keys(a.joints??{}).map(k=>Math.abs(a.joints![k]-b.joints![k])));
  return a.position.distanceTo(b.position)+.07*a.quaternion.angleTo(b.quaternion)+.025*joint;
}
function buildArc(segment:FingerSegment):Arc {
  const cumulative=[0];let previous=segment.sample(0),wristLength=0;
  for(let i=1;i<=divisions;i++) {
    const pose=segment.sample(i/divisions),wrist=Math.max(pose.left.position.distanceTo(previous.left.position),pose.right.position.distanceTo(previous.right.position));
    wristLength+=wrist;
    const metric=Math.max(handDistance(previous.left,pose.left),handDistance(previous.right,pose.right),.045*Math.abs(pose.angle-previous.angle));
    cumulative.push(cumulative.at(-1)!+metric);previous=pose;
  }
  return {cumulative,length:cumulative.at(-1)!,wristLength};
}

/** Integral of quintic smoothstep velocity: acceleration/deceleration each occupy 15%. */
function travelled(t:number) {
  if(t<=0)return 0;if(t>=1)return 1;
  const integral=(u:number)=>u**6-3*u**5+2.5*u**4;
  if(t<ramp)return ramp*integral(t/ramp)/(1-ramp);
  if(t>1-ramp)return 1-ramp*integral((1-t)/ramp)/(1-ramp);
  return (t-ramp/2)/(1-ramp);
}
function sourceProgress(arc:Arc,t:number) {
  if(t<=0)return 0;if(t>=1)return 1;
  if(arc.length<1e-12)return t;
  const distance=travelled(t)*arc.length;
  let lo=0,hi=arc.cumulative.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(arc.cumulative[mid]<=distance)lo=mid;else hi=mid;}
  const length=arc.cumulative[hi]-arc.cumulative[lo];
  return (lo+(length>0?(distance-arc.cumulative[lo])/length:0))/divisions;
}

function allocate(program:FingerProgram,arcs:Arc[],variant:Variant):TimedSegment[] {
  let times:number[];
  if(variant==='baseline'||variant==='arc-original-budget')times=program.segments.map(s=>s.duration);
  else {
    // Holds keep a positive duration but get no invented travelling distance.
    const weights=arcs.map(a=>Math.max(a.length,1e-5));
    const lower=program.segments.map(s=>variant==='arc-turn-floor'&&s.stage==='TURN'?turnFloor:1e-6);
    if(lower.reduce((a,b)=>a+b,0)>=duration)throw new Error("Requested TURN floor cannot fit the five-second score");
    let lo=0,hi=duration/Math.min(...weights);
    for(let i=0;i<80;i++) {
      const scale=(lo+hi)/2,sum=weights.reduce((n,w,j)=>n+Math.max(lower[j],scale*w),0);
      if(sum>duration)hi=scale;else lo=scale;
    }
    times=weights.map((w,i)=>Math.max(lower[i],lo*w));
  }
  let time=0;
  return program.segments.map((source,i)=>{
    const span=i===program.segments.length-1?duration-time:times[i],record={source,arc:arcs[i],start:time,duration:span};time+=span;return record;
  });
}

function sample(program:FingerProgram,timeline:TimedSegment[],variant:Variant,time:number) {
  if(time>=duration)return {pose:program.sample(duration),segmentIndex:timeline.length-1,p:1,complete:true};
  let lo=0,hi=timeline.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(timeline[mid].start<=time)lo=mid;else hi=mid-1;}
  const segment=timeline[lo],t=Math.max(0,Math.min(1,(time-segment.start)/segment.duration));
  const p=variant==='baseline'?t:sourceProgress(segment.arc,t);
  return {pose:segment.source.sample(p),segmentIndex:lo,p,complete:false};
}

function poseDifference(a:Pose,b:Pose) {
  let position=0,quaternion=0,joints=0;
  for(const side of ['left','right'] as const) {
    position=Math.max(position,a[side].position.distanceTo(b[side].position));
    quaternion=Math.max(quaternion,a[side].quaternion.angleTo(b[side].quaternion));
    for(const key of Object.keys(a[side].joints??{}))joints=Math.max(joints,Math.abs(a[side].joints![key]-b[side].joints![key]));
  }
  let contactError=0;
  if(a.contacts.length!==b.contacts.length)contactError=Infinity;
  else a.contacts.forEach((c,i)=>{const d=b.contacts[i];
    if(c.side!==d.side||c.finger!==d.finger||c.role!==d.role)contactError=Infinity;
    contactError=Math.max(contactError,c.point.distanceTo(d.point),c.normal.distanceTo(d.normal),c.padOffset.distanceTo(d.padOffset));
  });
  return {position,quaternion,joints,angle:Math.abs(a.angle-b.angle),contactError};
}
function verifyMapping(program:FingerProgram,timeline:TimedSegment[],variant:Variant) {
  const maximum={position:0,quaternion:0,joints:0,angle:0,contactError:0};
  let checked=0;const failures:unknown[]=[];
  timeline.forEach((record,segmentIndex)=>{
    const map=(t:number)=>variant==='baseline'?t:sourceProgress(record.arc,t);
    if(map(0)!==0||map(1)!==1)failures.push({segmentIndex,reason:'endpoints'});
    let previous=-Infinity;
    for(let j=0;j<=64;j++) {
      const p=map(j/64);
      if(p<previous||p<0||p>1)failures.push({segmentIndex,reason:'monotonic',j,p,previous});previous=p;
      const exact=record.source.sample(p);
      // Compare against the public original sampler away from committing a step.
      if(p>1e-6&&p<1-1e-6) {
        const original=program.sample(record.source.start+record.source.duration*p);
        const difference=poseDifference(exact,original);checked++;
        for(const key of Object.keys(maximum) as (keyof typeof maximum)[])maximum[key]=Math.max(maximum[key],difference[key]);
        if(difference.position>1e-8||difference.quaternion>2e-7||difference.joints>1e-7||difference.angle>1e-7||difference.contactError>1e-8)
          failures.push({segmentIndex,j,p,difference});
      }
    }
  });
  const final=sample(program,timeline,variant,duration);
  if(!final.complete||(final.pose as ReturnType<FingerProgram['sample']>).index!==program.steps.length)failures.push({reason:'terminal state'});
  return {passed:!failures.length,checkedPublicSamples:checked,maximum,failures:failures.slice(0,8)};
}

function metrics(program:FingerProgram,timeline:TimedSegment[],variant:Variant,hz:number,offset=0) {
  const turns=timeline.flatMap((s,i)=>s.source.stage==='TURN'?[i]:[]),counts=new Map(turns.map(i=>[i,0]));
  const wrist:number[]=[],left:number[]=[],right:number[]=[],angles:number[]=[];
  let previous:Pose|undefined;
  for(let k=0;k<=Math.ceil(duration*hz-offset);k++) {
    const time=Math.min(duration,(k+offset)/hz),frame=sample(program,timeline,variant,time),pose=frame.pose;
    if(!frame.complete&&timeline[frame.segmentIndex].source.stage==='TURN'&&frame.p>1e-8&&frame.p<1-1e-8)counts.set(frame.segmentIndex,counts.get(frame.segmentIndex)!+1);
    if(previous){
      const l=pose.left.position.distanceTo(previous.left.position)*1000,r=pose.right.position.distanceTo(previous.right.position)*1000;
      left.push(l);right.push(r);wrist.push(Math.max(l,r));
      angles.push(Math.max(pose.left.quaternion.angleTo(previous.left.quaternion),pose.right.quaternion.angleTo(previous.right.quaternion))*180/Math.PI);
    }
    previous=pose;
  }
  const values=turns.map(i=>counts.get(i)!);
  return {hz,framePhaseOffset:offset,turnSegments:turns.length,minTurnFrames:Math.min(...values),medianTurnFrames:median(values),zeroFrameTurns:values.filter(n=>n===0).length,oneFrameTurns:values.filter(n=>n===1).length,
    wristFrameMM:{max:Math.max(...wrist),p90:quantile(wrist,.9),mean:wrist.reduce((a,b)=>a+b,0)/wrist.length,leftMax:Math.max(...left),rightMax:Math.max(...right)},wristFrameDegrees:{max:Math.max(...angles),p90:quantile(angles,.9)},
    turnFrames:turns.map((i,j)=>({segmentIndex:i,stepIndex:timeline[i].source.index,move:program.steps[timeline[i].source.index].move.notation,phase:timeline[i].source.phase,durationMS:timeline[i].duration*1000,frames:values[j]}))};
}

const full=JSON.parse(readFileSync("evidence/finger-solve-full.json","utf8")).studies.find((s:{id:string})=>s.id==='demo-cfop');
const photo=JSON.parse(readFileSync("evidence/real-photo-session.json","utf8"));
const cases=[{id:'fixed-cfop66',algorithm:full.algorithm,state:full.sourceState},{id:'photo-short21',algorithm:photo.solution,state:photo.facelets}];
const results=cases.map(c=>{
  const program=compileFingerSolve(parseAlgorithm(c.algorithm),duration),arcStarted=performance.now(),arcs=program.segments.map(buildArc),arcBuildMS=performance.now()-arcStarted;
  const result={...c,solved:applyAlgorithm(c.state,c.algorithm)===SOLVED,moves:program.steps.length,segments:program.segments.length,cost:program.cost,
    arcBuildMS,totalWristPathM:arcs.reduce((n,a)=>n+a.wristLength,0),totalMetricPathM:arcs.reduce((n,a)=>n+a.length,0),variants:variants.map(variant=>{
      const allocationStarted=performance.now(),timeline=allocate(program,arcs,variant),allocationMS=performance.now()-allocationStarted,validation=verifyMapping(program,timeline,variant);
      const byHz=[60,120].map(hz=>metrics(program,timeline,variant,hz));
      const offsets=[.25,.5,.75].map(offset=>metrics(program,timeline,variant,60,offset));
      const turnTime=timeline.filter(s=>s.source.stage==='TURN').reduce((n,s)=>n+s.duration,0);
      return {id:variant,allocationMS,turnTimeSeconds:turnTime,segmentsUnderOne60HzFrame:timeline.filter(s=>s.duration<1/60).length,validation,byHz,
        phaseSensitivity60Hz:offsets.map(m=>({offset:m.framePhaseOffset,minTurnFrames:m.minTurnFrames,zeroFrameTurns:m.zeroFrameTurns,oneFrameTurns:m.oneFrameTurns,wristMaxMM:m.wristFrameMM.max,wristP90MM:m.wristFrameMM.p90})),
        timeline:timeline.map((s,i)=>({segmentIndex:i,index:s.source.index,phase:s.source.phase,stage:s.source.stage,start:s.start,duration:s.duration,metricLengthM:s.arc.length,wristPathM:s.arc.wristLength}))};
    })};
  for(const v of result.variants)console.log(JSON.stringify({case:c.id,variant:v.id,turnTime:v.turnTimeSeconds,valid:v.validation.passed,Hz60:{...v.byHz[0],turnFrames:undefined},Hz120:{...v.byHz[1],turnFrames:undefined}}));
  return result;
});
const changedSources=sources.filter(s=>sha(s.path)!==s.sha256);
const output={date:new Date().toISOString(),durationSeconds:duration,divisions,rampFraction:ramp,turnFloorSeconds:turnFloor,metric:"max over hands(position distance + wrist angle*0.07m + largest joint delta*0.025m), also bounded below by abs cube angle delta*0.045m",sources,changedSources,scriptSHA256:sha("scripts/finger-cadence-probe.ts"),passed:!changedSources.length&&results.every(r=>r.solved&&r.variants.every(v=>v.validation.passed)),results,
  limitations:["Only time changes: all pose/contact/angle values are produced by each original source segment.sample(p). No geometry or collision threshold is changed.","512-node accumulated metric gives a numerical inverse parameterization, not an analytic all-joint jerk bound.","A smooth velocity law in accumulated pose distance has zero endpoint speed; it does not prove physical torque, force closure or human-like motion.","Fixed 60/120Hz sampling estimates temporal resolution, not observed browser frame rate or perceptual acceptance.","The 21-move legacy photo starts from a different cube state; it is a presentation-load control, not an identical-state solver comparison."]};
writeFileSync(outputStem+'.json',JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({output:outputStem+'.json',passed:output.passed,changedSources}));
if(!output.passed)process.exitCode=1;
