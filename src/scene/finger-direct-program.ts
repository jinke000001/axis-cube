import { Quaternion, Vector3 } from "three";
import { moveAngle, NORMALS, type Move } from "../core/cube";
import { CENTER, smooth, type HandPose, type MotionFrame, type Side } from "./motion";
import { fingerPaths, type FingerProgram, type FingerSegment } from "./finger-program";
import { clonePose, fingerContacts, fingerLibrary, handPose, oppositeHand, rotatedFingerPose,
  sampledPose, strokeSample, withFinger, type ContactData, type PoseData } from "./finger-data";
import type { FingerContact } from "./finger-contact";
import type { FingerIndex } from "./finger-rig";
import type { PlaybackStep } from "./playback";
import raw from "./finger-direct.json";

interface Entry {
  rotation: number[];
  support: { pose: PoseData; contacts: ContactData[]; areaM2: number };
  supportEntry: PoseData[][];
  activeEntry: PoseData[][];
}
const direct = raw as unknown as { faces: Record<string, { hands: Record<Side, Entry> }> };
export const hasDirectFingerPath = (move: Move) => !move.kind && !!direct.faces[move.face];
const entryCosts = new Map<Entry, number>();
function entryCost(entry: Entry) {
  if (!entryCosts.has(entry)) {
    const metres = entry.activeEntry.reduce((sum, group) => sum + group.slice(1).reduce((length, pose, i) =>
      length + new Vector3().fromArray(pose.position).distanceTo(new Vector3().fromArray(group[i].position)), 0), 0);
    // The existing score uses roughly .18 units per 65 mm withdrawal. Use the
    // measured entry distance here so the longer D access is not priced as F.
    entryCosts.set(entry, metres * 2.5);
  }
  return entryCosts.get(entry)!;
}

/** Reuse the measured index/middle stroke, with a separate measured support
 * and entry for each face. The cube keeps its orientation throughout. */
export function compileDirectFingerProgram(moves: readonly Move[], duration = 5): FingerProgram {
  if (!moves.length || moves.some(move => !hasDirectFingerPath(move)))
    throw new Error("此面尚无校准的直接指拨路径。");
  const poses: Record<Side, HandPose> = {
    left: handPose(fingerLibrary.hands.left.support), right: handPose(fingerLibrary.hands.right.support),
  };
  const segments: FingerSegment[] = [], steps: PlaybackStep[] = [];
  const statistics = { fingerTurns: 0, wristTurns: 0, retainedWrists: 0, regrips: 0, reorientations: 0 };
  let total = 0, index = 0, angle = 0;
  const sideName = (side: Side) => side === "left" ? "左" : "右";
  function add(stage: string, phase: string, weight: number, active: Side,
    sample: FingerSegment["sample"], finger?: FingerIndex) {
    segments.push({ index, start: total, duration: weight, stage, phase, active, finger, sample });
    total += weight;
    const end = sample(1);
    poses.left = clonePose(end.left); poses.right = clonePose(end.right);
  }
  function path(side: Side, groups: PoseData[][], contacts: FingerContact[], phase: string,
    weight: number, rotation?: Quaternion, reverse = false) {
    const fixed = clonePose(poses[oppositeHand(side)]), heldAngle = angle;
    for (const frames of reverse ? [...groups].reverse() : groups) {
      add("PREPARE", phase, weight / groups.length, side, p => {
        let pose = sampledPose(frames, reverse ? 1 - smooth(p) : smooth(p));
        if (rotation) pose = rotatedFingerPose(pose, rotation);
        return { ...poses, [side]: pose, [oppositeHand(side)]: clonePose(fixed), contacts, angle: heldAngle };
      });
    }
  }
  for (index = 0; index < moves.length; index++) {
    const move = moves[index], start = total, active: Side = moveAngle(move) < 0 ? "right" : "left";
    const support = oppositeHand(active), face = direct.faces[move.face], entry = face.hands[active];
    const rotation = new Quaternion().fromArray(entry.rotation), normal = new Vector3(...NORMALS[move.face]);
    const lowContacts = fingerContacts(active, fingerLibrary.hands[active].contacts);
    const supportContacts = fingerContacts(support, face.hands[support].support.contacts);
    angle = 0;
    path(support, face.hands[support].supportEntry, lowContacts, `${sideName(support)}手调整支点`, .3);
    path(active, entry.activeEntry, supportContacts, `${sideName(active)}指到达${move.face}面`, entryCost(entry));
    const count = move.turns === 2 ? 2 : 1;
    for (let quarter = 0; quarter < count; quarter++) {
      const finger = (quarter ? 3 : 2) as FingerIndex, id = `${active}-${quarter ? "middle" : "index"}`;
      const stroke = fingerLibrary.strokes[id], record = fingerPaths.strokes[id];
      path(active, count === 2 && quarter ? record.prepare.slice(-1) : record.prepare,
        supportContacts, `${sideName(active)}${quarter ? "中指" : "食指"}预备`, quarter ? .07 : .22, rotation);
      const base = clonePose(poses[active]), fixed = clonePose(poses[support]), offset = angle;
      const point = new Vector3().fromArray(stroke.samples[0].target).sub(CENTER)
        .applyQuaternion(rotation).applyAxisAngle(normal, -offset);
      add("TURN", `${sideName(active)}${quarter ? "中指接力" : "食指拨层"}`, 1, active, p => {
        const progress = smooth(p), sample = strokeSample(stroke, progress);
        const pose = count === 2 && quarter === 0
          ? rotatedFingerPose(sampledPose(record.overlapTurn!, progress), rotation)
          : withFinger(base, active, finger, sample.angles);
        const drive: FingerContact = { side: active, finger, role: "drive", point, normal, padOffset: sample.padOffset };
        return { ...poses, [active]: pose, [support]: clonePose(fixed), contacts: [...supportContacts, drive], angle: offset + sample.angle };
      }, finger);
      angle = offset + stroke.samples.at(-1)!.angle;
      statistics.fingerTurns++;
      path(active, count === 2 && quarter === 0 ? record.overlapRelease! : record.release,
        supportContacts, `${sideName(active)}指退出转层`, .2, rotation);
    }
    path(active, entry.activeEntry, supportContacts, `${sideName(active)}手回接`, entryCost(entry), undefined, true);
    path(support, face.hands[support].supportEntry, lowContacts, `${sideName(support)}手恢复承托`, .3, undefined, true);
    steps.push({ move, start, duration: total - start, active });
  }
  const scale = duration / total, last = { left: clonePose(poses.left), right: clonePose(poses.right) };
  for (const segment of segments) { segment.start *= scale; segment.duration *= scale; }
  for (const step of steps) { step.start *= scale; step.duration *= scale; }
  const sample = (time: number): MotionFrame => {
    if (time >= duration) return { ...last, index: moves.length, angle: 0, orientation: new Quaternion(),
      phase: "稳持完成", stage: "HOLD", active: null, support: "left", progress: 1, complete: true,
      contacts: (["left", "right"] as Side[]).flatMap(side => fingerContacts(side, fingerLibrary.hands[side].contacts)) };
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segments[mid].start <= time) lo = mid; else hi = mid - 1; }
    const segment = segments[lo], progress = Math.max(0, Math.min(1, (time - segment.start) / segment.duration));
    return { ...segment.sample(progress), index: segment.index, orientation: new Quaternion(),
      phase: segment.phase, stage: segment.stage, active: segment.active, support: oppositeHand(segment.active!),
      activeFinger: segment.finger, progress, complete: false };
  };
  return { steps, segments, duration, cost: total, statistics, sample };
}
