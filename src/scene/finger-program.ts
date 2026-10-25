import { Quaternion, Vector3 } from "three";
import { moveAngle, type Move } from "../core/cube";
import { CENTER, smooth, type HandPose, type MotionFrame, type Side } from "./motion";
import type { FingerContact } from "./finger-contact";
import type { FingerIndex } from "./finger-rig";
import type { PlaybackProgram, PlaybackStep } from "./playback";
import { blendFingerPose, clonePose, fingerContacts, fingerLibrary, handPose, oppositeHand,
  rotatedFingerPose, sampledPose, strokeSample, withFinger, type PoseData } from "./finger-data";
import pathData from "./finger-paths.json";

export interface FingerPaths {
  /** Each path goes from a low support grip to the high FREE pose. */
  roles: Record<Side, PoseData[][]>;
  strokes: Record<string, { prepare: PoseData[][]; release: PoseData[][]; overlapTurn?: PoseData[]; overlapRelease?: PoseData[][] }>;
}
export const fingerPaths = pathData as unknown as FingerPaths;
interface ScorePose { left: HandPose; right: HandPose; contacts: FingerContact[]; angle: number; }
export interface FingerSegment {
  index: number; start: number; duration: number; stage: string; phase: string;
  active: Side | null; finger?: FingerIndex; sample: (p: number) => ScorePose;
}
export interface FingerProgram extends PlaybackProgram {
  /** Relative duration before fitting the score to the presentation clock. */
  cost: number;
  segments: readonly FingerSegment[];
  statistics: { fingerTurns: number; wristTurns: number; retainedWrists: number; regrips: number; reorientations: number };
}
interface HandState { pose: HandPose; contacts: FingerContact[]; mode: "low" | "high" | "grip" | "carry"; angle: number; }
const xAxis = new Vector3(1,0,0), yAxis = new Vector3(0,1,0);
const sideName = (s: Side) => s === "left" ? "左" : "右";

/**
 * Compile a phrase into a history-independent score. Calibration supplies the
 * actual fingers/contacts; this layer only schedules and joins accepted paths.
 * The complete joined score has a separate mesh/continuity acceptance pass.
 */
