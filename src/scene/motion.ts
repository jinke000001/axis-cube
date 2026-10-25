import { Matrix4, Quaternion, Vector3 } from "three";
import { NORMALS, type Move } from "../core/cube";
import { planGrips, type GripAssignment, type Side } from "./grip-planner";
import type { FingerContact } from "./finger-contact";
import type { FingerIndex } from "./finger-rig";
export type { Side } from "./grip-planner";
export const CENTER = new Vector3(0, 0.34, 0);
export const CUBE_SIZE = 0.09;
export const RACE_DURATION = 5;
export interface HandPose {
  position: Vector3;
  quaternion: Quaternion;
  closed: number;
  /** Explicit manufacturer joint angles for independently articulated fingers. */
  joints?: Record<string, number>;
}
export type MotionStage =
  | "CLEAR"
  | "REORIENT"
  | "RECEIVE"
  | "UNLOAD"
  | "TRANSFER"
  | "SUPPORT"
  | "PREPARE"
  | "WINDUP_OPEN"
  | "WINDUP_MOVE"
  | "WINDUP_GRIP"
  | "TURN"
  | "RELEASE"
  | "RESET"
  | "CONTACT"
  | "HOLD";
export interface MotionSegment {
  stage: MotionStage;
  start: number;
  duration: number;
}
export interface MotionStep {
  move: Move;
  start: number;
  duration: number;
  before: Quaternion;
  after: Quaternion;
  active: Side;
  reorient: boolean;
  entryReleased: boolean;
  exitReleased: boolean;
  entryPose?: HandPose;
  segments: MotionSegment[];
}
export interface MotionFrame {
  index: number;
  phase: string;
  stage: string;
  angle: number;
  orientation: Quaternion;
  left: HandPose;
  right: HandPose;
  /** The hand attached to the non-turning body, not merely a closed fist. */
  support: Side | null;
  progress: number;
  active: Side | null;
  complete: boolean;
  activeFinger?: FingerIndex;
  contacts?: readonly FingerContact[];
}
export const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// Free travel accelerates gently, cruises, then brakes. Compared with a
// rest-to-rest quintic over the same time, its peak speed is lower (1.25 vs 1.875).
const transport = (t: number): number => {
  t = Math.max(0, Math.min(1, t));
  if (t > 0.8) return 1 - transport(1 - t);
  if (t >= 0.2) return (t - 0.1) / 0.8;
  const u = t / 0.2;
  return 0.25 * (u * u * u - 0.5 * u * u * u * u);
};
const vecX = new Vector3(1, 0, 0);
export const RIGHT_APPROACH = new Quaternion().setFromAxisAngle(
  vecX,
  Math.PI / 2,
);
export const LEFT_APPROACH = new Quaternion().setFromAxisAngle(
  vecX,
  (Math.PI * 7) / 6,
);
export function canonical(side: Side, open = 0): HandPose {
  const sign = side === "left" ? -1 : 1;
  const matrix = new Matrix4().makeBasis(
    new Vector3(-sign, 0, 0),
    new Vector3(0, 0, sign),
    new Vector3(0, 1, 0),
  );
  const pose = {
    position: new Vector3(
      sign * (0.09 + open * 0.12),
      CENTER.y - 0.14,
      -open * 0.01,
    ),
    quaternion: new Quaternion().setFromRotationMatrix(matrix),
    closed: 1 - open,
  };
  return rotated(pose, side === "left" ? LEFT_APPROACH : RIGHT_APPROACH);
}
function rotated(p: HandPose, q: Quaternion): HandPose {
  return {
    position: p.position.clone().sub(CENTER).applyQuaternion(q).add(CENTER),
    quaternion: q.clone().multiply(p.quaternion),
    closed: p.closed,
  };
}
function blend(
  a: HandPose,
  b: HandPose,
  t: number,
  arc = 0,
  curve = smooth,
): HandPose {
  const u = curve(t),
    position = a.position.clone().lerp(b.position, u);
  // The excursion shares the same zero-velocity endpoints as the main path.
  if (arc)
    position.addScaledVector(
      position.clone().sub(CENTER).normalize(),
      Math.sin(Math.PI * u) * arc,
    );
  return {
    position,
    quaternion: a.quaternion.clone().slerp(b.quaternion, u),
    closed: a.closed + (b.closed - a.closed) * u,
  };
}
function released(pose: HandPose, side: Side): HandPose {
  return {
    ...pose,
    position: pose.position
      .clone()
      .addScaledVector(vecX, side === "left" ? -0.04 : 0.04),
    closed: 0.96,
  };
}
function turnPose(side: Side, angle: number) {
  return rotated(
    canonical(side),
    new Quaternion().setFromAxisAngle(vecX, angle * (side === "left" ? -1 : 1)),
  );
}
function receivingPoses(active: Side, delta: Quaternion) {
  const lane = vecX
    .clone()
    .multiplyScalar(active === "right" ? 0.08 : -0.08)
    .applyQuaternion(delta);
  const open = released(canonical(active), active),
    grip = canonical(active);
  return {
    open,
    outside: {
      ...open,
      position: open.position.clone().add(lane),
      closed: 1,
    },
    inside: { ...grip, position: grip.position.clone().add(lane) },
    grip,
  };
}
function receive(active: Side, delta: Quaternion, t: number): HandPose {
  const { outside, inside, grip } = receivingPoses(active, delta),
    u = smooth(t),
    v = 1 - u;
  // A continuous rounded approach through the clear side lane: no stop at its corner.
  const position = outside.position
    .clone()
    .multiplyScalar(v * v * v)
    .addScaledVector(inside.position, 3 * v * v * u + 3 * v * u * u)
    .addScaledVector(grip.position, u * u * u);
  return {
    position,
    quaternion: grip.quaternion.clone(),
    closed: outside.closed + (1 - outside.closed) * smooth(Math.min(1, t * 2)),
  };
}
export interface MotionOptions {
  reorientHands?: readonly Side[];
}
export function compileMotion(
  moves: Move[],
  options: MotionOptions = {},
): MotionStep[] {
  return assembleMotion(planGrips(moves, options, measureMotionEdge));
}
/** Deterministic trajectory construction for geometry validation of a chosen plan. */
export function compileGripPlan(plan: readonly GripAssignment[]) {
  return assembleMotion(plan);
}
function assembleMotion(
  plan: readonly GripAssignment[],
  normalize = true,
): MotionStep[] {
  const steps: MotionStep[] = plan.map((assignment) => ({
    ...assignment,
    before: assignment.before.clone(),
    after: assignment.after.clone(),
    start: 0,
    duration: 0,
    entryReleased: false,
    exitReleased: false,
    segments: [],
  }));
  let time = 0;
  steps.forEach((step, i) => {
    const next = steps[i + 1];
    step.entryReleased = i > 0 && steps[i - 1].exitReleased;
    step.exitReleased = !!next && step.active === next.active && next.reorient;
    if (step.entryReleased) {
      const previous = steps[i - 1];
      const roll =
        previous.move.turns === 2 || previous.move.turns === 1
          ? -Math.PI / 2
          : Math.PI / 2;
      step.entryPose = released(
        turnPose(previous.active, roll),
        previous.active,
      );
    }
    step.start = time;
    const add = (stage: MotionStage, duration: number) => {
      step.segments.push({ stage, start: time, duration });
      time += duration;
    };
    if (step.reorient) {
      if (!step.entryReleased) add("CLEAR", 0.32);
      add("REORIENT", 0.7);
      add("RECEIVE", 0.3);
      add("UNLOAD", 0.13);
      add("TRANSFER", 0.8);
      add("SUPPORT", 0.16);
    } else if (i === 0) add("PREPARE", 0.12);
    if (step.move.turns === 2) {
      // Pre-position outside the turning face before one uninterrupted half turn.
      add("WINDUP_OPEN", 0.12);
      add("WINDUP_MOVE", 0.55);
      add("WINDUP_GRIP", 0.12);
    }
    add("TURN", step.move.turns === 2 ? 2.7 : 2);
    add("RELEASE", 0.14);
    if (!step.exitReleased) {
      add("RESET", 0.6);
      add("CONTACT", 0.18);
    }
    if (!next) add("HOLD", 1.5);
    step.duration = time - step.start;
  });
  // Allocate the five-second score AFTER removing redundant gestures and giving
  // most of the visible time to turns. Slow playback samples this exact score.
  const scale = normalize && time ? RACE_DURATION / time : 1;
  for (const step of steps) {
    step.start *= scale;
    step.duration *= scale;
    for (const segment of step.segments) {
      segment.start *= scale;
      segment.duration *= scale;
    }
  }
  return steps;
}
const edgeMeasures = new Map<string, { duration: number; travel: number }>();
/** Charge only the previous move's pending recovery and the next move's body.
 * The state therefore needs its orientation and last hand, not a full history.
 * Duration is the uncompressed gesture budget. Travel breaks ties using the
 * longer of the two concurrent hand paths (position + 70 mm * rotation).
 */
