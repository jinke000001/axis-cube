import { Quaternion, Vector3 } from 'three';
import { applyMove, moveAffects, moveAngle, NORMALS, SLOTS, type Move, type Vec3 } from '../core/cube';
import type { FormulaRecord, TeachingFinger, TeachingHand } from './types';
import { fitPalmTargets,FINGER_BASES } from './rig-spec';
import { fingerLengths, fingerPadRadius, mirroredRest } from './hand-model';
import { authoredIdleWaits,authoredReleaseRetirements,authoredSupportPlacements,authoredExternalReceptions,authoredFlickTransitions,authoredCornerReceptions,type AuthoredSupportPlacement,type AuthoredExternalReception,type AuthoredFlickTransition,type AuthoredCornerReception,authoredRelayYields,type AuthoredRelayYield,authoredSupportClearances,type AuthoredSupportClearance,authoredIdleParking,type AuthoredIdleParking,authoredJointReceptions,type AuthoredJointReception,authoredPreclearances,type AuthoredPreclearance,authoredUnderReceptions,type AuthoredUnderReception,authoredExternalPreforms,type AuthoredExternalPreform,authoredGripTemplates,type AuthoredGripTemplate,authoredQuarterClearances,type AuthoredQuarterClearance,authoredSupportedRelays,type AuthoredSupportedRelay,authoredGripRecoveries,type AuthoredGripRecovery,authoredRetirementYields,type AuthoredRetirementYield } from './authored-grips';

/** All coordinates are cube-local metres, before the current SOURCE move. */
export const TEACHING_CUBE_SIZE = .09;
const padOf = (finger: TeachingFinger) => fingerPadRadius(finger);
const reachOf = (finger: TeachingFinger) => fingerLengths(finger).reduce((sum, length) => sum + length, 0);
/** Middle-finger pad, kept for callers that only need one reference radius. Contact placement uses padOf. */
export const TIP_RADIUS = fingerPadRadius('middle');
export const FINGER_NAMES: TeachingFinger[] = ['thumb','index','middle','ring','little'];
export const HANDS: TeachingHand[] = ['left','right'];
const H = TEACHING_CUBE_SIZE / 2;
const P = TEACHING_CUBE_SIZE / 3;
const V = (p: readonly number[]) => new Vector3().fromArray(p);
const A = (v: Vector3) => v.toArray() as Vec3;
const smooth = (x: number) => { x = Math.max(0, Math.min(1,x)); return x*x*x*(x*(x*6-15)+10); };
const stableCost=(a:number,b:number)=>Math.round(a*1e7)-Math.round(b*1e7);
const opposite = (h: TeachingHand): TeachingHand => h === 'left' ? 'right' : 'left';
const fingerZh = {thumb:'拇指',index:'食指',middle:'中指',ring:'无名指',little:'小指'};
export const fingerLabel = (h: TeachingHand, f: TeachingFinger) => `${h === 'left' ? '左' : '右'}${fingerZh[f]}`;

export interface TeachingContact {
  hand: TeachingHand;
  finger: TeachingFinger;
  role: 'drive' | 'support';
  cubie: Vec3;
  /** Surface point relative to its own cubie's centre. */
  local: Vec3;
  normal: Vec3;
  /** Drive contacts rotate with the selected layer; supports do not. */
  rotating: boolean;
  /** The distal phalanx approaches a D-ring pad from below the cube. */
  distalAway?:Vec3;
  /** An authored receiving route; ordinary transfers keep their chosen path. */
  arrivalPath?:'normal';
  /** Position-only toolpath guide while off the cube; never physical support. */
  positionOnly?:boolean;
}
export interface TipPose { point: Vec3; normal: Vec3; resting?:boolean }
export interface TeachingHandPose {
  palm: Vec3;
  rotation: [number,number,number,number];
  tips: Record<TeachingFinger, TipPose>;
}
export type TeachingPose = Record<TeachingHand, TeachingHandPose>;
export interface TeachingSegment {
  start: number;
  duration: number;
  step: number;
  phase: 'prepare' | 'contact' | 'drive' | 'release' | 'handoff';
  instruction: string;
  hand: TeachingHand;
  finger: TeachingFinger;
  from: TeachingPose;
  to: TeachingPose;
  contacts: TeachingContact[];
  /** Pad toolpaths approaching a receiver; not yet physical support. */
  padGuides?: TeachingContact[];
  angleFrom: number;
  angleTo: number;
  wristHands?: TeachingHand[];
  /** Empty hand changes wrist orientation with its fingers folded together. */
  regripHands?: TeachingHand[];
}
export interface TeachingMotionStep {
  index: number;
  move: Move;
  group: number;
  start: number;
  end: number;
  driver: {hand: TeachingHand;finger: TeachingFinger};
  segments: number[];
  gripNotes?:string[];
}
export interface TeachingMotion {
  formulaId: string;
  initialState: string;
  states: string[];
  steps: TeachingMotionStep[];
  segments: TeachingSegment[];
  boundaries: TeachingPose[];
  finalContacts:TeachingContact[];
  duration: number;
  /** Local finger-shape waiting, without claiming physical support. */
  idleWaits?:{sourceStep:number;hand:TeachingHand;finger:TeachingFinger;start:number;end:number;approachEnd:number;reason:string}[];
  /** Empty-hand clearance and receiving order; these do not claim contact. */
  externalReceptions?:(AuthoredExternalReception&{waitStart:number;start:number;withdrawn:number;unfolded:number;returned:number;approachEnd:number})[];
  flickTransitions?:(AuthoredFlickTransition&{sourceStep:number})[];
  idleParking?:(AuthoredIdleParking&{start:number;end:number;referenceDuration:number})[];
  referenceEdit?:'idle-parking'|'preclearance'|'under-reception'|'external-preform'|'grip-template'|'supported-relay'|'relay-passage'|'grip-recovery'|'retirement-yield';
  retirementYields?:(AuthoredRetirementYield&{start:number;lifted:number;yielded:number;retired:number;unturned:number;via:number;end:number;referenceEnd:number})[];
  gripRecoveries?:(AuthoredGripRecovery&{returnStart:number;returnEnd:number;start:number;ready:number;finished:number;end:number;referenceEnd:number;originalStart:number;originalEnd:number;supportStart:number;supportRestore:number})[];
  supportedRelays?:(AuthoredSupportedRelay&{start:number;ready:number;yieldStart:number;lifted:number;yielded:number;arrived:number;refolded:number;restored:number;restore:number;end:number;referencePrepareStart:number;referencePrepareEnd:number;referenceRestore:number})[];
  quarterClearances?:AuthoredQuarterClearance[];
  gripTemplates?:(AuthoredGripTemplate&{start:number;ready:number;finished:number;end:number;referenceEnd:number;templateStart:number;templateEnd:number})[];
  externalPreforms?:(AuthoredExternalPreform&{start:number;withdrawn:number;preformed:number;replayed:number;end:number;referenceEnd:number})[];
  underReceptions?:(AuthoredUnderReception&{start:number;routeStart:number;landed:number;end:number;referenceEnd:number;points:Vec3[];breaks:number[];normals:[Vec3,Vec3]})[];
  preclearances?:(AuthoredPreclearance&{start:number;cleared:number;end:number;referenceEnd:number})[];
  jointReceptions?:(AuthoredJointReception&{start:number;end:number})[];
  /** Offline-only original timeline; never fetched or consulted by playback. */
  authoringReference?:TeachingMotion;
  /** Optional second same-build reference; offline only, never a prior JSON. */
  authoringAlternate?:TeachingMotion;
  supportClearances?:(AuthoredSupportClearance&{start:number;ready:number;restore:number;end:number})[];
  relayYields?:(AuthoredRelayYield&{start:number;lifted:number;yielded:number;arrived:number;refolded:number;end:number;referenceEnd?:number})[];
  cornerReceptions?:(AuthoredCornerReception&{start:number;corner:number;outside:number;end:number})[];
}
export interface TeachingFrame {
  motionId?:string;
  time?:number;
  state: string;
  step: number;
  completed: number;
  move?: Move;
  angle: number;
  pose: TeachingPose;
  contacts: TeachingContact[];
  phase: string;
  instruction: string;
  finger: string;
  complete: boolean;
  activeHand?: TeachingHand;
  activeFinger?: TeachingFinger;
}
const compiledMotions=new Map<string,TeachingMotion>();
export const getCompiledTeachingMotion=(id:string)=>compiledMotions.get(id);
export const getCompiledTeachingMotionIds=()=>[...compiledMotions.keys()];
/** Synchronous offline reference authoring has its own lookup identity. */
export function withAuthoringMotionReference<T>(reference:TeachingMotion,run:()=>T):T {
  if(typeof window!=='undefined')throw new Error('浏览器不能生成参考轨迹');
  const prior=compiledMotions.get(reference.formulaId);compiledMotions.set(reference.formulaId,reference);
  try{return run();}finally{if(prior)compiledMotions.set(reference.formulaId,prior);else compiledMotions.delete(reference.formulaId);}
}