export function compileFingerProgram(moves: readonly Move[], paths: FingerPaths=fingerPaths, duration=5): FingerProgram {
  if (moves.some((m) => m.kind || !["U","R","L"].includes(m.face))) throw new Error("当前指法片段包含尚未编排的访问姿态。");
  const hands: Record<Side, HandState> = {
    left:{pose:handPose(fingerLibrary.hands.left.support),contacts:fingerContacts("left",fingerLibrary.hands.left.contacts),mode:"low",angle:0},
    right:{pose:handPose(fingerLibrary.hands.right.support),contacts:fingerContacts("right",fingerLibrary.hands.right.contacts),mode:"low",angle:0},
  };
  const segments: FingerSegment[] = [], steps: PlaybackStep[] = [];
  const statistics = {fingerTurns:0,wristTurns:0,retainedWrists:0,regrips:0,reorientations:0};
  let total=0, index=0, angle=0;
  const poses=():ScorePose=>({left:clonePose(hands.left.pose),right:clonePose(hands.right.pose),contacts:[...hands.left.contacts,...hands.right.contacts],angle});
  function add(stage:string,phase:string,weight:number,active:Side|null,sampler:(p:number)=>ScorePose,finger?:FingerIndex) {
    const segment:FingerSegment={index,start:total,duration:weight,stage,phase,active,finger,sample:sampler};
    segments.push(segment); total+=weight;
    const end=sampler(1); hands.left.pose=clonePose(end.left);hands.right.pose=clonePose(end.right);
  }
  function travel(side:Side, target:HandPose, phase:string, weight=.28) {
    const from=clonePose(hands[side].pose), other=oppositeHand(side), fixed=clonePose(hands[other].pose), contacts=hands[other].contacts.slice(), heldAngle=angle;
    add("PREPARE",phase,weight,side,(p)=>({[side]:blendFingerPose(from,target,smooth(p)),[other]:clonePose(fixed),contacts,angle:heldAngle}) as unknown as ScorePose);
    hands[side].contacts=[];
  }
  function path(side:Side, frames:readonly PoseData[], phase:string, weight=.3, reverse=false) {
    const other=oppositeHand(side), fixed=clonePose(hands[other].pose), contacts=hands[other].contacts.slice(), heldAngle=angle;
    add("PREPARE",phase,weight,side,(p)=>({[side]:sampledPose(frames,reverse?1-smooth(p):smooth(p)),[other]:clonePose(fixed),contacts,angle:heldAngle}) as unknown as ScorePose);
    hands[side].contacts=[];
  }
  function pathGroup(side:Side, groups:readonly PoseData[][], phase:string, weight=.3, reverse=false) {
    for(const frames of reverse?[...groups].reverse():groups)path(side,frames,phase,weight/groups.length,reverse);
  }
  function restoreCarry(side:Side) {
    if(hands[side].mode!=="carry")return;
    const carry=fingerLibrary.carries[side];
    path(side,carry.relocation,`${sideName(side)}食指回接`,.15,true);
    path(side,carry.withdrawal,`${sideName(side)}拇指接握`,.12,true);
    hands[side].contacts=fingerContacts(side,fingerLibrary.hands[side].gripContacts,"support",new Quaternion().setFromAxisAngle(xAxis,hands[side].angle));
    hands[side].mode="grip";
  }
  function low(side:Side) {
    const hand=hands[side];if(hand.mode==="low")return;
    restoreCarry(side);
    if(hand.mode==="high")pathGroup(side,paths.roles[side],`${sideName(side)}手回接`,.48,true);
    else if(Math.abs(hand.angle)<1e-6)travel(side,handPose(fingerLibrary.hands[side].support),`${sideName(side)}指放松承托`,.2);
    else {
      statistics.regrips++;
      const sign=side==="left"?-1:1, outside=clonePose(hand.pose);
      outside.position.x+=sign*.065;
      travel(side,outside,`${sideName(side)}手退出`,.18);
      const ready=handPose(fingerLibrary.hands[side].support);ready.position.x+=sign*.065;
      travel(side,ready,`${sideName(side)}腕顺势回握`,.42);
      travel(side,handPose(fingerLibrary.hands[side].support),`${sideName(side)}手接握`,.18);
    }
    hand.contacts=fingerContacts(side,fingerLibrary.hands[side].contacts);hand.mode="low";hand.angle=0;
  }
  function grip(side:Side) {
    const hand=hands[side];restoreCarry(side);
    if(hand.mode==="grip")return;
    low(side);
    travel(side,handPose(fingerLibrary.hands[side].grip),`${sideName(side)}手准备腕转`,.23);
    hand.mode="grip";hand.contacts=fingerContacts(side,fingerLibrary.hands[side].gripContacts);
  }
  function high(side:Side) {
    if(hands[side].mode==="high")return;
    low(side);
    pathGroup(side,paths.roles[side],`${sideName(side)}指到位`,.48);
    hands[side].mode="high";
  }
  function prepareCarry(side:Side) {
    if(hands[side].mode==="carry")return;
    const hand=hands[side],carry=fingerLibrary.carries[side];
    if(hand.mode!=="grip"||Math.abs(hand.angle-carry.angle)>1e-6)throw new Error("腕姿态不满足承接条件。");
    path(side,carry.withdrawal,`${sideName(side)}拇指让开上层`,.12);
    path(side,carry.relocation,`${sideName(side)}食指调整支点`,.15);
    hand.mode="carry";hand.contacts=fingerContacts(side,carry.contacts);statistics.retainedWrists++;
  }
  function upper(move:Move):Side {
    const natural:Side=moveAngle(move)<0?"right":"left";
    const carrier=(["left","right"] as Side[]).find((side)=>["grip","carry"].includes(hands[side].mode)&&Math.abs(hands[side].angle+Math.PI/2)<1e-6);
    const active=carrier?oppositeHand(carrier):natural, support=oppositeHand(active);
    if(carrier) { low(active);prepareCarry(carrier); }
    else {
      // A free high hand must land before the current supporting hand can lift.
      if(hands[support].mode==="high")low(support);
      if(hands[support].mode!=="low") {low(active);low(support);}
    }
    high(active);
    const quarterCount=move.turns===2?2:1;
    for(let q=0;q<quarterCount;q++) {
      const finger=(q===0?2:3) as FingerIndex, id=`${active}-${finger===2?"index":"middle"}`;
      const stroke=fingerLibrary.strokes[id], record=paths.strokes[id];
      const reverse=Math.sign(moveAngle(move))!==Math.sign(stroke.samples.at(-1)!.angle);
      const overlap=quarterCount===2&&!reverse;
      pathGroup(active,reverse?record.release:overlap&&q===1?record.prepare.slice(-1):record.prepare,`${sideName(active)}${finger===2?"食指":"中指"}预备`,overlap&&q===1?.07:.22,reverse);
      const base=clonePose(hands[active].pose), fixed=clonePose(hands[support].pose), contacts=hands[support].contacts.slice(), offset=angle;
      const start=stroke.samples[reverse?stroke.samples.length-1:0], initialAngle=start.angle;
      const materialPoint=new Vector3().fromArray(start.target).sub(CENTER).applyAxisAngle(yAxis,-offset);
      add("TURN",`${sideName(active)}${finger===2?"食指":"中指"}${reverse?"推":"拨"}层`,1,active,(p)=>{
        const sample=strokeSample(stroke,reverse?1-smooth(p):smooth(p));
        const drive:FingerContact={side:active,finger,role:"drive",point:materialPoint,normal:yAxis.clone(),padOffset:sample.padOffset};
        const pose=overlap&&q===0&&record.overlapTurn?sampledPose(record.overlapTurn,smooth(p)):withFinger(base,active,finger,sample.angles);
        return {[active]:pose,[support]:clonePose(fixed),angle:offset+sample.angle-initialAngle,contacts:[...contacts,drive]} as unknown as ScorePose;
      },finger);
      angle=offset+(reverse?-1:1)*stroke.samples.at(-1)!.angle;
      statistics.fingerTurns++;
      pathGroup(active,reverse?record.prepare:overlap&&q===0&&record.overlapRelease?record.overlapRelease:record.release,`${sideName(active)}${finger===2?"食指":"中指"}退出`,.2,reverse);
    }
    return active;
  }
  function wrist(move:Move):Side {
    const active:Side=move.face==="R"?"right":"left",other=oppositeHand(active);
    if(hands[other].mode==="high")low(other);
    grip(active);
    const delta=moveAngle(move)*(active==="right"?1:-1);
    if(Math.abs(hands[active].angle+delta)>Math.PI+1e-6) {low(active);grip(active);}
    const before=hands[active].angle, after=before+delta, basis=handPose(fingerLibrary.hands[active].grip), fixed=clonePose(hands[other].pose);
    const contacts=[...hands[other].contacts,...fingerContacts(active,fingerLibrary.hands[active].gripContacts,"drive",new Quaternion().setFromAxisAngle(xAxis,before))];
    add("TURN",`${sideName(active)}腕${Math.abs(delta)>2?"连续转半圈":"转层"}`,Math.abs(delta)>2?1.65:1.1,active,(p)=>({[active]:rotatedFingerPose(basis,new Quaternion().setFromAxisAngle(xAxis,before+delta*smooth(p))),[other]:clonePose(fixed),contacts,angle:moveAngle(move)*smooth(p)}) as unknown as ScorePose);
    hands[active].angle=after;hands[active].mode="grip";
    hands[active].contacts=fingerContacts(active,fingerLibrary.hands[active].gripContacts,"support",new Quaternion().setFromAxisAngle(xAxis,after));
    angle=moveAngle(move);statistics.wristTurns++;
    return active;
  }
  for(index=0;index<moves.length;index++) {
    angle=0;const start=total,move=moves[index];
    const active=move.face==="U"?upper(move):wrist(move);
    steps.push({move,start,duration:total-start,active});
  }
  // Both hands finish in the same readable home pose, once per phrase.
  if(moves.length) {
    index=moves.length-1;angle=moveAngle(moves[index]);
    if(hands.left.mode==="high")low("left");
    if(hands.right.mode==="high")low("right");
    low("left");low("right");
    const held=poses();add("HOLD","稳持完成",.28,null,()=>held);
    steps.at(-1)!.duration=total-steps.at(-1)!.start;
  }
  const last=poses(),scale=total?duration/total:1;
  for(const s of segments) {s.start*=scale;s.duration*=scale;}
  for(const s of steps) {s.start*=scale;s.duration*=scale;}
  const sample=(time:number):MotionFrame=>{
    const complete=!moves.length||time>=duration;
    let lo=0,hi=segments.length-1;
    while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(segments[mid].start<=time)lo=mid;else hi=mid-1;}
    const segment=segments[lo],p=segment?Math.max(0,Math.min(1,(time-segment.start)/segment.duration)):1;
    const state=complete?last:segment.sample(p),active=complete?null:segment.active;
    return {index:complete?moves.length:segment.index,phase:complete?"稳持完成":segment.phase,stage:complete?"HOLD":segment.stage,
      angle:complete?0:state.angle,orientation:new Quaternion(),left:clonePose(state.left),right:clonePose(state.right),contacts:state.contacts,
      active,support:active?oppositeHand(active):"left",activeFinger:segment?.finger,progress:p,complete};
  };
  return {steps,segments,duration:total?duration:0,cost:total,sample,statistics};
}