export function measureMotionEdge(
  previous: GripAssignment | null,
  current: GripAssignment | null,
) {
  if (!previous && !current) return { duration: 0, travel: 0 };
  const normal = current
    ? new Vector3(...NORMALS[current.move.face])
        .applyQuaternion(current.before)
        .toArray()
        .map(Math.round)
        .join(",")
    : "end";
  const key = `${previous?.active ?? "start"}:${previous?.move.turns ?? 0}:${current?.active ?? "end"}:${current?.move.turns ?? 0}:${normal}`;
  const cached = edgeMeasures.get(key);
  if (cached) return cached;
  const steps = assembleMotion(
    [previous, current].filter((s): s is GripAssignment => !!s),
    false,
  );
  const tail = new Set<MotionStage>(["RESET", "CONTACT", "HOLD"]);
  let duration = 0,
    travel = 0;
  for (const [index, step] of steps.entries())
    for (const segment of step.segments) {
      const isPrevious = !!previous && index === 0;
      if (isPrevious ? !tail.has(segment.stage) : tail.has(segment.stage))
        continue;
      duration += segment.duration;
      const lengths = { left: 0, right: 0 };
      let last = sampleMotion(steps, segment.start);
      for (let sample = 1; sample <= 16; sample++) {
        const frame = sampleMotion(
          steps,
          segment.start + (segment.duration * sample) / 16,
        );
        for (const side of ["left", "right"] as const)
          lengths[side] +=
            frame[side].position.distanceTo(last[side].position) +
            0.07 * frame[side].quaternion.angleTo(last[side].quaternion);
        last = frame;
      }
      travel += Math.max(lengths.left, lengths.right);
    }
  const result = { duration, travel };
  edgeMeasures.set(key, result);
  return result;
}
export function motionPlanCost(plan: readonly GripAssignment[]) {
  let duration = 0,
    travel = 0;
  for (let i = 0; i <= plan.length; i++) {
    const cost = measureMotionEdge(plan[i - 1] ?? null, plan[i] ?? null);
    duration += cost.duration;
    travel += cost.travel;
  }
  return { duration, travel };
}
export const motionDuration = (steps: MotionStep[]) =>
  steps.length
    ? steps[steps.length - 1].start + steps[steps.length - 1].duration
    : 0;