const copyPose = (pose: TeachingPose): TeachingPose => structuredClone(pose);
function restingTip(hand:TeachingHand,finger:TeachingFinger,pose:TeachingPose):TipPose {
  const sign=hand==='right'?1:-1,q=new Quaternion().fromArray(pose[hand].rotation);
  return {point:A(new Vector3().fromArray(mirroredRest(hand,finger)).applyQuaternion(q).add(V(pose[hand].palm))),
    normal:A(new Vector3(sign,0,0).applyQuaternion(q)),resting:true};
}
function neutralPose(): TeachingPose {
  return Object.fromEntries(HANDS.map(hand => {
    const sign = hand === 'right' ? 1 : -1;
    const palm: Vec3 = [sign * .152, -.004, 0];
    return [hand, {palm, rotation:[0,0,0,1], tips: Object.fromEntries(FINGER_NAMES.map(finger => {
      const local = mirroredRest(hand, finger);
      return [finger, {point: A(new Vector3(local[0] + palm[0], local[1] + palm[1], local[2] + palm[2])), normal: A(new Vector3(sign, 0, 0)), resting: true}];
    }))}];
  })) as TeachingPose;
}
export function contactPoint(contact: TeachingContact, move?: Move, angle=0): TipPose {
  const p = V(contact.cubie).multiplyScalar(P).add(V(contact.local));
  const n = V(contact.normal);
  if (contact.rotating && move) {
    const q = new Quaternion().setFromAxisAngle(V(NORMALS[move.face]),angle);
    p.applyQuaternion(q); n.applyQuaternion(q);
  }
  return {point:A(p),normal:A(n)};
}
function setTip(pose: TeachingPose, contact: TeachingContact, move: Move, angle: number, clearance=0) {
  const target = contactPoint(contact, move, angle);
  target.point = A(V(target.point).addScaledVector(V(target.normal),padOf(contact.finger)+clearance));
  pose[contact.hand].tips[contact.finger] = target;
}
function anchor(slot: typeof SLOTS[number], hand: TeachingHand, finger: TeachingFinger, rotating: boolean,
  move?: Move, angle=0): TeachingContact {
  const p = V(slot.position).multiplyScalar(P).addScaledVector(V(slot.normal),H-P);
  const q = new Quaternion().setFromAxisAngle(move ? V(NORMALS[move.face]) : new Vector3(0,1,0),-angle);
  const c = V(slot.position).applyQuaternion(q);
  const n = V(slot.normal).applyQuaternion(q);
  const point = p.applyQuaternion(q);
  const cubie = A(c).map(x=>Math.round(x)) as Vec3;
  return {hand,finger,role:rotating?'drive':'support',cubie,
    local:A(point.sub(V(cubie).multiplyScalar(P))),normal:A(n),rotating};
}
function chooseDriver(record: FormulaRecord, i: number,pose?:TeachingPose) {
  const {move,hint} = record.steps[i];
  let hand: TeachingHand;
  let finger: TeachingFinger;
  if (move.kind === 'slice') { hand='right'; finger=moveAngle(move)>0?'ring':'middle'; }
  else if (move.face === 'U') { hand=moveAngle(move)<0?'right':'left'; finger='index'; }
  else if (move.face === 'D') { hand=moveAngle(move)<0?'left':'right'; finger='ring'; }
  else if (move.face === 'L') { hand='left'; finger='index'; }
  else if (move.face === 'R') { hand='right'; finger='index'; }
  else if (move.face === 'F') { hand=moveAngle(move)<0?'right':'left'; finger=hand==='right'?'thumb':'index'; }
  else { hand=moveAngle(move)<0?'right':'left'; finger='index'; }
  // Leave the index available for an adjacent U flick. The middle pad can
  // oppose the thumb during an unmarked outer wrist grip without a reset.
  if(!hint&&move.kind!=='wide'&&(move.face==='R'||move.face==='L')
    &&[record.steps[i-1],record.steps[i+1]].some(step=>step?.move.face==='U'
      &&(step.hint?.hand??(moveAngle(step.move)<0?'right':'left'))===hand))finger='middle';
  if (hint?.hand) hand=hint.hand;
  if (hint) finger=hint.finger;
  const authoredRelay=authoredSupportedRelays(record.id).find(item=>item.sourceStep===i);
  if(authoredRelay) hand=authoredRelay.hand;
  // Repeated printed U′ U′ are separate strokes. Re-use the specified hand,
  // but let an unmarked second flick use the next finger without a wrist reset.
  if (!hint && i>0 && record.steps[i-1].move.notation === move.notation && move.face==='U'
      && record.steps[i-1].group===record.steps[i].group && move.turns!==2) finger='middle';
  if(pose&&!hint?.hand&&!authoredRelay&&move.face==='U'&&move.kind!=='wide') {
    const comfort=(side:TeachingHand)=> {
      const contact=driveAnchor(move,side,finger,0,undefined,pose),base=FINGER_BASES[finger],sign=side==='right'?1:-1;
      const origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(new Quaternion().fromArray(pose[side].rotation)).add(V(pose[side].palm));
      let nearest=Infinity,farthest=0;
      for(let sample=0;sample<=8;sample++) {
        const tip=contactPoint(contact,move,moveAngle(move)*sample/8),point=V(tip.point).addScaledVector(V(tip.normal),padOf(finger)),distance=origin.distanceTo(point);
        nearest=Math.min(nearest,distance);farthest=Math.max(farthest,distance);
      }
      const limit=reachOf(finger)-.004;
      return {nearest,farthest,score:Math.max(0,.045-nearest)*3+Math.max(0,farthest-limit)*4};
    };
    const current=comfort(hand),other=comfort(opposite(hand));
    if(current.nearest<.036&&other.score+.003<current.score)hand=opposite(hand);
  }
  return {hand,finger};
}
function driveAnchor(move: Move, hand: TeachingHand, finger: TeachingFinger, angle: number, layer?: number, pose?:TeachingPose): TeachingContact {
  const direction=Math.sign(moveAngle(move)), axis=V(NORMALS[move.face]);
  const sign=hand==='right'?1:-1;
  // A SIDE face is pushed, never the broad face parallel to the turning axis.
  // Positive work (inward normal · tangential velocity) excludes rubbing paths.
  const origin=pose?new Vector3(sign*FINGER_BASES[finger][0],FINGER_BASES[finger][1],FINGER_BASES[finger][2])
    .applyQuaternion(new Quaternion().fromArray(pose[hand].rotation)).add(V(pose[hand].palm)):undefined;
  const candidates=SLOTS.filter(slot => moveAffects(move,slot.position)
    && (layer===undefined || Math.round(V(slot.position).dot(axis))===layer)
    && Math.abs(V(slot.normal).dot(axis))<.01)
    .map(slot=> {
      const p=V(slot.position).multiplyScalar(P).addScaledVector(V(slot.normal),H-P);
      const velocity=axis.clone().cross(p).multiplyScalar(direction).normalize();
      const work=V(slot.normal).negate().dot(velocity);
      const n=V(slot.normal);
      const preference=move.kind==='slice'?(direction>0?new Vector3(0,-.047,.03):new Vector3(0,-.03,.047))
        :finger==='thumb'?new Vector3(sign*.03,-.025,.047)
        :finger==='ring'?new Vector3(sign*.018,-.035,-.038):new Vector3(sign*.03,.032,-.047);
      const q=new Quaternion().setFromAxisAngle(axis,direction*Math.PI/2);
      const end=p.clone().applyQuaternion(q);
      const reach=Math.max(0,-sign*end.x)*1.8;
      const normalPenalty=(finger==='thumb'?Math.max(0,-n.z):Math.max(0,n.z))*.018;
      const previous=pose?V(pose[hand].tips[finger].point):preference;
      let maximumReach=0;
      if(origin)for(let sample=0;sample<=8;sample++) {
        const turn=new Quaternion().setFromAxisAngle(axis,direction*Math.PI*.5*sample/8);
        const pad=p.clone().addScaledVector(n,padOf(finger)).applyQuaternion(turn);
        maximumReach=Math.max(maximumReach,origin.distanceTo(pad));
      }
      return {slot,work,maximumReach,cost:p.distanceTo(preference)*.4+p.distanceTo(previous)*.6+reach+normalPenalty};
    }).filter(x=>x.work>.35).sort((a,b)=>stableCost(a.cost,b.cost));
  if (!candidates.length) throw new Error(`没有可推动的侧面接触：${move.notation}`);
  const usable=candidates.filter(candidate=>candidate.maximumReach<=reachOf(finger)-.002);
  const selected=usable[0]??[...candidates].sort((a,b)=>stableCost(a.maximumReach,b.maximumReach)||stableCost(a.cost,b.cost))[0];
  const contact=anchor(selected.slot,hand,finger,true,move,angle);
  if(move.face==='D'&&finger==='ring')contact.distalAway=[0,-1,0];
  return contact;
}
function supportAnchors(move: Move, active: TeachingHand, driver: TeachingFinger,nextMove?:Move,pose?:TeachingPose,held:TeachingContact[]=[],authored:readonly AuthoredSupportPlacement[]=[]): TeachingContact[] {
  if (move.kind==='rotation') {
    return HANDS.flatMap(hand=>[
      anchor(SLOTS.find(s=>s.face==='F' && s.position[0]===(hand==='right'?1:-1) && s.position[1]===0)!,hand,'thumb',true),
      anchor(SLOTS.find(s=>s.face==='B' && s.position[0]===(hand==='right'?1:-1) && s.position[1]===0)!,hand,'index',true),
    ]);
  }
  const supporters: TeachingContact[]=[];
  for (const hand of [opposite(active),active]) {
    const sign=hand==='right'?1:-1;
    const twisted=pose&&new Quaternion().fromArray(pose[hand].rotation).angleTo(new Quaternion())>.7;
    const fingers: TeachingFinger[]=hand===active?(move.face==='D'&&driver==='ring'?['thumb','middle']:twisted?[]:['thumb']):['thumb','index'];
    for (const finger of fingers) {
      if (hand===active && (finger===driver || move.kind==='wide' || move.face==='R'||move.face==='L')) continue;
      const rotation=new Quaternion().fromArray(pose?.[hand].rotation??[0,0,0,1]);
      const base=FINGER_BASES[finger],origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(rotation).add(V(pose?.[hand].palm??[sign*.09,-.004,0]));
      const placement=authored.find(item=>item.hand===hand&&item.finger===finger);
      if(placement) {
        const slot=SLOTS.find(slot=>slot.face===placement.face&&slot.position.every((value,i)=>value===placement.cubie[i]));
        if(!slot||moveAffects(move,slot.position))throw new Error('编排的支撑必须落在不转动的实际块面');
        const contact=anchor(slot,hand,finger,false);
        if(placement.arrivalPath)contact.arrivalPath=placement.arrivalPath;
        if(occupiedPad(contact,supporters).length)throw new Error('编排的承托位置与另一根支撑指重叠');
        supporters.push(contact);continue;
      }
      const existing=held.find(c=>c.hand===hand&&c.finger===finger&&!moveAffects(move,c.cubie)
        &&!(hand!==active&&nextMove&&moveAffects(nextMove,c.cubie))
        &&!supporters.some(other=>other.hand===hand&&V(other.normal).dot(V(c.normal))>.95)
        &&!occupiedPad(c,supporters).length
        &&origin.distanceTo(V(contactPoint(c).point).addScaledVector(V(c.normal),padOf(finger)))<=reachOf(finger)-.002);
      if(existing){supporters.push({...existing,role:'support',rotating:false});continue;}
      const preferred=finger==='thumb'?new Vector3(sign*.03,-.015,.045):finger==='index'
        ?new Vector3(sign*.03,.018,-.045):new Vector3(sign*.03,0,-.045);
      if(!(move.face==='D'&&finger==='middle'))preferred.applyQuaternion(rotation);
      const desired=pose&&!pose[hand].tips[finger].resting?V(pose[hand].tips[finger].point).lerp(preferred,.35):preferred;
      const slots=SLOTS.filter(s=>!moveAffects(move,s.position))
        .filter(s=>!occupiedPad(anchor(s,hand,finger,false),supporters).length)
        .filter(s=>!supporters.some(other=>other.hand===hand&&V(other.normal).dot(V(s.normal))>.95))
        .filter(s=> !supporters.some(c=>c.hand===hand && c.cubie.every((x,i)=>x===s.position[i])))
        .map(slot=> {
          const p=V(slot.position).multiplyScalar(P).addScaledVector(V(slot.normal),H-P);
          return {slot,cost:p.distanceTo(desired)+Math.max(0,.045-p.distanceTo(origin))*2+(Math.max(0,-sign*p.x)*3)+(hand!==active&&nextMove&&moveAffects(nextMove,slot.position)?.04:0)};
        }).sort((a,b)=>stableCost(a.cost,b.cost));
      if (slots[0]) supporters.push(anchor(slots[0].slot,hand,finger,false));
    }
  }
  return supporters;
}
function hasHoldingDirections(contacts:TeachingContact[]) {
  return contacts.some((first,index)=>contacts.slice(index+1).some(second=>V(first.normal).dot(V(second.normal))<.95));
}
function sameDigit(a:Pick<TeachingContact,'hand'|'finger'>,b:Pick<TeachingContact,'hand'|'finger'>) {
  return a.hand===b.hand&&a.finger===b.finger;
}
function occupiedPad(target:TeachingContact,held:TeachingContact[]) {
  const point=V(contactPoint(target).point);
  return held.filter(contact=>!sameDigit(contact,target)&&point.distanceTo(V(contactPoint(contact).point))<padOf(target.finger)+padOf(contact.finger)+.002);
}
function flickNeedsRegrip(record:FormulaRecord,index:number,pose:TeachingPose,hand:TeachingHand) {
  const move=record.steps[index].move,driver=chooseDriver(record,index,pose);
  if(move.face!=='U'||move.kind==='wide'||driver.hand!==hand||new Quaternion().fromArray(pose[hand].rotation).angleTo(new Quaternion())<.7)return false;
  // A thumb cannot travel naturally across the upper face while its palm
  // remains on the side of a preceding 90-degree wrist grip. Receive with
  // the other hand and release/reorient this hand before the thumb flick.
  if(driver.finger==='thumb')return true;
  const contact=driveAnchor(move,hand,driver.finger,0,undefined,pose),base=FINGER_BASES[driver.finger],sign=hand==='right'?1:-1;
  const origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(new Quaternion().fromArray(pose[hand].rotation)).add(V(pose[hand].palm));
  return Array.from({length:9},(_,i)=> {
    const point=contactPoint(contact,move,moveAngle(move)*i/8);
    return origin.distanceTo(V(point.point).addScaledVector(V(point.normal),padOf(driver.finger)));
  }).some(distance=>distance<.036||distance>reachOf(driver.finger)-.002);
}
function temporaryGrip(hand:TeachingHand,pose:TeachingPose,held:TeachingContact[]=[]):TeachingContact[] {
  const normal=new Vector3(0,0,1).applyQuaternion(new Quaternion().fromArray(pose[hand].rotation));
  const front=SLOTS.reduce((best,slot)=>V(slot.normal).dot(normal)>V(best.normal).dot(normal)?slot:best,SLOTS[0]).normal;
  return (['thumb','index'] as const).map((finger,index)=> {
    const desired=V(front).multiplyScalar(index?-1:1),tip=V(pose[hand].tips[finger].point);
    const slot=SLOTS.filter(slot=>V(slot.normal).dot(desired)>.99)
      .filter(slot=>!occupiedPad(anchor(slot,hand,finger,false),held).length).sort((a,b)=> {
      const point=(slot:typeof SLOTS[number])=>V(slot.position).multiplyScalar(P).addScaledVector(V(slot.normal),H-P);
      return stableCost(point(a).distanceTo(tip),point(b).distanceTo(tip));
    })[0];
    if(!slot)throw new Error('临时接握没有空闲接触位');
    return anchor(slot,hand,finger,false);
  });
}
export function compileTeachingMotion(record: FormulaRecord): TeachingMotion {
  return compileTeachingProgram(record);
}
function compileTeachingProgram(record: FormulaRecord,original=false): TeachingMotion {
  const recovery=authoredGripRecoveries(record.id)[0];
  const baseline=!original&&recovery?compileTeachingProgram(record,true):undefined;
  if(baseline)baseline.formulaId+='::original-before-clearance';
  let returnStart=0,returnEnd=0;
  let pose=neutralPose(), time=0;
  const initialDriver=chooseDriver(record,0),firstMove=record.steps[0]?.move;
  const initialGrip=firstMove&&!record.steps[0].hint&&firstMove.kind!=='slice'&&(firstMove.face==='R'||firstMove.face==='L');
  let held:TeachingContact[]=HANDS.flatMap(hand=>[
    anchor(SLOTS.find(s=>s.face==='F'&&s.position[0]===(hand==='right'?1:-1)&&s.position[1]===0)!,hand,'thumb',false),
    anchor(SLOTS.find(s=>s.face==='B'&&s.position[0]===(hand==='right'?1:-1)&&s.position[1]===0)!,hand,initialGrip&&hand===initialDriver.hand?initialDriver.finger:'index',false),
  ]);
  for(const c of held)setTip(pose,c,record.steps[0]?.move??{face:'U',turns:1,notation:'U'},0);
  fitPalmTargets(pose,held.map(c=>({hand:c.hand,finger:c.finger})));
  for(const h of HANDS)for(const f of FINGER_NAMES)
    if(!held.some(c=>c.hand===h&&c.finger===f))pose[h].tips[f]=restingTip(h,f,pose);
  const program: TeachingMotion={formulaId:record.id,initialState:record.initialState,states:[record.initialState],
    steps:[],segments:[],boundaries:[copyPose(pose)],finalContacts:held,duration:0};
  record.steps.forEach((source,index)=> {
    const move=source.move,supportPose=copyPose(pose);
    const resetHands=HANDS.filter(hand=>index>0&&(record.steps[index-1].move.kind==='rotation'
      ||new Quaternion().fromArray(pose[hand].rotation).angleTo(new Quaternion())>1.9
      ||(move.face==='D'&&chooseDriver(record,index,pose).hand===hand&&new Quaternion().fromArray(pose[hand].rotation).angleTo(new Quaternion())>.7)
      ||flickNeedsRegrip(record,index,pose,hand)));
    for(const hand of resetHands)supportPose[hand]=neutralPose()[hand];
    const authored=authoredSupportPlacements(record.id,index);
    const driver=chooseDriver(record,index,supportPose),supports=supportAnchors(move,driver.hand,driver.finger,record.steps[index+1]?.move,supportPose,held,authored);
    const step:TeachingMotionStep={index,move,group:source.group,start:time,end:time,driver,segments:[]};
    const retirements=authoredReleaseRetirements(record.id,index);
    const quarterClearance=original&&recovery?.clearanceStep===index?undefined:authoredQuarterClearances(record.id).find(item=>item.sourceStep===index);
    if(quarterClearance) {
      if(move.face!=='U'||move.kind==='wide'||driver.hand!==quarterClearance.hand||driver.finger!==quarterClearance.finger)
        throw new Error('单拨掌空间标注必须匹配原步骤的真实驱动角色');
      (program.quarterClearances??=[]).push({...quarterClearance});
    }
    const transitions=authoredFlickTransitions(record.id,index);
    if(transitions.length)(program.flickTransitions??=[]).push(...transitions.map(item=>({...item,sourceStep:index})));
    if(authored.length||retirements.length||transitions.length||quarterClearance)step.gripNotes=[...authored,...retirements,...transitions,...(quarterClearance?[quarterClearance]:[])].map(placement=>placement.reason);
    let currentAngle=0;
    function addPhase(phase:TeachingSegment['phase'],instruction:string,duration:number,target:TeachingPose,
      contacts:TeachingContact[],angleTo=currentAngle,hand=driver.hand,finger=driver.finger,incoming:TeachingContact[]=[],guides:TeachingContact[]=[]) {
      for(const side of HANDS) {
        const delta=V(target[side].palm).sub(V(pose[side].palm));
        if(delta.lengthSq()>1e-12)for(const f of FINGER_NAMES) {
          if(!contacts.some(c=>c.hand===side&&c.finger===f)
            && V(target[side].tips[f].point).distanceTo(V(pose[side].tips[f].point))<1e-9)
            target[side].tips[f].point=A(V(target[side].tips[f].point).add(delta));
        }
      }
      const constraints=[...contacts,...incoming].map(c=>({hand:c.hand,finger:c.finger}));
      if(!target[hand].tips[finger].resting)constraints.push({hand,finger});
      if(phase==='prepare'||phase==='contact')for(const side of HANDS)for(const f of FINGER_NAMES)
        if(!target[side].tips[f].resting&&V(target[side].tips[f].point).distanceTo(V(pose[side].tips[f].point))>.001)constraints.push({hand:side,finger:f});
      fitPalmTargets(target,constraints);
      for(const side of HANDS)for(const f of FINGER_NAMES)if(target[side].tips[f].resting)target[side].tips[f]=restingTip(side,f,target);
      const segment:TeachingSegment={start:time,duration,step:index,phase,instruction,hand,finger,
        from:copyPose(pose),to:copyPose(target),contacts,angleFrom:currentAngle,angleTo};
      if(guides.length)segment.padGuides=guides;
      step.segments.push(program.segments.length);program.segments.push(segment);time+=duration;
      pose=copyPose(target);currentAngle=angleTo;
    }
    function add(phase:TeachingSegment['phase'],instruction:string,duration:number,target:TeachingPose,
      contacts:TeachingContact[],angleTo=currentAngle,hand=driver.hand,finger=driver.finger,incoming:TeachingContact[]=[]) {
      const guided=incoming.filter(contact=>contact.arrivalPath==='normal');
      if(guided.length) {
        // Receiving a support has a surface approach of its own. Its final
        // 12 mm must not be reinterpreted as an unconstrained folded-finger
        // shortcut. Retained fingers carry the cube until landing completes.
        const outside=copyPose(target);
        for(const receiver of guided)setTip(outside,receiver,move,angleTo,.012);
        addPhase('handoff',`${fingerLabel(hand,finger)}移到接收面的外侧，其他手指保持支撑`,duration,outside,contacts,angleTo,hand,finger,incoming);
        addPhase('contact',instruction,.12,target,contacts,angleTo,hand,finger,incoming,guided);
      } else addPhase(phase,instruction,duration,target,contacts,angleTo,hand,finger,incoming);
    }
    if(resetHands.length) {
      // Whole-cube turns change the cube holding, not the meaning of left and
      // right hands. Return one palm at a time while the other retains grip.
      for(const [resetIndex,hand] of resetHands.entries()) {
        if(!hasHoldingDirections(held.filter(c=>c.hand!==hand)))for(const receiver of temporaryGrip(opposite(hand),pose,held)) {
          const retained=held.filter(c=>!(c.hand===receiver.hand&&c.finger===receiver.finger));
          const received=copyPose(pose);setTip(received,receiver,move,0);
          add('handoff','接收手先握稳，另一只手随后退出换握',.22,received,retained,currentAngle,receiver.hand,receiver.finger,[receiver]);
          held=[...retained,receiver];
        }
        const retained=held.filter(c=>c.hand!==hand);
        const cleared=copyPose(pose);
        for(const finger of FINGER_NAMES)cleared[hand].tips[finger]=restingTip(hand,finger,cleared);
        add('handoff','手指先离开块面，另一只手继续稳持',.3,cleared,retained,currentAngle,hand,'thumb');
        const target=copyPose(pose);target[hand]=neutralPose()[hand];
        for(const finger of FINGER_NAMES)target[hand].tips[finger]=restingTip(hand,finger,target);
        add('handoff','空手调整腕部拿法，支撑手保持接触',.4,target,retained,currentAngle,hand,'thumb');
        program.segments.at(-1)!.regripHands=[hand];
        held=retained;
        const required=supports.filter(c=>c.hand===hand);
        const mustReceiveAnotherHand=resetIndex+1<resetHands.length;
        const receivingContacts=mustReceiveAnotherHand&&!hasHoldingDirections(required)?temporaryGrip(hand,pose,held):required;
        for(const received of receivingContacts) {
          const receiving=copyPose(pose);setTip(receiving,received,move,0);
          add('handoff','调整拿法后重新接稳，其他手指保留支撑',.17,receiving,held,currentAngle,hand,received.finger,[received]);
          held=[...held,received];
        }
      }
    }
    let prepared=copyPose(pose);
    if(move.face==='D'&&driver.finger==='ring'&&!pose[driver.hand].tips.index.resting) {
      const retained=held.filter(c=>!(c.hand===driver.hand&&c.finger==='index'));
      if(hasHoldingDirections(retained)) {
        const cleared=copyPose(pose);cleared[driver.hand].tips.index=restingTip(driver.hand,'index',cleared);
        add('handoff','食指先让出后面的握持位，中指随后接稳',.24,cleared,retained,currentAngle,driver.hand,'index');held=retained;
      }
    }
    // Transfer supports one digit at a time. Contacts not being moved remain
    // fixed to their real cubie while the new finger is positioned.
    const pendingSupports=[...supports];
    while(pendingSupports.length) {
      // Move an occupant to its new anchor before reusing that pad location.
      // For a cycle, explicitly release one blocked digit under the remaining
      // receiving grip; the source cube angle remains unchanged throughout.
      const ready=pendingSupports.findIndex(contact=>!occupiedPad(contact,held).length);
      const contact=pendingSupports.splice(ready<0?0:ready,1)[0];
      for(const blocked of occupiedPad(contact,held)) {
        if(!hasHoldingDirections(held.filter(other=>!sameDigit(other,blocked)))) {
          for(const receiver of temporaryGrip(opposite(blocked.hand),pose,held)) {
            if(held.some(other=>sameDigit(other,receiver)))continue;
            const received=copyPose(pose);setTip(received,receiver,move,0);
            add('handoff','接收手先接稳，为原来的支撑指让位',.22,received,held,currentAngle,receiver.hand,receiver.finger,[receiver]);
            held=[...held,receiver];
          }
        }
        const retained=held.filter(other=>!sameDigit(other,blocked));
        if(!hasHoldingDirections(retained))throw new Error('接握占位循环没有安全的接收握姿');
        const cleared=copyPose(pose);cleared[blocked.hand].tips[blocked.finger]=restingTip(blocked.hand,blocked.finger,cleared);
        add('handoff','原来的支撑指先离开，新接触随后就位',.24,cleared,retained,currentAngle,blocked.hand,blocked.finger);
        held=retained;
      }
      const existing=held.find(c=>c.hand===contact.hand&&c.finger===contact.finger);
      if(existing) {
        const before=contactPoint(existing),after=contactPoint(contact);
        if(V(before.point).distanceTo(V(after.point))<1e-7&&V(before.normal).distanceTo(V(after.normal))<1e-7)continue;
      }
      if(!hasHoldingDirections(held.filter(c=>!(c.hand===contact.hand&&c.finger===contact.finger)))) {
        for(const bridge of temporaryGrip(opposite(contact.hand),pose,held)) {
          if(held.some(c=>c.hand===bridge.hand&&c.finger===bridge.finger))continue;
          const received=copyPose(pose);setTip(received,bridge,move,0);
          add('handoff','另一只手先接稳，再调整原来的支撑指',.22,received,held,currentAngle,bridge.hand,bridge.finger,[bridge]);
          held=[...held,bridge];
        }
      }
      const retained=held.filter(c=>!(c.hand===contact.hand&&c.finger===contact.finger));
      prepared=copyPose(pose);setTip(prepared,contact,move,0);
      add('handoff',`${fingerLabel(contact.hand,contact.finger)}接稳，其他手指保持支撑`,.17,prepared,retained,currentAngle,contact.hand,contact.finger,[contact]);
      held=[...retained,{...contact,rotating:false,role:'support'}];
    }
    // Keep both palms near the cube, shifting the wrist only for access. The
    // next step starts at this exact final pose rather than a canonical reset.
    const sign=driver.hand==='right'?1:-1;
    const desired:Vec3=[sign*(move.kind==='slice'?.083:.09),move.kind==='slice'?-.048:move.face==='D'?-.032:move.face==='B'?.012:-.004,
      move.kind==='slice'?.033:move.face==='D'?-.03:move.face==='F'?.025:move.face==='B'?-.022:0];
    prepared[driver.hand].palm=A(V(pose[driver.hand].palm).lerp(V(desired),.65));
    add('handoff','支撑指保持接触，拨动手调整腕部位置',.25,prepared,held);
    const count=move.turns===2?2:1;
    const wrist=!source.hint && (move.face==='R'||move.face==='L') && move.kind!=='slice';
    for(let quarter=0;quarter<count;quarter++) {
      const finger=quarter===0||wrist||source.hint?driver.finger:driver.finger==='index'?'middle':driver.finger==='ring'?'middle':driver.finger;
      let plannedDrivePalm:Vec3|undefined;
      if(quarter>0&&finger!==driver.finger) {
        // A double flick is a handoff between digits. The first finger must
        // leave the second one's corridor instead of hovering beside its pad.
        const cleared=copyPose(pose);
        cleared[driver.hand].tips[driver.finger]=restingTip(driver.hand,driver.finger,cleared);
        add('handoff','第一拨的手指退出，接力手指随后进入',.24,cleared,held,currentAngle,driver.hand,driver.finger);
      }
      if((count===2||quarterClearance)&&move.face==='U'&&move.kind!=='wide') {
          // Each quarter needs room for its own MCP, including the first
          // stroke. The old relay-only check left the initiating index with
          // an unavoidable proximal self-fold before the middle finger took
          // over. Existing support pads remain held during this adjustment.
          const q=new Quaternion().fromArray(pose[driver.hand].rotation),base=FINGER_BASES[finger];
          const score=(offset:Vec3)=> {
            const trial=copyPose(pose);
            trial[driver.hand].palm=A(V(trial[driver.hand].palm).add(V(offset).applyQuaternion(q)));
            for(const f of FINGER_NAMES)if(trial[driver.hand].tips[f].resting)trial[driver.hand].tips[f]=restingTip(driver.hand,f,trial);
            const contact=driveAnchor(move,driver.hand,finger,currentAngle,undefined,trial);
            const prepared=copyPose(trial);setTip(prepared,contact,move,currentAngle,.012);
            fitPalmTargets(prepared,[...held.map(c=>({hand:c.hand,finger:c.finger})),{hand:driver.hand,finger}]);
            trial[driver.hand].palm=prepared[driver.hand].palm;
            const origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(V(trial[driver.hand].palm));
            let near=Infinity,far=0;
            for(let n=0;n<=12;n++) {
              const point=contactPoint(contact,move,currentAngle+moveAngle(move)/count*n/12);
              const distance=origin.distanceTo(V(point.point).addScaledVector(V(point.normal),padOf(finger)));
              near=Math.min(near,distance);far=Math.max(far,distance);
            }
            const shift=V(trial[driver.hand].palm).distanceTo(V(pose[driver.hand].palm));
            return {trial,near,cost:Math.max(0,.045-near)*10+Math.max(0,far-.1)*15+shift*.1};
          };
          const baseline=score([0,0,0]);let best=baseline;
          if(baseline.near<.04)for(const outward of [0,.015,.03])for(const front of [-.03,0,.03]) {
            const candidate=score([sign*outward,0,front]);if(candidate.cost<best.cost)best=candidate;
          }
          if(best!==baseline&&best.near>baseline.near+.004) {
            plannedDrivePalm=best.trial[driver.hand].palm;
            const opened=copyPose(pose);opened[driver.hand].palm=best.trial[driver.hand].palm;
            for(const f of FINGER_NAMES)if(opened[driver.hand].tips[f].resting)opened[driver.hand].tips[f]=restingTip(driver.hand,f,opened);
            add('handoff','支撑指接稳，手掌为本次顶层拨动留出转动空间',.3,opened,held,currentAngle,driver.hand,finger);
          }
      }
      let drives:TeachingContact[];
      if(move.kind==='rotation') drives=supports;
      else if(wrist) {
        // Outer and wide R/L turns are a wrist grip: thumb and index pinch
        // opposite sides of the selected slab and travel with it together.
        const axis=V(NORMALS[move.face]);
        const layer=1;
        const q=new Quaternion().fromArray(pose[driver.hand].rotation);
        const thumbNormal=new Vector3(0,0,1).applyQuaternion(q);
        const faces=([...['U','D','F','B']] as ('U'|'D'|'F'|'B')[]).sort((a,b)=>V(NORMALS[b]).dot(thumbNormal)-V(NORMALS[a]).dot(thumbNormal));
        const thumbFace=faces[0],indexFace=faces.find(face=>V(NORMALS[face]).dot(V(NORMALS[thumbFace]))<-.99)!;
        drives=[thumbFace,indexFace].map((face,i)=> {
          const slot=SLOTS.filter(x=>x.face===face&&Math.round(V(x.position).dot(axis))===layer)
            .map(slot=> {const point=V(slot.position).multiplyScalar(P).addScaledVector(V(slot.normal),H-P+padOf(i?driver.finger:'thumb'));
              // The outer index enters above the middle pad. Sharing its
              // row forces the index pad to pass through the held middle
              // phalanx while crossing toward the rear face.
              const row=i&&move.kind==='wide'?-.8*point.dot(new Vector3(0,1,0).applyQuaternion(q)):0;
              return {slot,cost:row+point.distanceTo(V(pose[driver.hand].tips[i?driver.finger:'thumb'].point))*(i&&move.kind==='wide'?.1:1)};})
            .sort((a,b)=>stableCost(a.cost,b.cost))[0].slot;
          return anchor(slot,driver.hand,i?driver.finger:'thumb',true,move,currentAngle);
        });
        if(move.kind==='wide') {
          // A wrist grip carries the middle slab by its rear/front edge. A
          // middle fingertip across the top would cross the index MCP on r.
          // This is a clamped grip (with opposing thumb/index pads), not an
          // independent normal-force flick, so tangential work may be zero.
          const middleSlot=SLOTS.filter(slot=>slot.face===indexFace&&Math.abs(V(slot.position).dot(axis))<.5)
            .sort((a,b)=>V(a.position).lengthSq()-V(b.position).lengthSq())[0];
          drives.push(anchor(middleSlot,driver.hand,'middle',true,move,currentAngle));
        }
      }
      else {
        drives=[driveAnchor(move,driver.hand,finger,currentAngle,move.kind==='wide'?1:undefined,pose)];
        if(move.kind==='wide') {
          const second=finger==='thumb'?'index':finger==='index'?'middle':'thumb';
          drives.push(driveAnchor(move,driver.hand,second,currentAngle,0,pose));
        }
      }
      // A supporting finger cannot simultaneously be the active driver.
      const stable=supports.filter(c=>!drives.some(d=>d.hand===c.hand&&d.finger===c.finger));
      if(quarter===0)for(const transition of transitions) {
        const previous=held.find(c=>c.hand===transition.hand&&c.finger===transition.finger);
        if(!previous)throw new Error('拨动前的离面编排缺少原承托接触');
        const retained=held.filter(c=>!sameDigit(c,previous));
        if(!hasHoldingDirections(retained.filter(c=>c.hand!==transition.hand)))throw new Error('离开原承托前，另一只手必须已经接稳');
        const departed=copyPose(pose);setTip(departed,previous,move,currentAngle,transition.departureClearance);
        addPhase('release','另一只手已经接稳，拨动指先沿原块面法线离开',.16,departed,retained,currentAngle,
          transition.hand,transition.finger,[],[previous]);
        held=retained;
      }
      if(!wrist&&move.face==='F'&&finger==='thumb') {
        // A thumb flick can finish close to its own MCP even when its initial
        // pad is comfortably reachable. Leave room for both rigid proximal
        // links over the complete quarter-turn, under the existing support.
        // Both pads of a wide f share the same palm throughout the sweep.
        const hand=driver.hand,h=pose[hand],q=new Quaternion().fromArray(h.rotation);
        const assess=(palm:Vec3)=> {
          let near=Infinity,far=0;
          for(const contact of drives) {
            const base=FINGER_BASES[contact.finger];
            const origin=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q).add(V(palm));
            for(let sample=0;sample<=16;sample++) {
              const tip=contactPoint(contact,move,currentAngle+moveAngle(move)/count*sample/16);
              const pad=V(tip.point).addScaledVector(V(tip.normal),padOf(contact.finger));
              near=Math.min(near,origin.distanceTo(pad));
              // Match the reach envelope used by fitPalmTargets so the later
              // contact/drive phases do not pull this prepared palm inward.
              far=Math.max(far,origin.distanceTo(pad.addScaledVector(V(tip.normal),fingerLengths(contact.finger)[2]*.55)));
            }
          }
          const shift=V(palm).distanceTo(V(h.palm));
          return {palm,near,far,cost:Math.max(0,.045-near)*20+Math.max(0,far-.0835)*30+shift*.1};
        };
        const baseline=assess(h.palm);let best=baseline;
        // F rotates in the cube XY plane even after a preceding wrist turn.
        // Search that physical sweep plane, not the rotated palm frame.
        const depthOffsets=move.kind==='wide'?[-P,-.015,0,.015,P]:[-.015,0,.015];
        if(baseline.near<.038)for(const outward of [0,.015,.03,.045])for(const rise of [-.045,-.03,0,.03,.045])for(const front of depthOffsets) {
          const palm=A(V(h.palm).add(new Vector3(sign*outward,rise,front)));
          const candidate=assess(palm);
          // Filter reach first: rejecting an infeasible soft-score winner
          // must not discard another reachable way to open the same sweep.
          if(candidate.far<.084&&stableCost(candidate.cost,best.cost)<0)best=candidate;
        }
        if(best!==baseline&&best.near>baseline.near+.008&&best.far<.084) {
          plannedDrivePalm=best.palm;
          const opened=copyPose(pose);opened[hand].palm=best.palm;
          for(const f of FINGER_NAMES)if(opened[hand].tips[f].resting)opened[hand].tips[f]=restingTip(hand,f,opened);
          add('handoff',move.kind==='wide'?'支撑手握稳，掌根为两层拨动的手指共同留出空间':'支撑手握稳，拇指掌根退出拨动经过的空间',.3,opened,stable,currentAngle,hand,finger);
        }
      }
      let stagedMiddle:TeachingContact|undefined;
      if(quarter===0&&move.kind==='wide'&&drives.length>2) {
        const middle=drives.find(c=>c.finger==='middle')!;
        const cleared=copyPose(pose);
        for(const contact of drives.filter(c=>c!==middle))cleared[contact.hand].tips[contact.finger]=restingTip(contact.hand,contact.finger,cleared);
        add('prepare','支撑手稳持，外层夹指先让出中指的进入路线',.2,cleared,stable,currentAngle,middle.hand,middle.finger);
        const advance=copyPose(pose);setTip(advance,middle,move,currentAngle);
        add('prepare','中指先接触中层，随后保持位置供外层夹指就位',.22,advance,stable,currentAngle,middle.hand,middle.finger);stagedMiddle=middle;
      }
      if(move.kind!=='rotation'&&(quarter===0||!wrist)) {
      let settling:TeachingContact|undefined;
      if(wrist&&drives.length===2) {
        settling=drives.find(contact=> {
          const target=contactPoint(contact,move,currentAngle);
          const pad=V(target.point).addScaledVector(V(target.normal),padOf(contact.finger));
          return pad.distanceTo(V(pose[contact.hand].tips[contact.finger].point))<.018;
        });
        if(settling) {
          const received=copyPose(pose);setTip(received,settling,move,currentAngle);
          add('contact','先接稳已经靠近的夹持指，另一指随后就位',.12,received,stable,currentAngle,settling.hand,settling.finger);
        }
      }
      const approachContacts=[...stable,...(settling?[settling]:[]),...(stagedMiddle?[stagedMiddle]:[])];
      prepared=copyPose(pose);
      for(const contact of stable) setTip(prepared,contact,move,currentAngle);
      for(const contact of drives) setTip(prepared,contact,move,currentAngle,contact===settling||contact===stagedMiddle?0:.012);
      add('prepare',`${fingerLabel(driver.hand,finger)}靠近目标块侧面`,.25,prepared,approachContacts,currentAngle,driver.hand,finger);
      const touching=copyPose(pose);
      // The outside approach can require a closer palm for its extra 12 mm.
      // At landing restore the jointly feasible sweep pose, rather than keep
      // that temporary approach fit as the subsequent turn's palm position.
      if(plannedDrivePalm)touching[driver.hand].palm=[...plannedDrivePalm];
      for(const contact of drives) setTip(touching,contact,move,currentAngle);
      add('contact','指腹建立接触，支撑手保持稳定',.15,touching,approachContacts,currentAngle,driver.hand,finger);
      }
      const nextAngle=currentAngle+moveAngle(move)/count;
      const turned=copyPose(pose);
      if(wrist||move.kind==='rotation') {
        const q=new Quaternion().setFromAxisAngle(V(NORMALS[move.face]),nextAngle-currentAngle);
        for(const hand of move.kind==='rotation'?HANDS:[driver.hand]) {
          turned[hand].palm=A(V(turned[hand].palm).applyQuaternion(q));
          turned[hand].rotation=q.clone().multiply(new Quaternion().fromArray(turned[hand].rotation)).toArray();
          for(const f of FINGER_NAMES) {
            turned[hand].tips[f].point=A(V(turned[hand].tips[f].point).applyQuaternion(q));
            turned[hand].tips[f].normal=A(V(turned[hand].tips[f].normal).applyQuaternion(q));
          }
        }
      }
      for(const contact of drives) setTip(turned,contact,move,nextAngle);
      const label=move.kind==='slice'?'直接拨动中层':move.kind==='wide'?'两层一起转动':move.kind==='rotation'?'双手带动整颗魔方':wrist?'握住外层，用腕部转动':'拨动目标层';
      add('drive',`${quarter&&!wrist?(source.hint?'再次':'接力'):''}${label}`,move.kind==='rotation'?.85:.66,
        turned,[...stable,...drives],nextAngle,driver.hand,finger);
      if(wrist||move.kind==='rotation') program.segments.at(-1)!.wristHands=move.kind==='rotation'?[...HANDS]:[driver.hand];
      if(wrist&&quarter<count-1)continue;
      const released=copyPose(pose);
      const exitNormal=contactPoint(drives[0],move,nextAngle).normal;
      const handWithdrawal=move.face==='F'&&!wrist&&stable.every(c=>c.hand!==driver.hand)
        &&drives.every(c=>c.hand===driver.hand&&V(contactPoint(c,move,nextAngle).normal).dot(V(exitNormal))>.99999);
      // The now-unloaded hand can leave the slab with its two pads together.
      // The next source step starts from this genuinely withdrawn palm.
      if(handWithdrawal)released[driver.hand].palm=A(V(pose[driver.hand].palm).addScaledVector(V(exitNormal),.012));
      for(const contact of drives) {
        const authoredRelease=transitions.find(item=>sameDigit(item,contact))?.releaseClearance;
        setTip(released,contact,move,nextAngle,move.kind==='rotation'?0:authoredRelease??(move.kind==='wide'&&contact.finger==='middle'?.024:.012));
      }
      add('release',move.kind==='rotation'?'转体到位，双手继续稳持':handWithdrawal?'拨动到位后，手掌随指腹一起离面，另一手保持支撑':'层转到位后释放手指，保留衔接握姿',.21,released,
        move.kind==='rotation'?drives:stable,nextAngle,driver.hand,finger);
      if(quarter===count-1&&move.kind!=='rotation')for(const contact of drives.filter(c=>(!wrist&&c.finger==='ring')
        ||(move.kind==='wide'&&index+1<record.steps.length)
        ||(count===2&&move.face==='U'&&move.kind!=='wide'&&c.finger==='middle'&&index+1<record.steps.length)
        ||retirements.some(item=>item.hand===c.hand&&item.finger===c.finger))) {
        const authoredRetirement=retirements.some(item=>item.hand===contact.hand&&item.finger===contact.finger);
        if(!authoredRetirement&&[index+1,index+2].filter(i=>i<record.steps.length).some(i=>{
          const upcoming=record.steps[i],next=chooseDriver(record,i,pose);
          if(upcoming.move.kind==='rotation')return contact.finger==='thumb'||contact.finger==='index';
          if(next.hand===contact.hand) {
            const nextWrist=!upcoming.hint&&upcoming.move.kind!=='slice'&&(upcoming.move.face==='R'||upcoming.move.face==='L');
            const driven:TeachingFinger[]=[next.finger];
            if(nextWrist) {
              driven.push('thumb');if(upcoming.move.kind==='wide')driven.push('middle');
            } else if(upcoming.move.kind==='wide')driven.push(next.finger==='thumb'?'index':next.finger==='index'?'middle':'thumb');
            if(!nextWrist&&!upcoming.hint&&upcoming.move.turns===2&&(next.finger==='index'||next.finger==='ring'))driven.push('middle');
            if(driven.includes(contact.finger))return true;
          }
          return supportAnchors(upcoming.move,next.hand,next.finger,record.steps[i+1]?.move,pose,stable,authoredSupportPlacements(record.id,i))
            .some(c=>c.hand===contact.hand&&c.finger===contact.finger);
        }))continue;
        const folded=copyPose(pose);folded[contact.hand].tips[contact.finger]=restingTip(contact.hand,contact.finger,folded);
        add('handoff',`指腹离开后再收拢${fingerZh[contact.finger]}，为下一步让位`,.24,folded,stable,nextAngle,contact.hand,contact.finger);
      }
      held=move.kind==='rotation'?drives:stable;
    }
    if(baseline&&recovery&&index===recovery.clearanceStep) {
      const target=copyPose(baseline.segments[baseline.steps[index].segments.at(-1)!].to);
      returnStart=time;
      const segment:TeachingSegment={start:time,duration:recovery.returnDuration,step:index,phase:'handoff',
        instruction:'拨动已完成，保持支撑回到下一步的衔接握姿',hand:driver.hand,finger:driver.finger,
        from:copyPose(pose),to:target,contacts:structuredClone(held),angleFrom:currentAngle,angleTo:currentAngle};
      step.segments.push(program.segments.length);program.segments.push(segment);time+=recovery.returnDuration;pose=copyPose(target);returnEnd=time;
    }
    step.end=time;program.steps.push(step);
    program.states.push(applyMove(program.states.at(-1)!,move));
    // At a source boundary the state engine commits the permutation. Carry
    // support ownership to the newly indexed cubies without moving a fingertip.
    held=held.map(c=> {
      if(!c.rotating)return c;
      const q=new Quaternion().setFromAxisAngle(V(NORMALS[move.face]),currentAngle);
      return {...c,cubie:A(V(c.cubie).applyQuaternion(q)).map(x=>Math.round(x)) as Vec3,
        local:A(V(c.local).applyQuaternion(q)),normal:A(V(c.normal).applyQuaternion(q)),rotating:false,role:'support'};
    });
    program.boundaries.push(copyPose(pose));
  });
  program.finalContacts=held;program.duration=time;
  for(const authored of authoredIdleWaits(record.id)) {
    if(authored.sourceStep>=program.steps.length)continue;
    const first=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase===authored.fromPhase);
    if(first<0)throw new Error('闲置等待缺少对应原始动作阶段');
    const touches=(s:TeachingSegment)=>s.contacts.some(c=>c.hand===authored.hand&&c.finger===authored.finger);
    let following=first;
    while(following<program.segments.length) {
      const s=program.segments[following],a=s.from[authored.hand].tips[authored.finger],b=s.to[authored.hand].tips[authored.finger];
      if(touches(s)||V(a.point).distanceTo(V(b.point))>1e-8||V(a.normal).distanceTo(V(b.normal))>1e-8)break;
      following++;
    }
    if(following===first||following>=program.segments.length)throw new Error('闲置等待必须在实际接近开始前结束');
    let landing=following;
    while(landing<program.segments.length&&!touches(program.segments[landing])
      &&!program.segments[landing].padGuides?.some(c=>c.hand===authored.hand&&c.finger===authored.finger))landing++;
    if(landing<=following||landing>=program.segments.length)throw new Error('闲置等待缺少后续接近终点');
    (program.idleWaits??=[]).push({...authored,start:program.segments[first].start,end:program.segments[following].start,approachEnd:program.segments[landing].start});
  }
  compileExternalReceptions(program);
  compileCornerReceptions(program);
  compileRelayYields(program);
  compileSupportClearances(program);
  compileIdleParking(program);
  compileJointReceptions(program);
  compilePreclearances(program);
  compileUnderReceptions(program);
  compileExternalPreforms(program);
  compileGripTemplates(program);
  compileSupportedRelays(program);
  compileRetirementYields(program);
  if(baseline&&recovery)compileGripRecovery(program,baseline,recovery,returnStart,returnEnd);
  if(!original){compiledMotions.delete(record.id);compiledMotions.set(record.id,program);}
  if(typeof window!=='undefined')while(compiledMotions.size>4)compiledMotions.delete(compiledMotions.keys().next().value!);
  return program;
}

