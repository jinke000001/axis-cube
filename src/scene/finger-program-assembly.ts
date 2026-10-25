import { Quaternion } from "three";
import type { Move } from "../core/cube";
import type { HandPose, MotionFrame } from "./motion";
import { clonePose, oppositeHand } from "./finger-data";
import { compileFingerProgram, type FingerProgram, type FingerSegment } from "./finger-program";

export const emptyFingerStatistics = (): FingerProgram["statistics"] => ({
  fingerTurns: 0, wristTurns: 0, retainedWrists: 0, regrips: 0, reorientations: 0,
});
export function sameHandPose(a: HandPose, b: HandPose, tolerance = 1e-7) {
  return a.position.distanceTo(b.position) <= tolerance &&
    a.quaternion.angleTo(b.quaternion) <= tolerance &&
    Object.keys(a.joints ?? {}).length === Object.keys(b.joints ?? {}).length &&
    Object.entries(a.joints ?? {}).every(([key, value]) =>
      b.joints?.[key] !== undefined && Math.abs(value - b.joints[key]) <= tolerance);
}
const sameHands = (a: ReturnType<FingerSegment["sample"]>, b: ReturnType<FingerSegment["sample"]>) =>
  sameHandPose(a.left, b.left) && sameHandPose(a.right, b.right);

/** Remove empty return/entry excursions at aligned outer-turn boundaries.
 * No new geometric path is interpolated: retained endpoints are the same pose.
 * Rotation boundaries are excluded because their material frame changes.
 * Incoming support/drive roles still come from the calibrated next segment.
 */
export function retainJoinedGrip(moves: readonly Move[], input: readonly FingerSegment[]) {
  const groups = moves.map((_, index) => input.filter((segment) => segment.index === index));
  let removedSegments = 0;
  for (let index = 0; index + 1 < groups.length; index++) {
    if (moves[index].kind || moves[index + 1].kind) continue;
    const left = groups[index], right = groups[index + 1];
    while (left.at(-1)?.stage === "HOLD" && left.length > 1 && right.length &&
      sameHands(left.at(-1)!.sample(0), right[0].sample(0)) &&
      sameHands(left.at(-1)!.sample(0), left.at(-1)!.sample(1))) {
      left.pop(); removedSegments++;
    }
    while (left.length > 1 && right.length > 1) {
      const before = left.at(-1)!, after = right[0];
      if (before.stage !== "PREPARE" || after.stage !== "PREPARE" ||
        before.active !== after.active || !sameHands(before.sample(0), after.sample(1))) break;
      // Keep a continuous trajectory on both sides of the new step commit.
      if (!sameHands(left[left.length - 2].sample(1), before.sample(0)) ||
        !sameHands(after.sample(1), right[1].sample(0))) break;
      left.pop(); right.shift(); removedSegments += 2;
    }
  }
  return { segments: groups.flat(), removedSegments };
}

/** Assemble calibrated blocks without changing their pose/contact samplers. */
export function assembleFingerPrograms(
  blocks: readonly FingerProgram[], duration: number, retainGrip = false,
): FingerProgram & { removedSegments: number } {
  const moves = blocks.flatMap((block) => block.steps.map((step) => step.move));
  if (!moves.length) return { ...compileFingerProgram([]), removedSegments: 0 };
  let offset = 0;
  const source = blocks.flatMap((block) => {
    const result = block.segments.map((segment) => ({ ...segment, index: segment.index + offset,
      duration: segment.duration / block.duration * block.cost }));
    offset += block.steps.length;
    return result;
  });
  const joined = retainGrip ? retainJoinedGrip(moves, source) : { segments: source, removedSegments: 0 };
  const cost = joined.segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (!Number.isFinite(duration) || duration <= 0 || !(cost > 0)) throw new Error("动作编排时长无效。");
  let time = 0;
  const segments = joined.segments.map((segment, index) => {
    // Close the final interval exactly: accumulated division error must not
    // let a later timing map sample the completed frame before the deadline.
    const span = index === joined.segments.length - 1
      ? duration - time : segment.duration / cost * duration;
    const result = { ...segment, start: time, duration: span };
    time += result.duration; return result;
  });
  const starts = new Map<number, number>();
  segments.forEach((segment) => { if (!starts.has(segment.index)) starts.set(segment.index, segment.start); });
  const originalSteps = blocks.flatMap((block) => block.steps);
  const steps = originalSteps.map((step, index) => {
    const start = starts.get(index);
    if (start === undefined) throw new Error("编排不能删掉实际转层。");
    return { ...step, start, duration: (starts.get(index + 1) ?? duration) - start };
  });
  const statistics = emptyFingerStatistics();
  blocks.forEach((block) => {
    for (const key of Object.keys(statistics) as (keyof typeof statistics)[]) statistics[key] += block.statistics[key];
  });
  const sample = (at: number): MotionFrame => {
    if (at >= duration) return { ...blocks.at(-1)!.sample(blocks.at(-1)!.duration), index: moves.length, complete: true };
    const current = Math.max(0, at);
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segments[mid].start <= current) lo = mid; else hi = mid - 1; }
    const segment = segments[lo], progress = Math.min(1, Math.max(0, (current - segment.start) / segment.duration));
    const pose = segment.sample(progress);
    return { ...pose, left: clonePose(pose.left), right: clonePose(pose.right), index: segment.index,
      orientation: new Quaternion(), phase: segment.phase, stage: segment.stage, active: segment.active,
      support: segment.active ? oppositeHand(segment.active) : "left", activeFinger: segment.finger, progress, complete: false };
  };
  return { steps, segments, cost, duration, statistics, sample, removedSegments: joined.removedSegments };
}