/** Geometry sampling follows each gesture, independent of playback duration. */
export function motionSampleTimes(
  steps: MotionStep[],
  divisions = 32,
): number[] {
  const times = steps.flatMap((step) =>
    step.segments.flatMap((segment) =>
      Array.from(
        { length: divisions },
        (_, i) => segment.start + (segment.duration * i) / divisions,
      ),
    ),
  );
  return [...times, motionDuration(steps)];
}
const labels: Record<MotionStage, string> = {
  CLEAR: "让出换向空间",
  REORIENT: "换向 · 另一手预备",
  RECEIVE: "顺势接稳",
  UNLOAD: "支撑交接",
  TRANSFER: "空手回接",
  SUPPORT: "指腹贴合",
  PREPARE: "准备发力",
  WINDUP_OPEN: "松指蓄势",
  WINDUP_MOVE: "预摆手腕",
  WINDUP_GRIP: "接稳转层",
  TURN: "连贯转层",
  RELEASE: "卸力松指",
  RESET: "准备下一步",
  CONTACT: "稳稳接回",
  HOLD: "还原完成",
};
export function sampleMotion(steps: MotionStep[], time: number): MotionFrame {
  const total = motionDuration(steps);
  if (!steps.length || time >= total)
    return {
      index: steps.length,
      phase: "还原完成",
      stage: "COMPLETE",
      angle: 0,
      orientation: steps.at(-1)?.after.clone() ?? new Quaternion(),
      left: canonical("left"),
      right: canonical("right"),
      support: "left",
      progress: 1,
      active: null,
      complete: true,
    };
  const index = Math.max(
    0,
    steps.findIndex(
      (_, i) => i === steps.length - 1 || time < steps[i + 1].start,
    ),
  );
  const step = steps[index],
    active = step.active,
    other: Side = active === "left" ? "right" : "left";
  const segment =
    step.segments.find(
      (_, i) =>
        i === step.segments.length - 1 || time < step.segments[i + 1].start,
    ) ?? step.segments.at(-1)!;
  const t = Math.max(0, Math.min(1, (time - segment.start) / segment.duration)),
    stage = segment.stage;
  const hands = { left: canonical("left"), right: canonical("right") };
  const delta = step.after.clone().multiply(step.before.clone().invert());
  const half = step.move.turns === 2,
    finalAngle =
      step.move.turns === 3 ? Math.PI / 2 : half ? -Math.PI : -Math.PI / 2;
  const preRoll = half ? Math.PI / 2 : 0;
  const turned = turnPose(active, preRoll + finalAngle),
    preTurn = turnPose(active, preRoll);
  const old = rotated(canonical(other), delta);
  const receivingSupport = released(canonical(other), other);
  const opened = rotated(receivingSupport, delta);
  let orientation = step.after.clone(),
    angle = 0,
    support = other;
  switch (stage) {
    case "CLEAR":
      orientation = step.before.clone();
      hands[active] = blend(
        canonical(active),
        released(canonical(active), active),
        t,
      );
      break;
    case "REORIENT": {
      const q = new Quaternion().slerp(delta, transport(t));
      orientation = q.clone().multiply(step.before);
      hands[other] = rotated(canonical(other), q);
      const { open, outside } = receivingPoses(active, delta);
      hands[active] = blend(
        step.entryPose ?? open,
        outside,
        t,
        step.entryPose ? 0.015 : 0,
        transport,
      );
      break;
    }
    case "RECEIVE":
      hands[other] = old;
      hands[active] = receive(active, delta, t);
      break;
    case "UNLOAD":
      support = active;
      hands[other] = blend(old, opened, t);
      break;
    case "TRANSFER":
      support = active;
      hands[other] = rotated(
        receivingSupport,
        delta.clone().slerp(new Quaternion(), transport(t)),
      );
      break;
    case "SUPPORT":
      support = active;
      hands[other] = blend(receivingSupport, canonical(other), t);
      break;
    case "WINDUP_OPEN":
      hands[active] = blend(
        canonical(active),
        released(canonical(active), active),
        t,
      );
      break;
    case "WINDUP_MOVE":
      hands[active] = released(
        turnPose(active, preRoll * transport(t)),
        active,
      );
      break;
    case "WINDUP_GRIP":
      hands[active] = blend(released(preTurn, active), preTurn, t);
      break;
    case "TURN":
      angle = finalAngle * smooth(t);
      hands[active] = turnPose(active, preRoll + angle);
      break;
    case "RELEASE":
      angle = finalAngle;
      hands[active] = blend(turned, released(turned, active), t);
      break;
    case "RESET":
      angle = finalAngle;
      hands[active] = released(
        turnPose(active, (preRoll + finalAngle) * (1 - transport(t))),
        active,
      );
      break;
    case "CONTACT":
      angle = finalAngle;
      hands[active] = blend(
        released(canonical(active), active),
        canonical(active),
        t,
      );
      break;
    case "HOLD":
      angle = finalAngle;
      break;
  }
  return {
    index,
    phase: half && stage === "TURN" ? "一气呵成 · 180°" : labels[stage],
    stage,
    angle,
    orientation,
    ...hands,
    support,
    progress: Math.max(0, time - step.start) / step.duration,
    active,
    complete: false,
  };
}