/** Insert an authored unloaded-hand manoeuvre without reselecting the legal
 * receiving anchors or changing any source turn. The bone-path contract below
 * is interpreted by the offline rigid trajectory author, not by fake contacts. */
function compileExternalReceptions(program:TeachingMotion) {
  for(const authored of authoredExternalReceptions(program.formulaId)) {
    const step=program.steps[authored.sourceStep],start=step.start,hand=authored.hand,finger=authored.finger;
    const insertion=step.segments[0],original=program.segments[insertion];
    const landing=program.segments.find(s=>s.step===authored.sourceStep&&s.padGuides?.some(c=>c.hand===hand&&c.finger===finger));
    if(!landing)throw new Error('外侧接收缺少原有法线落位');
    if(original.contacts.some(c=>c.hand===hand)||!hasHoldingDirections(original.contacts))throw new Error('外侧接收必须先由另一只手独立承托');
    const initial=copyPose(original.from),arrival=structuredClone(landing.from[hand].tips[finger]);
    const delta=V(NORMALS[authored.side]).multiplyScalar(authored.distance);
    const translate=(pose:TeachingPose)=> {
      const result=copyPose(pose);result[hand].palm=A(V(result[hand].palm).add(delta));
      for(const digit of FINGER_NAMES)result[hand].tips[digit].point=A(V(result[hand].tips[digit].point).add(delta));
      return result;
    };
    const withdrawn=translate(initial),ready=copyPose(initial);ready[hand].tips[finger]=arrival;
    const unfolded=translate(ready),added=.7,oldLanding=landing.start;
    const targets=[withdrawn,unfolded,ready],durations=[.2,.3,.2],texts=[
      '支撑手握稳，空出的手掌退到魔方外侧',
      '食指在魔方外侧调整方向，避开块面与其他手指',
      '保留接收指形归掌，随后依次建立承托',
    ];
    let cursor=start,from=initial;
    const phases=targets.map((to,i):TeachingSegment=> {
      const segment={start:cursor,duration:durations[i],step:authored.sourceStep,phase:'handoff' as const,
        instruction:texts[i],hand,finger,from:copyPose(from),to:copyPose(to),contacts:structuredClone(original.contacts),angleFrom:0,angleTo:0};
      cursor+=durations[i];from=to;return segment;
    });
    // It is already in the B-side pre-contact pose when the thumb receives.
    // Keep that position through the existing receiver transfer; the original
    // final normal landing remains the event which establishes support.
    for(const segment of program.segments.slice(insertion)) {
      if(segment.start<oldLanding-1e-8) {
        segment.from[hand].tips[finger]=structuredClone(arrival);
        segment.to[hand].tips[finger]=structuredClone(arrival);
      }
      segment.start+=added;
    }
    program.segments.splice(insertion,0,...phases);
    for(const source of program.steps) {
      if(source.index>authored.sourceStep)source.start+=added;
      if(source.index>=authored.sourceStep)source.end+=added;
      source.segments=[];
    }
    program.segments.forEach((segment,i)=>program.steps[segment.step].segments.push(i));
    program.duration+=added;
    (step.gripNotes??=[]).push(authored.reason);
    (program.externalReceptions??=[]).push({...authored,waitStart:program.steps[authored.waitFromStep].start,
      start,withdrawn:start+.2,unfolded:start+.5,returned:start+added,approachEnd:oldLanding+added});
  }
}

