import type { HandPose } from "./motion";
import type { FingerProgram, FingerSegment } from "./finger-program";

const ARC_DIVISIONS = 128;
const RAMP = 0.15;
const TURN_FLOOR = 2.05 / 60;
const OTHER_FLOOR = 1e-6;

interface Arc {
  cumulative: number[];
  length: number;
}

function handDistance(a: HandPose, b: HandPose) {
  const joint = Math.max(
    0,
    ...Object.keys(a.joints ?? {}).map((key) =>
      Math.abs(a.joints![key] - (b.joints?.[key] ?? 0)),
    ),
  );
  return a.position.distanceTo(b.position)
    + 0.07 * a.quaternion.angleTo(b.quaternion)
    + 0.025 * joint;
}

function measureArc(segment: FingerSegment): Arc {
  const cumulative = [0];
  let previous = segment.sample(0);
  for (let i = 1; i <= ARC_DIVISIONS; i++) {
    const pose = segment.sample(i / ARC_DIVISIONS);
    const distance = Math.max(
      handDistance(previous.left, pose.left),
      handDistance(previous.right, pose.right),
      0.045 * Math.abs(pose.angle - previous.angle),
    );
    cumulative.push(cumulative.at(-1)! + distance);
    previous = pose;
  }
  return { cumulative, length: cumulative.at(-1)! };
}

/** Integral of a smooth velocity ramp, followed by cruise and deceleration. */
function distanceAt(time: number) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const integral = (u: number) => u ** 6 - 3 * u ** 5 + 2.5 * u ** 4;
  if (time < RAMP) return RAMP * integral(time / RAMP) / (1 - RAMP);
  if (time > 1 - RAMP)
    return 1 - RAMP * integral((1 - time) / RAMP) / (1 - RAMP);
  return (time - RAMP / 2) / (1 - RAMP);
}

function sourceProgress(arc: Arc, time: number) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  if (arc.length < 1e-12) return time;
  const target = distanceAt(time) * arc.length;
  let lo = 0, hi = arc.cumulative.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc.cumulative[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = arc.cumulative[hi] - arc.cumulative[lo];
  return (lo + (span > 0 ? (target - arc.cumulative[lo]) / span : 0))
    / ARC_DIVISIONS;
}

/**
 * Change only timing, retaining the exact original pose/contact path and order.
 * TURN segments receive at least 2.05 nominal 60 Hz frames. This is a visibility
 * budget, not a mechanical speed or perceptual-fluidity guarantee. `cost`
 * remains the source compiler's relative budget for compatibility; it is not
 * the arc metric or an estimate of physical execution seconds.
 */
export function retimeFingerProgram(program: FingerProgram): FingerProgram {
  if (!program.segments.length) return program;
  if (!Number.isFinite(program.duration) || program.duration <= 0)
    throw new Error("动作时长必须是有限的正数。");
  const lower = program.segments.map((segment) =>
    segment.stage === "TURN" ? TURN_FLOOR : OTHER_FLOOR,
  );
  if (lower.reduce((sum, value) => sum + value, 0) > program.duration)
    throw new Error("当前时长无法容纳每次转层的最低显示时间，请延长演示时长。");

  const arcs = program.segments.map(measureArc);
  const weights = arcs.map((arc) => Math.max(arc.length, 1e-5));
  let lo = 0, hi = program.duration / Math.min(...weights);
  for (let pass = 0; pass < 80; pass++) {
    const scale = (lo + hi) / 2;
    const sum = weights.reduce((total, weight, i) =>
      total + Math.max(lower[i], scale * weight), 0);
    if (sum > program.duration) hi = scale;
    else lo = scale;
  }
  let time = 0;
  const segments = program.segments.map((source, i): FingerSegment => {
    const span = i === program.segments.length - 1
      ? program.duration - time
      : Math.max(lower[i], lo * weights[i]);
    const segment = {
      ...source,
      start: time,
      duration: span,
      sample: (progress: number) => source.sample(sourceProgress(arcs[i], progress)),
    };
    time += span;
    return segment;
  });
  const starts = new Map<number, number>();
  for (const segment of segments)
    if (!starts.has(segment.index)) starts.set(segment.index, segment.start);
  const steps = program.steps.map((step, i) => {
    const start = starts.get(i), end = starts.get(i + 1) ?? program.duration;
    if (start === undefined || end < start)
      throw new Error("动作片段与步骤顺序不一致，无法重排时间。");
    return { ...step, start, duration: end - start };
  });
  return {
    ...program,
    steps,
    segments,
    sample: (at: number) => {
      if (at >= program.duration) return program.sample(program.duration);
      const current = Math.max(0, at);
      let lo = 0, hi = segments.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segments[mid].start <= current) lo = mid;
        else hi = mid - 1;
      }
      const segment = segments[lo], original = program.segments[lo];
      const progress = sourceProgress(arcs[lo], (current - segment.start) / segment.duration);
      const end = original.start + original.duration;
      // Keep the public source sampler inside this half-open segment despite
      // normalization rounding at block boundaries. Geometry still comes from
      // that original sampler; metadata (orientation/finger/phase) is retained.
      const epsilon = Math.min(original.duration / 4, Number.EPSILON * Math.max(1, end) * 16);
      const originalTime = Math.max(original.start + epsilon,
        Math.min(end - epsilon, original.start + original.duration * progress));
      return program.sample(originalTime);
    },
  };
}