function compileCornerReceptions(program:TeachingMotion) {
  for(const authored of authoredCornerReceptions(program.formulaId)) {
    const hand=authored.hand,finger=authored.finger,step=program.steps[authored.sourceStep];
    const index=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===hand&&s.finger===finger
      &&!s.contacts.some(c=>c.hand===hand&&c.finger===finger));
    const original=program.segments[index],following=program.segments[index+1];
    const receiver=following?.contacts.find(c=>c.hand===hand&&c.finger===finger);
    if(!original||!receiver||original.angleFrom!==original.angleTo)throw new Error('外角接收缺少不转层的原承托交接');
    const fromNormal=V(NORMALS[authored.fromFace]),toNormal=V(receiver.normal);
    if(Math.abs(fromNormal.dot(toNormal))>1e-8)throw new Error('外角接收需要相邻的两个块面');
    const initial=copyPose(original.from),final=copyPose(original.to),outside=copyPose(final);
    outside[hand].tips[finger].point=A(V(final[hand].tips[finger].point).addScaledVector(toNormal,authored.clearance));
    const corner=copyPose(initial),point=V(initial[hand].tips[finger].point);
    point.addScaledVector(toNormal,V(outside[hand].tips[finger].point).sub(point).dot(toNormal));
    corner[hand].tips[finger]={point:A(point),normal:A(fromNormal.clone().add(toNormal).normalize())};
    const targets=[corner,outside,final],durations=[.24,.14,.12],start=original.start,total=durations.reduce((a,b)=>a+b,0),added=total-original.duration;
    const guide={...receiver,positionOnly:true},texts=[
      '食指沿原块面外侧绕到后角，支撑指继续稳持',
      '保持在接收面外侧，食指移到目标承托块',
      '指腹沿法线落位，确认后接稳魔方',
    ];
    let from=initial,cursor=start;
    const phases=targets.map((to,i):TeachingSegment=> {
      const segment={start:cursor,duration:durations[i],step:authored.sourceStep,phase:i===2?'contact' as const:'prepare' as const,
        instruction:texts[i],hand,finger,from:copyPose(from),to:copyPose(to),contacts:structuredClone(original.contacts),
        padGuides:[guide],angleFrom:original.angleFrom,angleTo:original.angleTo};
      cursor+=durations[i];from=to;return segment;
    });
    for(const segment of program.segments.slice(index+1))segment.start+=added;
    program.segments.splice(index,1,...phases);
    for(const source of program.steps) {
      if(source.index>authored.sourceStep)source.start+=added;
      if(source.index>=authored.sourceStep)source.end+=added;
      source.segments=[];
    }
    program.segments.forEach((segment,i)=>program.steps[segment.step].segments.push(i));program.duration+=added;
    (step.gripNotes??=[]).push(authored.reason);
    (program.cornerReceptions??=[]).push({...authored,start,corner:start+durations[0],outside:start+durations[0]+durations[1],end:start+total});
  }
}
function compileRelayYields(program:TeachingMotion) {
  for(const authored of authoredRelayYields(program.formulaId)) {
    const index=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='prepare'&&s.hand===authored.hand&&s.finger===authored.incoming);
    const original=program.segments[index];
    if(!original||original.angleFrom!==original.angleTo||original.contacts.some(c=>c.hand===authored.hand&&(c.finger===authored.finger||c.finger===authored.incoming)))
      throw new Error('接力让位需要未接触的闲指与接近指');
    if(!hasHoldingDirections(original.contacts))throw new Error('接力让位缺少持续承托');
    const driver=program.segments.slice(index).find(s=>s.step===authored.sourceStep&&s.phase==='drive'&&s.finger===authored.incoming)?.contacts.find(c=>c.hand===authored.hand&&c.finger===authored.incoming&&c.role==='drive');
    if(!driver)throw new Error('接力让位缺少后续真实拨动锚');
    const guide={...driver,rotating:false,positionOnly:true};
    const start=original.start,approach=original.duration,added=.54;
    if(authored.referencePath) {
      if(typeof window==='undefined') {const reference=structuredClone(program);reference.formulaId+='::before-relay-passage';program.authoringReference=reference;}
      program.referenceEdit='relay-passage';
    }
    const hold=(pose:TeachingPose,duration:number,instruction:string,time:number):TeachingSegment=>({...original,
      start:time,duration,phase:'handoff',hand:authored.hand,finger:authored.finger,instruction,
      from:copyPose(pose),to:copyPose(pose),contacts:structuredClone(original.contacts)});
    const lifted=start+.12,yielded=lifted+.15,arrived=yielded+approach,refolded=arrived+.12,end=refolded+.15;
    const phases=[hold(original.from,.12,'无名指先抬起末节，离开中指进入的通道',start),
      hold(original.from,.15,'保持近节位置，让折起的无名指向侧方让位',lifted),
      {...original,start:yielded},hold(original.to,.12,'中指已进入预备位，无名指末节恢复折形',arrived),
      hold(original.to,.15,'无名指回到收纳位置，中指随后贴面接力',refolded)];
    // It has arrived outside the surface, but does not yet touch it. This
    // constraint ends its free approach before the idle ring returns.
    if(!authored.referencePath){phases[3].padGuides=[guide];phases[4].padGuides=[guide];}
    for(const segment of program.segments.slice(index+1))segment.start+=added;
    program.segments.splice(index,1,...phases);
    for(const source of program.steps) {
      if(source.index>authored.sourceStep)source.start+=added;
      if(source.index>=authored.sourceStep)source.end+=added;
      source.segments=[];
    }
    program.segments.forEach((segment,i)=>program.steps[segment.step].segments.push(i));program.duration+=added;
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
    (program.relayYields??=[]).push({...authored,start,lifted,yielded,arrived,refolded,end,...(authored.referencePath?{referenceEnd:start+approach}:{})});
  }
}
function compileSupportClearances(program:TeachingMotion) {
  for(const authored of authoredSupportClearances(program.formulaId)) {
    const receiving=program.segments.find(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===authored.hand&&s.finger===authored.finger);
    if(!receiving)throw new Error('承托避让缺少原接收阶段');
    const start=receiving.start+receiving.duration,first=program.segments.findIndex(s=>Math.abs(s.start-start)<1e-8);
    const drive=program.segments.find(s=>s.step===authored.sourceStep&&s.phase==='drive');
    const ready=program.segments[first].start+program.segments[first].duration,end=program.steps[authored.sourceStep].end;
    if(!drive||ready>drive.start+1e-8)throw new Error('承托避让必须在转层前就位');
    for(const segment of program.segments.filter(s=>s.start>=start-1e-8&&s.start<end-1e-8)) {
      const contact=segment.contacts.find(c=>c.hand===authored.hand&&c.finger===authored.finger&&c.role==='support');
      if(!contact||V(contact.normal).distanceTo(V(NORMALS[authored.face]))>1e-8||contact.rotating)throw new Error('承托避让期间必须保持原固定面接触');
    }
    (program.supportClearances??=[]).push({...authored,start,ready,restore:drive.start+drive.duration,end});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function compileIdleParking(program:TeachingMotion) {
  if(authoredIdleParking(program.formulaId).length&&typeof window==='undefined') {
    const reference=structuredClone(program);reference.formulaId+='::before-idle-parking';program.authoringReference=reference;program.referenceEdit='idle-parking';
  }
  for(const authored of authoredIdleParking(program.formulaId)) {
    const index=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===authored.hand&&s.finger===authored.finger&&s.instruction.startsWith('指腹离开后再收拢'));
    const original=program.segments[index];
    if(!original)throw new Error('空闲暂置缺少已离面的退出阶段');
    if(program.segments.slice(index).some(s=>s.contacts.some(c=>c.hand===authored.hand&&c.finger===authored.finger))
      ||program.finalContacts.some(c=>c.hand===authored.hand&&c.finger===authored.finger))throw new Error('空闲暂置不能占用后续接触手指');
    const setTip=(pose:TeachingPose)=> {
      const h=pose[authored.hand],sign=authored.hand==='right'?1:-1,base=FINGER_BASES[authored.finger];
      const point=new Vector3(sign*base[0],base[1],base[2]);
      for(let j=0;j<3;j++)point.addScaledVector(V(authored.directions[j]),fingerLengths(authored.finger)[j]);
      const q=new Quaternion().fromArray(h.rotation);
      h.tips[authored.finger]={point:A(point.applyQuaternion(q).add(V(h.palm))),normal:A(V(authored.directions[2]).multiplyScalar(-1).applyQuaternion(q)),resting:false};
    };
    const referenceDuration=original.duration,added=authored.duration-referenceDuration,start=original.start;
    original.duration=authored.duration;original.instruction='离面后沿掌前侧展开闲置中指，给后续接收保留通道';setTip(original.to);
    for(const segment of program.segments.slice(index+1)){segment.start+=added;setTip(segment.from);setTip(segment.to);}
    for(const source of program.steps) {
      if(source.index>authored.sourceStep)source.start+=added;
      if(source.index>=authored.sourceStep)source.end+=added;
    }
    for(let i=authored.sourceStep+1;i<program.boundaries.length;i++)setTip(program.boundaries[i]);
    program.duration+=added;(program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
    (program.idleParking??=[]).push({...authored,start,end:start+authored.duration,referenceDuration});
  }
}
function compileJointReceptions(program:TeachingMotion) {
  for(const authored of authoredJointReceptions(program.formulaId)) {
    const segment=program.segments.find(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===authored.hand&&s.finger===authored.finger);
    if(!segment||segment.contacts.some(c=>c.hand===authored.hand&&c.finger===authored.finger))throw new Error('折形接收必须发生在手指离面期间');
    if(segment.angleFrom!==segment.angleTo)throw new Error('折形接收不能引入转层');
    (program.jointReceptions??=[]).push({...authored,start:segment.start,end:segment.start+segment.duration});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function compilePreclearances(program:TeachingMotion) {
  for(const authored of authoredPreclearances(program.formulaId)) {
    if(typeof window==='undefined') {
      const reference=structuredClone(program);reference.formulaId+='::before-preclearance';program.authoringReference=reference;
    }
    program.referenceEdit='preclearance';
    const index=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===authored.hand&&s.finger===authored.incoming);
    const original=program.segments[index],drive=program.segments.find(s=>s.step===authored.sourceStep&&s.phase==='drive');
    if(!original||!drive)throw new Error('前置让位缺少夹持阶段');
    const stable=original.contacts.filter(c=>c.hand!==authored.hand);
    if(!hasHoldingDirections(stable))throw new Error('前置让位必须在另一手接稳之后');
    const start=original.start,referenceEnd=drive.start,end=referenceEnd+authored.duration;
    const target=structuredClone(drive.from[authored.hand].tips[authored.finger]);
    const to=copyPose(original.from);to[authored.hand].tips[authored.finger]=target;
    const inserted:TeachingSegment={...structuredClone(original),duration:authored.duration,phase:'handoff',hand:authored.hand,finger:authored.finger,
      instruction:'接收手已经稳持，食指先让出相邻夹持指的进入通道',to,contacts:original.contacts.filter(c=>!(c.hand===authored.hand&&c.finger===authored.finger))};
    for(const segment of program.segments.slice(index)) {
      const oldStart=segment.start;segment.start+=authored.duration;
      if(oldStart<referenceEnd-1e-8) {
        segment.from[authored.hand].tips[authored.finger]=structuredClone(target);
        segment.to[authored.hand].tips[authored.finger]=structuredClone(target);
        segment.contacts=segment.contacts.filter(c=>!(c.hand===authored.hand&&c.finger===authored.finger));
      }
    }
    program.segments.splice(index,0,inserted);
    for(const step of program.steps) {
      if(step.index>authored.sourceStep)step.start+=authored.duration;
      if(step.index>=authored.sourceStep)step.end+=authored.duration;
      step.segments=program.segments.flatMap((s,i)=>s.step===step.index?[i]:[]);
    }
    for(const path of program.jointReceptions??[])if(path.start>=start){path.start+=authored.duration;path.end+=authored.duration;}
    program.duration+=authored.duration;
    (program.preclearances??=[]).push({...authored,start,cleared:start+authored.duration,end,referenceEnd});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function compileUnderReceptions(program:TeachingMotion) {
  for(const authored of authoredUnderReceptions(program.formulaId)) {
    if(typeof window==='undefined') {
      const reference=structuredClone(program);reference.formulaId+='::before-under-reception';program.authoringReference=reference;
    }
    program.referenceEdit='under-reception';
    const index=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===authored.hand&&s.finger===authored.finger);
    const original=program.segments[index];if(!original)throw new Error('下侧接收缺少原交接阶段');
    const next=program.segments[index+1],landedContact=next.contacts.find(c=>c.hand===authored.hand&&c.finger===authored.finger&&c.role==='support');
    if(!landedContact||!hasHoldingDirections(original.contacts.filter(c=>c.hand!==authored.hand)))throw new Error('下侧接收需要另一手先稳定承托');
    const first=original.from[authored.hand].tips[authored.finger],last=original.to[authored.hand].tips[authored.finger];
    if(V(first.normal).distanceTo(V(NORMALS[authored.fromFace]))>1e-8||V(last.normal).distanceTo(V(NORMALS[authored.toFace]))>1e-8)throw new Error('下侧接收拿法与原表方向不符');
    const start=original.start,referenceEnd=start+original.duration,routeStart=start+authored.armPreparation;
    const firstOutside=A(V(first.point).addScaledVector(V(first.normal),authored.clearance)),lastOutside=A(V(last.point).addScaledVector(V(last.normal),authored.clearance));
    const points:Vec3[]=[first.point,firstOutside,[lastOutside[0],-H-authored.lowerClearance,firstOutside[2]],
      [lastOutside[0],-H-authored.lowerClearance,lastOutside[2]],lastOutside,last.point];
    const durations=[.12,.18,.25,.18,.12],breaks=durations.reduce((list,d)=>[...list,list.at(-1)!+d],[routeStart]),landed=breaks.at(-1)!,end=landed+authored.armRecovery,added=end-referenceEnd;
    const guide:TeachingContact={...landedContact,rotating:false,positionOnly:true};
    const poseAt=(point:Vec3,normal:Vec3)=> {const pose=copyPose(original.from);pose[authored.hand].tips[authored.finger]={point,normal};return pose;};
    const phases:TeachingSegment[]=[{...structuredClone(original),duration:authored.armPreparation,to:copyPose(original.from),instruction:'保持接收通道，机械臂先让出掌下空间',padGuides:[guide]}];
    for(let i=0;i<5;i++) {
      const fraction=(breaks[i+1]-routeStart)/(landed-routeStart),u=fraction*fraction*(3-2*fraction),normal=A(V(first.normal).lerp(V(last.normal),u).normalize());
      const from=copyPose(phases.at(-1)!.to),to=i===4?copyPose(original.to):poseAt(points[i+1],normal);
      phases.push({...structuredClone(original),start:breaks[i],duration:durations[i],from,to,padGuides:[guide],
        instruction:['拇指先沿前面法线离开','拇指沿前左外侧下降','拇指绕过魔方下侧','拇指沿左面外侧上移','沿左面法线落位接稳'][i]});
    }
    phases.push({...structuredClone(original),start:landed,duration:authored.armRecovery,from:copyPose(original.to),to:copyPose(original.to),
      contacts:[...original.contacts,landedContact],instruction:'拇指已接稳，机械臂回到下一动作的预备位置',padGuides:undefined});
    for(const segment of program.segments.slice(index+1))segment.start+=added;
    program.segments.splice(index,1,...phases);
    for(const step of program.steps) {
      if(step.index>authored.sourceStep)step.start+=added;
      if(step.index>=authored.sourceStep)step.end+=added;
      step.segments=program.segments.flatMap((s,i)=>s.step===step.index?[i]:[]);
    }
    program.duration+=added;
    (program.underReceptions??=[]).push({...authored,start,routeStart,landed,end,referenceEnd,points,breaks,normals:[first.normal,last.normal]});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function compileSupportedRelays(program:TeachingMotion) {
  for(const authored of authoredSupportedRelays(program.formulaId)) {
    const original=program.segments,receiving=original.find(s=>s.step===authored.sourceStep&&s.phase==='handoff'&&s.hand===authored.supportHand&&s.finger===authored.supportFinger);
    const prepare=original.find(s=>s.step===authored.sourceStep&&s.phase==='prepare'&&s.hand===authored.hand&&s.finger===authored.incoming);
    const release=original.filter(s=>s.step===authored.sourceStep&&s.phase==='release').at(-1);
    if(!receiving||!prepare||!release)throw new Error('承托接力缺少原接稳、第二拨或释放阶段');
    const start=receiving.start+receiving.duration,referencePrepareStart=prepare.start,referencePrepareEnd=prepare.start+prepare.duration,referenceRestore=release.start+release.duration;
    const before=original.find(s=>Math.abs(s.start-start)<1e-8)!;
    for(const segment of original.filter(s=>s.start>=start-1e-8&&s.start<referenceRestore-1e-8)) {
      const support=segment.contacts.find(c=>c.hand===authored.supportHand&&c.finger===authored.supportFinger&&c.role==='support');
      if(!support||support.rotating||V(support.normal).distanceTo(V(NORMALS[authored.supportFace]))>1e-7)throw new Error('接力中的避让必须保留原固定面支撑');
    }
    if(prepare.contacts.some(c=>c.hand===authored.hand&&(c.finger===authored.yielding||c.finger===authored.incoming)))throw new Error('接力让位不能移动已接触的手指');
    if(typeof window==='undefined') {const reference=structuredClone(program);reference.formulaId+='::before-supported-relay';program.authoringReference=reference;}
    program.referenceEdit='supported-relay';
    const ready=start+authored.entryDuration,yieldStart=referencePrepareStart+authored.entryDuration,lifted=yieldStart+.12,yielded=lifted+.15;
    const arrived=yielded+prepare.duration,refolded=arrived+.12,restored=refolded+.15,restore=referenceRestore+authored.entryDuration+.54,end=restore+authored.exitDuration;
    const hold=(base:TeachingSegment,pose:TeachingPose,time:number,duration:number,hand:TeachingHand,finger:TeachingFinger,instruction:string):TeachingSegment=>({
      ...structuredClone(base),start:time,duration,phase:'handoff',hand,finger,instruction,from:copyPose(pose),to:copyPose(pose),padGuides:undefined,wristHands:undefined,regripHands:undefined,
      angleFrom:base.angleFrom,angleTo:base.angleFrom});
    const result:TeachingSegment[]=[];let shift=0;
    for(const segment of original) {
      if(Math.abs(segment.start-start)<1e-8) {
        result.push(hold(before,before.from,start,authored.entryDuration,authored.supportHand,authored.supportFinger,'保持指腹贴稳，承托食指让开顶层扫掠带'));shift+=authored.entryDuration;
      }
      if(segment===prepare) {
        result.push(hold(prepare,prepare.from,yieldStart,.12,authored.hand,authored.yielding,'无名指抬起末节，让出接力通道'));
        result.push(hold(prepare,prepare.from,lifted,.15,authored.hand,authored.yielding,'保持近节位置，让折指向侧方避让'));shift+=.27;
      }
      result.push({...structuredClone(segment),start:segment.start+shift});
      if(segment===prepare) {
        result.push(hold(prepare,prepare.to,arrived,.12,authored.hand,authored.yielding,'中指到达预备位，无名指末节恢复'));
        result.push(hold(prepare,prepare.to,refolded,.15,authored.hand,authored.yielding,'保持中指预位，无名指恢复折形'));shift+=.27;
      }
      if(segment===release) {
        const base={...release,angleFrom:release.angleTo};
        result.push(hold(base,release.to,restore,authored.exitDuration,authored.supportHand,authored.supportFinger,'两拨已经结束，承托食指平顺恢复原折形'));shift+=authored.exitDuration;
      }
    }
    program.segments=result;program.duration+=shift;
    for(const step of program.steps) {
      step.segments=result.flatMap((s,i)=>s.step===step.index?[i]:[]);
      step.start=result[step.segments[0]].start;const last=result[step.segments.at(-1)!];step.end=last.start+last.duration;
    }
    (program.supportedRelays??=[]).push({...authored,start,ready,yieldStart,lifted,yielded,arrived,refolded,restored,restore,end,referencePrepareStart,referencePrepareEnd,referenceRestore});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function compileRetirementYields(program:TeachingMotion) {
  for(const authored of authoredRetirementYields(program.formulaId)) {
    const index=program.steps[authored.sourceStep]?.segments[0],original=program.segments[index];
    if(!original||original.phase!=='handoff'||original.hand!==authored.hand||original.from[authored.hand].tips[authored.finger].resting||original.regripHands?.length
      ||!original.to[authored.hand].tips[authored.finger].resting||original.contacts.some(c=>c.hand===authored.hand)||!hasHoldingDirections(original.contacts))
      throw new Error('退出让位必须位于另一手接稳后的真实收指阶段');
    if(program.segments.slice(index).some(s=>s.contacts.some(c=>c.hand===authored.hand&&c.finger===authored.finger)))throw new Error('退休手指仍有后续接触任务');
    if(typeof window==='undefined'){const reference=structuredClone(program);reference.formulaId+='::before-retirement-yield';program.authoringReference=reference;}
    program.referenceEdit='retirement-yield';
    const start=original.start,referenceEnd=start+original.duration,lifted=start+.12,yielded=lifted+.15,retired=yielded+original.duration,unturned=retired+.15,via=unturned+.12,end=via+.12,added=end-referenceEnd;
    const hold=(pose:TeachingPose,time:number,duration:number,instruction:string):TeachingSegment=>({...structuredClone(original),start:time,duration,finger:authored.yielding,
      from:copyPose(pose),to:copyPose(pose),instruction,padGuides:undefined});
    const phases=[hold(original.from,start,.12,'无名指末节先抬向掌外，给中指退出留出空间'),hold(original.from,lifted,.15,'保持近节位置，无名指折形向侧方让位'),
      {...original,start:yielded,finger:authored.finger,instruction:'中指沿已经离面的外侧通道收拢，另一手继续承托'},
      hold(original.to,retired,.15,'中指已收拢，无名指先恢复近节方向'),hold(original.to,unturned,.12,'无名指末节经过掌上侧，避开已收拢的中指'),hold(original.to,via,.12,'无名指末节恢复原收纳方向，再进行空手换腕')];
    for(const segment of program.segments.slice(index+1))segment.start+=added;
    program.segments.splice(index,1,...phases);
    for(const step of program.steps){if(step.index>authored.sourceStep)step.start+=added;if(step.index>=authored.sourceStep)step.end+=added;step.segments=program.segments.flatMap((s,i)=>s.step===step.index?[i]:[]);}
    program.duration+=added;(program.retirementYields??=[]).push({...authored,start,lifted,yielded,retired,unturned,via,end,referenceEnd});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function compileGripRecovery(program:TeachingMotion,baseline:TeachingMotion,authored:AuthoredGripRecovery,returnStart:number,returnEnd:number) {
  const step=program.steps[authored.sourceStep],old=baseline.steps[authored.sourceStep];
  const segments=step.segments.map(i=>program.segments[i]),original=old.segments.map(i=>baseline.segments[i]);
  const withoutTime=(s:TeachingSegment)=>{const {start:_start,...rest}=s;return rest;};
  if(JSON.stringify(segments.map(withoutTime))!==JSON.stringify(original.map(withoutTime)))throw new Error('握姿回接要求后继原始姿态与接触逐段一致');
  const start=step.start,referenceEnd=step.end,ready=start+authored.entryDuration,finished=referenceEnd+authored.entryDuration,end=finished+authored.exitDuration;
  const support=segments.find(s=>s.contacts.some(c=>c.hand===authored.supportHand&&c.finger===authored.supportFinger&&V(c.normal).dot(V(NORMALS[authored.supportFace]))>.99));
  const release=segments.find(s=>s.phase==='release');
  if(!support||!release)throw new Error('握姿回接必须含正式承托接入和原释放阶段');
  if(typeof window==='undefined') {
    const reference=structuredClone(program);reference.formulaId+='::before-grip-recovery';
    program.authoringReference=reference;program.authoringAlternate=baseline;
  }
  program.referenceEdit='grip-recovery';
  const first=step.segments[0],last=segments.at(-1)!,added=authored.entryDuration+authored.exitDuration;
  const opening:TeachingSegment={...structuredClone(segments[0]),phase:'handoff',duration:authored.entryDuration,to:copyPose(segments[0].from),
    instruction:'保持原指腹承托，预备这次顶层拨动的连续折指形态',padGuides:undefined};
  const closing:TeachingSegment={...structuredClone(last),start:finished,phase:'handoff',duration:authored.exitDuration,from:copyPose(last.to),to:copyPose(last.to),
    instruction:'顶层拨动已完成，保持承托恢复下一步折指形态',padGuides:undefined};
  for(const segment of program.segments)if(segment.start>=start-1e-8)segment.start+=segment.step===authored.sourceStep?authored.entryDuration:added;
  program.segments.splice(first,0,opening);
  const after=program.segments.findIndex(s=>s.step>authored.sourceStep);program.segments.splice(after<0?program.segments.length:after,0,closing);
  for(const source of program.steps) {
    if(source.index>authored.sourceStep)source.start+=added;if(source.index>=authored.sourceStep)source.end+=added;
    source.segments=program.segments.flatMap((s,i)=>s.step===source.index?[i]:[]);
  }
  program.duration+=added;
  program.gripRecoveries=[{...authored,returnStart,returnEnd,start,ready,finished,end,referenceEnd,originalStart:old.start,originalEnd:old.end,
    supportStart:support.start-authored.entryDuration,supportRestore:release.start-authored.entryDuration}];
  (step.gripNotes??=[]).push(authored.reason);
}
function compileGripTemplates(program:TeachingMotion) {
  for(const authored of authoredGripTemplates(program.formulaId)) {
    const step=program.steps[authored.sourceStep],template=program.steps[authored.referenceStep];
    if(!step||!template||JSON.stringify(step.move)!==JSON.stringify(template.move)
      ||JSON.stringify(step.driver)!==JSON.stringify(template.driver))throw new Error('整段握姿参考必须保持原动作与指定驱动指');
    const first=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='prepare');
    const templateFirst=program.segments.findIndex(s=>s.step===authored.referenceStep&&s.phase==='prepare');
    const core=program.segments.filter(s=>s.step===authored.sourceStep&&s.start>=program.segments[first].start);
    const model=program.segments.filter(s=>s.step===authored.referenceStep&&s.start>=program.segments[templateFirst].start);
    if(core.length!==model.length||core.some((s,i)=>s.phase!==model[i].phase||Math.abs(s.duration-model[i].duration)>1e-8
      ||s.angleFrom!==model[i].angleFrom||s.angleTo!==model[i].angleTo))throw new Error('整段握姿参考的相位与转角必须逐段对应');
    const start=core[0].start,referenceEnd=step.end,templateStart=model[0].start,templateEnd=template.end;
    const ready=start+authored.entryDuration,finished=referenceEnd+authored.entryDuration,end=finished+authored.exitDuration;
    const added=authored.entryDuration+authored.exitDuration;
    if(typeof window==='undefined') {
      const reference=structuredClone(program);reference.formulaId+='::before-grip-template';program.authoringReference=reference;
    }
    program.referenceEdit='grip-template';
    const opening:TeachingSegment={...structuredClone(core[0]),phase:'handoff',duration:authored.entryDuration,
      to:copyPose(core[0].from),instruction:'保持指腹接稳，预备连续两拨的折指形态',padGuides:undefined};
    const last=core.at(-1)!;
    const closing:TeachingSegment={...structuredClone(last),start:finished,phase:'handoff',duration:authored.exitDuration,
      from:copyPose(last.to),to:copyPose(last.to),instruction:'保持承托，恢复下一步的折指形态',padGuides:undefined};
    for(const segment of program.segments)if(segment.start>=start-1e-8)segment.start+=segment.step===authored.sourceStep?authored.entryDuration:added;
    program.segments.splice(first,0,opening);
    const after=program.segments.findIndex(s=>s.step>authored.sourceStep);
    program.segments.splice(after<0?program.segments.length:after,0,closing);
    for(const source of program.steps) {
      if(source.index>authored.sourceStep)source.start+=added;
      if(source.index>=authored.sourceStep)source.end+=added;
      source.segments=program.segments.flatMap((s,i)=>s.step===source.index?[i]:[]);
    }
    program.duration+=added;
    (program.gripTemplates??=[]).push({...authored,start,ready,finished,end,referenceEnd,templateStart,templateEnd});
    (step.gripNotes??=[]).push(authored.reason);
  }
}
function compileExternalPreforms(program:TeachingMotion) {
  for(const authored of authoredExternalPreforms(program.formulaId)) {
    if(typeof window==='undefined') {
      const reference=structuredClone(program);reference.formulaId+='::before-external-preform';program.authoringReference=reference;
    }
    program.referenceEdit='external-preform';
    const index=program.segments.findIndex(s=>s.step===authored.sourceStep&&s.phase==='prepare'&&s.hand===authored.hand&&s.finger===authored.finger),original=program.segments[index];
    if(!original||original.contacts.some(c=>c.hand===authored.hand)||!hasHoldingDirections(original.contacts))throw new Error('方外预成形必须由另一手独立承托');
    const start=original.start,referenceEnd=start+original.duration,withdrawn=start+authored.withdrawDuration,preformed=withdrawn+authored.preformDuration,replayed=preformed+original.duration,end=replayed+authored.returnDuration,added=end-referenceEnd;
    const offset=V(NORMALS[authored.side]).multiplyScalar(authored.distance),translated=(source:TeachingPose)=> {
      const pose=copyPose(source),h=pose[authored.hand];h.palm=A(V(h.palm).add(offset));
      for(const finger of FINGER_NAMES)h.tips[finger].point=A(V(h.tips[finger].point).add(offset));
      return pose;
    };
    const outside=translated(original.from),ready=copyPose(outside),target=translated(original.to);ready[authored.hand].tips[authored.first]=structuredClone(target[authored.hand].tips[authored.first]);
    const phases:TeachingSegment[]=[
      {...structuredClone(original),phase:'handoff',duration:authored.withdrawDuration,to:outside,instruction:'支撑手稳持，拨动手整体退到魔方外侧'},
      {...structuredClone(original),start:withdrawn,duration:authored.preformDuration,finger:authored.first,from:copyPose(outside),to:ready,instruction:'在魔方外侧先准备食指，拇指暂时保持原位'},
      {...structuredClone(original),start:preformed,from:copyPose(ready),to:target,instruction:'食指保持预备形，拇指再进入双层拨动姿态'},
      {...structuredClone(original),start:replayed,duration:authored.returnDuration,phase:'handoff',from:copyPose(target),to:copyPose(original.to),instruction:'双指已错开，整手返回下层外侧预接触位'},
    ];
    for(const segment of program.segments.slice(index+1))segment.start+=added;
    program.segments.splice(index,1,...phases);
    for(const step of program.steps) {
      if(step.index>authored.sourceStep)step.start+=added;
      if(step.index>=authored.sourceStep)step.end+=added;
      step.segments=program.segments.flatMap((s,i)=>s.step===step.index?[i]:[]);
    }
    program.duration+=added;
    (program.externalPreforms??=[]).push({...authored,start,withdrawn,preformed,replayed,end,referenceEnd});
    (program.steps[authored.sourceStep].gripNotes??=[]).push(authored.reason);
  }
}
function safeTipTravel(from:TipPose,to:TipPose,t:number):Vec3 {
  const start=V(from.point),end=V(to.point);
  if(t===0)return from.point;if(t===1)return to.point;
  let blocked=false;
  for(let i=1;i<12;i++) {
    const p=start.clone().lerp(end,i/12);
    if(Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))<.0479){blocked=true;break;}
  }
  if(!blocked)return A(start.lerp(end,t));
  const fromDirection=start.clone().normalize(),toDirection=end.clone().normalize();
  const q=new Quaternion().setFromUnitVectors(fromDirection,toDirection);
  const direction=fromDirection.applyQuaternion(new Quaternion().slerp(q,t));
  const radius=Math.max(start.length()*(1-t)+end.length()*t,.0482/Math.max(Math.abs(direction.x),Math.abs(direction.y),Math.abs(direction.z)));
  return A(direction.multiplyScalar(radius));
}
function mixPose(a:TeachingPose,b:TeachingPose,t:number):TeachingPose {
  if(t===0)return copyPose(a);if(t===1)return copyPose(b);
  return Object.fromEntries(HANDS.map(hand=>[hand,{
    palm:A(V(a[hand].palm).lerp(V(b[hand].palm),t)),
    rotation:new Quaternion().fromArray(a[hand].rotation).slerp(new Quaternion().fromArray(b[hand].rotation),t).toArray(),
    tips:Object.fromEntries(FINGER_NAMES.map(finger=>[finger,{
      resting:t===0?Boolean(a[hand].tips[finger].resting):t===1?Boolean(b[hand].tips[finger].resting):Boolean(a[hand].tips[finger].resting&&b[hand].tips[finger].resting),
      point:safeTipTravel(a[hand].tips[finger],b[hand].tips[finger],t),
      normal:A(V(a[hand].tips[finger].normal).applyQuaternion(new Quaternion().slerp(
        new Quaternion().setFromUnitVectors(V(a[hand].tips[finger].normal),V(b[hand].tips[finger].normal)),t)).normalize()),
    }]))
  }])) as TeachingPose;
}
export function sampleTeachingMotion(program:TeachingMotion,time:number):TeachingFrame {
  time=Math.max(0,Math.min(time,program.duration));
  if(time>=program.duration || !program.steps.length) return {motionId:program.formulaId,time,state:program.states.at(-1)!,step:Math.max(0,program.steps.length-1),
    completed:program.steps.length,angle:0,pose:copyPose(program.boundaries.at(-1)!),contacts:program.finalContacts,phase:'完成',
    instruction:'本段完成。可以逐步回看，或选择另一段公式。',finger:'',complete:true};
  let lo=0,hi=program.segments.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(program.segments[mid].start<=time)lo=mid;else hi=mid-1;}
  const segment=program.segments[lo],t=smooth((time-segment.start)/segment.duration),step=program.steps[segment.step];
  const angle=segment.angleFrom+(segment.angleTo-segment.angleFrom)*t;
  const pose=mixPose(segment.from,segment.to,t);
  if(segment.wristHands) {
    const q=new Quaternion().setFromAxisAngle(V(NORMALS[step.move.face]),angle-segment.angleFrom);
    for(const hand of segment.wristHands) {
      pose[hand].palm=A(V(segment.from[hand].palm).applyQuaternion(q));
      pose[hand].rotation=q.clone().multiply(new Quaternion().fromArray(segment.from[hand].rotation)).toArray();
      for(const finger of FINGER_NAMES) {
        pose[hand].tips[finger].point=A(V(segment.from[hand].tips[finger].point).applyQuaternion(q));
        pose[hand].tips[finger].normal=A(V(segment.from[hand].tips[finger].normal).applyQuaternion(q));
      }
    }
  }
  for(const hand of segment.regripHands??[]) {
    const from=segment.from[hand],to=segment.to[hand],rotation=new Quaternion().fromArray(pose[hand].rotation);
    const inverseFrom=new Quaternion().fromArray(from.rotation).invert(),inverseTo=new Quaternion().fromArray(to.rotation).invert();
    for(const finger of FINGER_NAMES) {
      const localFrom=V(from.tips[finger].point).sub(V(from.palm)).applyQuaternion(inverseFrom);
      const localTo=V(to.tips[finger].point).sub(V(to.palm)).applyQuaternion(inverseTo);
      pose[hand].tips[finger].point=A(localFrom.lerp(localTo,t).applyQuaternion(rotation).add(V(pose[hand].palm)));
      pose[hand].tips[finger].normal=A(V(from.tips[finger].normal).applyQuaternion(inverseFrom).applyQuaternion(rotation));
    }
  }
  for(const hand of HANDS)for(const finger of FINGER_NAMES)if(pose[hand].tips[finger].resting)pose[hand].tips[finger]=restingTip(hand,finger,pose);
  for(const path of program.underReceptions??[])if(time>=path.start&&time<=path.end) {
    const progress=Math.max(0,Math.min(1,(time-path.routeStart)/(path.landed-path.routeStart))),blend=progress*progress*(3-2*progress);
    const normal=A(V(path.normals[0]).lerp(V(path.normals[1]),blend).normalize());
    let point=path.points[0];
    if(time>=path.landed)point=path.points.at(-1)!;
    else if(time>=path.routeStart) {
      let k=0;while(k<4&&time>=path.breaks[k+1])k++;
      const u=(time-path.breaks[k])/(path.breaks[k+1]-path.breaks[k]),weight=u*u*(3-2*u);
      point=A(V(path.points[k]).lerp(V(path.points[k+1]),weight));
    }
    pose[path.hand].tips[path.finger]={point,normal};
  }
  for(const contact of segment.contacts) setTip(pose,contact,step.move,angle);
  const phases={prepare:'靠近',contact:'接触',drive:'拨动',release:'释放',handoff:'衔接'};
  return {motionId:program.formulaId,time,state:program.states[segment.step],step:segment.step,completed:segment.step,move:step.move,angle,pose,
    contacts:segment.contacts,phase:phases[segment.phase],instruction:segment.instruction,
    finger:step.move.kind==='rotation'?'双手握持':fingerLabel(segment.hand,segment.finger),complete:false,activeHand:segment.hand,activeFinger:segment.finger};
}
export function teachingBoundaryTime(program:TeachingMotion,step:number):number {
  const k=Math.max(0,Math.min(program.steps.length,Math.round(step)));
  return k===program.steps.length?program.duration:program.steps[k]?.start??0;
}
export function validateTeachingMotion(program:TeachingMotion) {
  const errors:string[]=[];
  let contacts=0,driveSamples=0,maxSlip=0,minWork=1;
  for(const segment of program.segments) {
    if(!hasHoldingDirections(segment.contacts))errors.push(`step ${segment.step}: ${segment.phase} only has same-facing contacts`);
    if(segment.contacts.length<2)errors.push(`step ${segment.step}: ${segment.phase} lacks a receiving grip`);
    for(const contact of segment.contacts) {
      const n=V(contact.normal),local=V(contact.local);
      if(Math.abs(n.length()-1)>1e-7||Math.abs(local.dot(n)-.015)>1e-7||contact.cubie.some(c=>Math.abs(c)>1||Math.abs(c-Math.round(c))>1e-7))
        errors.push(`step ${segment.step}: invalid held cubie surface`);
    }
    if(segment.phase!=='drive') continue;
    const move=program.steps[segment.step].move;
    const gripHands=new Set((segment.wristHands??[]).filter(hand=> {
      const pads=segment.contacts.filter(c=>c.hand===hand&&c.rotating);
      const opposed=pads.some(a=>pads.some(b=>V(a.normal).dot(V(b.normal))<-.8));
      if(!opposed)errors.push(`step ${segment.step}: wrist grip lacks opposing pads`);
      return opposed;
    }));
    for(const contact of segment.contacts) {
      if(contact.rotating && !moveAffects(move,contact.cubie)) errors.push(`step ${segment.step}: drive outside selected layer`);
      if(!contact.rotating && moveAffects(move,contact.cubie)) errors.push(`step ${segment.step}: support on moving layer`);
      const local=V(contact.local),n=V(contact.normal);
      if(Math.abs(local.dot(n)-.015)>.00001) errors.push(`step ${segment.step}: anchor is not on cubie surface`);
      contacts++;
    }
    for(let i=0;i<=8;i++) {
      const frame=sampleTeachingMotion(program,segment.start+segment.duration*(i/8));
      if(i===8) continue;
      for(const contact of segment.contacts.filter(c=>c.rotating)) {
        const surface=contactPoint(contact,move,frame.angle),tip=frame.pose[contact.hand].tips[contact.finger];
        maxSlip=Math.max(maxSlip,V(tip.point).distanceTo(V(surface.point).addScaledVector(V(surface.normal),padOf(contact.finger))));
        if(move.kind!=='rotation'&&!gripHands.has(contact.hand)) {
          const velocity=V(NORMALS[move.face]).cross(V(surface.point)).multiplyScalar(Math.sign(moveAngle(move))).normalize();
          minWork=Math.min(minWork,V(surface.normal).negate().dot(velocity));
        }
        driveSamples++;
      }
    }
  }
  if(maxSlip>1e-7) errors.push(`contact slip ${maxSlip}`);
  if(minWork<.35-1e-8) errors.push(`pushing direction ${minWork}`);
  return {formulaId:program.formulaId,sourceSteps:program.steps.length,segments:program.segments.length,
    contacts,driveSamples,maxContactSlipMetres:maxSlip,minInwardWork:minWork,errors,
    passed:errors.length===0,limits:'Geometric anchors and turn semantics only; articulated geometry and visual finger credibility require separate checks.'};
}
