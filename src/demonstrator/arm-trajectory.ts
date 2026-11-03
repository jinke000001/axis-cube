import { Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../core/cube';
import type { TeachingFinger, TeachingHand } from './types';
import { capsuleBoxClearance, inscribedBoxSlabs, segmentSegmentDistance, type RoundedBox, type Segment } from './geometry-shapes';
import metadata from '../../art/teaching-hand/rig.json';
import { armShell, jointShellRadius, linkShell } from './hand-model';

/** Authoring is offline. Playback only evaluates the stored, unwrapped elbow
 * angle; neither path selection nor a previous rendered pose is needed. */
export const ARM_TRAJECTORY_REVISION = 1;
export const ARM_TRAJECTORY_PARAMETERS = {
  revision: ARM_TRAJECTORY_REVISION,
  handModelId: metadata.handModelId,
  geometryDigest: metadata.geometryDigest,
  shoulderRight: [.215, -.23, .04],
  lengths: metadata.armLengths,
  wristAttachment: metadata.wristAttachment,
  geometry: metadata.geometry,
  baseOffsetsRight: metadata.baseOffsetsRight,
  fingers: metadata.fingers,
};
function signature(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export const ARM_GEOMETRY_SIGNATURE = signature(ARM_TRAJECTORY_PARAMETERS);

export interface ArmPalmPose { palm: Vec3; rotation: readonly [number, number, number, number] }
export type ArmPalms = Record<TeachingHand, ArmPalmPose>;
export interface ArmFingerObstacle {
  hand: TeachingHand;
  finger: TeachingFinger;
  joints: readonly [Vec3, Vec3, Vec3, Vec3];
}
export interface ArmTrajectorySample {
  pose: ArmPalms;
  cubeShapes: readonly RoundedBox[];
  /** Omit only when making an explicitly incomplete arm-only candidate. */
  fingers?: readonly ArmFingerObstacle[];
}
export interface ArmSolution {
  hand: TeachingHand;
  shoulder: Vec3;
  elbow: Vec3;
  wrist: Vec3;
  target: Vec3;
  reachError: number;
}
export interface ArmTrajectoryData {
  version: number;
  geometrySignature: string;
  times: number[];
  angles: Record<TeachingHand, number[]>;
  slopes: Record<TeachingHand, number[]>;
  fingerObstacles: boolean;
}
export interface ArmTrajectoryOptions {
  angleSamples?: number;
  /** Bounds the actual cubic angle derivative, not just its node secants. */
  maximumAngularSpeed?: number;
  /** Positive gap outside the actual wrist assembly ball. */
  palmClearance?: number;
  sampleStepSeconds?: number;
  verificationStepSeconds?: number;
  maximumRefinements?: number;
}
export interface BuildArmTrajectoryInput {
  times: readonly number[];
  sample: (time: number) => ArmTrajectorySample;
  options?: ArmTrajectoryOptions;
}
export class ArmTrajectoryError extends Error {
  constructor(message: string, readonly time?: number, readonly hand?: TeachingHand) {
    super(message + (time === undefined ? '' : ' (t=' + time.toFixed(6) + (hand ? ', ' + hand : '') + ')'));
    this.name = 'ArmTrajectoryError';
  }
}

const hands: TeachingHand[] = ['left', 'right'];
const dimensions = metadata.geometry;
const tolerance = .0003;
const V = (point: readonly number[]) => new Vector3().fromArray(point);
const A = (point: Vector3) => point.toArray() as Vec3;
const sphereFactor = Math.cos(Math.PI / dimensions.uvSphereSegments) * Math.cos(Math.PI / (2 * dimensions.uvSphereRings)) * .99;

/** The circle of elbows satisfying both authored lengths and the exact wrist.
 * The world-lateral reference is independent of wrist roll. */
function elbowCircle(pose: ArmPalms, hand: TeachingHand) {
  const sign = hand === 'right' ? 1 : -1;
  const shoulder = V(ARM_TRAJECTORY_PARAMETERS.shoulderRight); shoulder.x *= sign;
  const palm = pose[hand];
  const wrist = V(metadata.wristAttachment).applyQuaternion(new Quaternion().fromArray(palm.rotation)).add(V(palm.palm));
  const axis = wrist.clone().sub(shoulder), distance = axis.length();
  const [upper, lower] = metadata.armLengths;
  if (!Number.isFinite(distance) || distance <= Math.abs(upper - lower) + 1e-8 || distance >= upper + lower - 1e-8)
    throw new ArmTrajectoryError('腕点超出固定骨长的非退化可达范围', undefined, hand);
  axis.divideScalar(distance);
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const radius = Math.sqrt(Math.max(0, upper * upper - along * along));
  const radial = new Vector3(sign, 0, 0);
  radial.addScaledVector(axis, -radial.dot(axis));
  if (radial.lengthSq() < 1e-6) throw new ArmTrajectoryError('肘环参考轴接近退化，需要调整臂布局', undefined, hand);
  radial.normalize();
  return { shoulder, wrist, center: shoulder.clone().addScaledVector(axis, along), radial, binormal: axis.clone().cross(radial), radius };
}
function armOnCircle(circle: ReturnType<typeof elbowCircle>, hand: TeachingHand, angle: number): ArmSolution {
  const elbow = circle.center.clone().addScaledVector(circle.radial, circle.radius * Math.cos(angle))
    .addScaledVector(circle.binormal, circle.radius * Math.sin(angle));
  return { hand, shoulder: A(circle.shoulder), elbow: A(elbow), wrist: A(circle.wrist), target: A(circle.wrist), reachError: 0 };
}

interface Capsule extends Segment {
  inner: Segment; radius: number; innerRadius: number;
  hand: TeachingHand; name: string; span: [number, number];
}
interface PalmBox extends RoundedBox { hand: TeachingHand; mount: boolean; interiors: RoundedBox[] }
interface PreparedSample extends ArmTrajectorySample {
  palms: PalmBox[];
  cubes: RoundedBox[];
  fingerCapsules: Capsule[];
  circles: Record<TeachingHand, ReturnType<typeof elbowCircle>>;
}
function housing(a: Vec3, b: Vec3, hand: TeachingHand, name: string, span: [number, number], outerRadius: number, innerRadius: number, inset: number): Capsule {
  const unit = V(b).sub(V(a)).normalize();
  return { a: A(V(a).addScaledVector(unit, inset)), b: A(V(b).addScaledVector(unit, -inset)),
    inner: { a: A(V(a).addScaledVector(unit, inset + innerRadius)), b: A(V(b).addScaledVector(unit, -inset - innerRadius)) },
    radius: outerRadius, innerRadius, hand, name, span };
}
function sphere(point: Vec3, radius: number, hand: TeachingHand, name: string, index: number): Capsule {
  return { a: point, b: point, inner: { a: point, b: point }, radius, innerRadius: radius * sphereFactor, hand, name, span: [index, index] };
}
function armCapsules(arm: ArmSolution): Capsule[] {
  const points = [arm.shoulder, arm.elbow, arm.wrist];
  const shell = armShell();
  return [0, 1].map(i => housing(points[i], points[i + 1], arm.hand, i ? 'forearm' : 'upper', [i, i + 1], shell.outer, shell.inner, shell.inset))
    .concat(points.map((point, i) => sphere(point, i === 2 ? dimensions.wristCouplerRadius : dimensions.armBearingRadius, arm.hand, i === 2 ? 'wrist' : 'bearing', i)));
}
function fingerCapsules(fingers: readonly ArmFingerObstacle[]): Capsule[] {
  return fingers.flatMap(finger => {
    const links = [0, 1, 2].map(i => {
      const shell = linkShell(finger.finger, i);
      return housing(finger.joints[i], finger.joints[i + 1], finger.hand, finger.finger + '-' + i, [i, i + 1], shell.outer, shell.inner, shell.inset);
    });
    return links.concat(finger.joints.map((point, i) => sphere(point, jointShellRadius(finger.finger, i).outer, finger.hand, finger.finger, i)));
  });
}
function palmBoxes(pose: ArmPalms): PalmBox[] {
  return hands.flatMap(hand => {
    const p = pose[hand], q = new Quaternion().fromArray(p.rotation), sign = hand === 'right' ? 1 : -1;
    const make = (offset: Vec3, half: Vec3, rounding: number): PalmBox => {
      const box = { hand, center: A(V(offset).applyQuaternion(q).add(V(p.palm))), rotation: p.rotation, half, rounding, mount: false };
      return { ...box, interiors: inscribedBoxSlabs(box) };
    };
    const result = [make([0, 0, 0], dimensions.palmSize.map(x => x / 2) as Vec3, dimensions.palmBevel),
      make([-sign * dimensions.palmInnerOffset, 0, 0], dimensions.palmInnerSize.map(x => x / 2) as Vec3, dimensions.palmInnerBevel),
      make([sign * dimensions.palmInlayOffsetRight[0], dimensions.palmInlayOffsetRight[1], dimensions.palmInlayOffsetRight[2]], dimensions.palmInlaySize.map(x => x / 2) as Vec3, dimensions.palmInlayBevel)];
    // Installation posts are real hand volumes, not wrist-assembly exceptions.
    const mount = dimensions as typeof dimensions & { mcpMountRadius?: number; mcpMountLength?: number; mcpMountRadialSegments?: number };
    if (mount.mcpMountRadius && mount.mcpMountLength && mount.mcpMountRadialSegments) {
      for (const base of Object.values(metadata.baseOffsetsRight)) {
        const box = make([sign * (base[0] + mount.mcpMountLength / 2), base[1], base[2]], [mount.mcpMountLength / 2, mount.mcpMountRadius, mount.mcpMountRadius], 0);
        const inside = mount.mcpMountRadius * Math.cos(Math.PI / mount.mcpMountRadialSegments) / Math.SQRT2 - .00012;
        box.mount = true;
        box.interiors = [{ ...box, half: [mount.mcpMountLength / 2 - .00012, inside, inside] }];
        result.push(box);
      }
    }
    return result;
  });
}
/** Return capsule cores outside the authored connection ball. Only intentional
 * overlap inside that local assembly is excluded; the rest is still checked. */
function outsideConnection(segment: Segment, radius: number, center: Vec3, connectionRadius: number): Segment[] {
  const a = V(segment.a), delta = V(segment.b).sub(a), offset = a.clone().sub(V(center)), squared = delta.lengthSq();
  const safe = connectionRadius + radius + tolerance;
  if (squared < 1e-12) return offset.length() > safe ? [segment] : [];
  const b = 2 * delta.dot(offset), c = offset.lengthSq() - safe * safe, discriminant = b * b - 4 * squared * c;
  if (discriminant <= 0) return [segment];
  const near = (-b - Math.sqrt(discriminant)) / (2 * squared), far = (-b + Math.sqrt(discriminant)) / (2 * squared);
  if (far <= 0 || near >= 1) return [segment];
  const result: Segment[] = [];
  if (near > 0) result.push({ a: segment.a, b: A(a.clone().addScaledVector(delta, Math.min(1, near))) });
  if (far < 1) result.push({ a: A(a.clone().addScaledVector(delta, Math.max(0, far))), b: segment.b });
  return result;
}
function boxesOverlap(part: Capsule, box: RoundedBox): boolean {
  if (segmentSegmentDistance(part.a, part.b, box.center, box.center) > Math.hypot(...box.half) + part.radius + tolerance) return false;
  return capsuleBoxClearance(part, part.radius, box) < -tolerance;
}
function partsOverlap(a: Capsule, b: Capsule): boolean {
  if (segmentSegmentDistance(a.a, a.b, b.a, b.b) >= a.radius + b.radius - tolerance) return false;
  return segmentSegmentDistance(a.inner.a, a.inner.b, b.inner.a, b.inner.b) < a.innerRadius + b.innerRadius - tolerance;
}
interface Collision { hand: TeachingHand; detail: string }
function singleArmCollision(sample: PreparedSample, arm: ArmSolution): Collision | undefined {
  const parts = armCapsules(arm);
  for (const part of parts) {
    for (const cube of sample.cubes) if (boxesOverlap(part, cube) && capsuleBoxClearance(part.inner, part.innerRadius, cube) < -tolerance)
      return { hand: arm.hand, detail: part.name + '与魔方相交' };
    for (const palm of sample.palms) {
      const own = palm.hand === arm.hand;
      if (own && !palm.mount && part.name === 'wrist') continue;
      if (!boxesOverlap(part, palm)) continue;
      const cores = own && !palm.mount && part.name === 'forearm'
        ? outsideConnection(part.inner, part.innerRadius, arm.wrist, dimensions.wristCouplerRadius) : [part.inner];
      if (cores.some(core => palm.interiors.some(box => capsuleBoxClearance(core, part.innerRadius, box) < -tolerance)))
        return { hand: arm.hand, detail: part.name + '与手掌或安装柱相交' };
    }
    for (const finger of sample.fingerCapsules) if (partsOverlap(part, finger))
      return { hand: arm.hand, detail: part.name + '与' + finger.hand + ' ' + finger.name + '相交' };
  }
  // Two housings may meet inside their actual elbow bearing, not elsewhere.
  const first = parts[0], second = parts[1];
  const a = outsideConnection(first.inner, first.innerRadius, arm.elbow, dimensions.armBearingRadius);
  const b = outsideConnection(second.inner, second.innerRadius, arm.elbow, dimensions.armBearingRadius);
  if (a.some(x => b.some(y => segmentSegmentDistance(x.a, x.b, y.a, y.b) < first.innerRadius + second.innerRadius - tolerance)))
    return { hand: arm.hand, detail: '两节臂在肘关节之外相交' };
  return undefined;
}
function armsCollide(first: ArmSolution, second: ArmSolution): boolean {
  return armCapsules(first).some(a => armCapsules(second).some(b => partsOverlap(a, b)));
}
function ownPalmClearance(sample: PreparedSample, arm: ArmSolution): number {
  const palm = sample.palms.find(p => p.hand === arm.hand && !p.mount)!;
  const forearm = armCapsules(arm)[1];
  const cores = outsideConnection(forearm, forearm.radius, arm.wrist, dimensions.wristCouplerRadius);
  return Math.min(Infinity, ...cores.map(core => capsuleBoxClearance(core, forearm.radius, palm)));
}

function slopes(times: readonly number[], values: readonly number[]): number[] {
  const secants = times.slice(1).map((t, i) => (values[i + 1] - values[i]) / (t - times[i]));
  return times.map((_, i) => {
    if (i === 0) return secants[0];
    if (i === times.length - 1) return secants.at(-1)!;
    const a = secants[i - 1], b = secants[i];
    if (a * b <= 0) return 0;
    const before = times[i] - times[i - 1], after = times[i + 1] - times[i];
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / a + w2 / b);
  });
}
function interval(times: readonly number[], time: number): number {
  let lo = 0, hi = times.length - 2;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (times[mid] <= time) lo = mid; else hi = mid - 1; }
  return lo;
}
function angleAt(times: readonly number[], values: readonly number[], tangents: readonly number[], time: number): number {
  const t = Math.max(times[0], Math.min(time, times.at(-1)!)), i = interval(times, t), dt = times[i + 1] - times[i], u = (t - times[i]) / dt;
  return (2 * u ** 3 - 3 * u ** 2 + 1) * values[i] + (u ** 3 - 2 * u ** 2 + u) * dt * tangents[i]
    + (-2 * u ** 3 + 3 * u ** 2) * values[i + 1] + (u ** 3 - u ** 2) * dt * tangents[i + 1];
}
function maximumCurveSpeed(times: readonly number[], values: readonly number[], tangents: readonly number[], index: number): number {
  const dt = times[index + 1] - times[index], delta = values[index + 1] - values[index];
  const a = -2 * delta + dt * (tangents[index] + tangents[index + 1]);
  const b = 3 * delta - dt * (2 * tangents[index] + tangents[index + 1]), c = dt * tangents[index];
  const probes = [0, 1], turn = Math.abs(a) > 1e-12 ? -b / (3 * a) : -1;
  if (turn > 0 && turn < 1) probes.push(turn);
  return Math.max(...probes.map(u => Math.abs((3 * a * u * u + 2 * b * u + c) / dt)));
}
export function sampleArmTrajectory(data: ArmTrajectoryData, time: number, pose: ArmPalms): ArmSolution[] {
  if (!Number.isFinite(time)) throw new ArmTrajectoryError('手臂播放时间无效');
  return hands.map(hand => armOnCircle(elbowCircle(pose, hand), hand, angleAt(data.times, data.angles[hand], data.slopes[hand], time)));
}
export function validateArmTrajectory(data: unknown, duration?: number): asserts data is ArmTrajectoryData {
  const d = data as Partial<ArmTrajectoryData> | null;
  if (!d || d.version !== ARM_TRAJECTORY_REVISION || d.geometrySignature !== ARM_GEOMETRY_SIGNATURE
    || typeof d.fingerObstacles !== 'boolean' || !Array.isArray(d.times) || d.times.length < 2 || d.times[0] !== 0
    || d.times.some((t, i) => !Number.isFinite(t) || (i > 0 && t - d.times![i - 1] < 1e-8))
    || (duration !== undefined && (!Number.isFinite(duration) || Math.abs(d.times.at(-1)! - duration) > 1e-7)))
    throw new ArmTrajectoryError('手臂轨迹版本、时间或几何数据不匹配');
  for (const hand of hands) {
    if (!Array.isArray(d.angles?.[hand]) || !Array.isArray(d.slopes?.[hand]) || d.angles[hand].length !== d.times.length || d.slopes[hand].length !== d.times.length
      || d.angles[hand].some(x => !Number.isFinite(x)) || d.slopes[hand].some(x => !Number.isFinite(x)))
      throw new ArmTrajectoryError('手臂角度数据无效', undefined, hand);
    const expected = slopes(d.times, d.angles[hand]);
    if (expected.some((value, i) => Math.abs(value - d.slopes![hand][i]) > 1e-7))
      throw new ArmTrajectoryError('手臂曲线斜率与节点不一致', undefined, hand);
  }
}

/** Searches a fixed grid offline, then checks the actual C1 playback curve.
 * Failed edges are removed and replanned. No collision check runs per render. */
export function buildArmTrajectory(input: BuildArmTrajectoryInput): ArmTrajectoryData {
  const options = { angleSamples: 72, maximumAngularSpeed: 8, palmClearance: .001, sampleStepSeconds: .02,
    verificationStepSeconds: .005, maximumRefinements: 32, ...input.options };
  if (!Number.isInteger(options.angleSamples) || options.angleSamples < 16 || options.angleSamples > 720
    || options.maximumAngularSpeed <= 0 || options.palmClearance < 0 || options.sampleStepSeconds <= 0
    || options.verificationStepSeconds <= 0 || options.maximumRefinements < 1
    || Object.values(options).some(x => !Number.isFinite(x))) throw new ArmTrajectoryError('手臂规划参数无效');
  const supplied = [...input.times];
  if (supplied.length < 2 || supplied[0] !== 0 || supplied.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= supplied[i - 1])))
    throw new ArmTrajectoryError('手臂规划需要从零开始的递增时间表');
  const times = [0];
  for (let i = 1; i < supplied.length; i++) {
    const count = Math.ceil((supplied[i] - supplied[i - 1]) / options.sampleStepSeconds);
    for (let k = 1; k <= count; k++) { const t = supplied[i - 1] + (supplied[i] - supplied[i - 1]) * k / count; if (t - times.at(-1)! > 1e-7) times.push(t); }
  }
  if (Math.abs(times.at(-1)! - supplied.at(-1)!) > 1e-7) times.push(supplied.at(-1)!);
  if (times.length < 2) throw new ArmTrajectoryError('手臂轨迹时长不足');
  const cache = new Map<number, PreparedSample>();
  let includedFingers: boolean | undefined;
  const sample = (time: number): PreparedSample => {
    const existing = cache.get(time); if (existing) return existing;
    const frame = input.sample(time), hasFingers = frame.fingers !== undefined;
    if (!Array.isArray(frame.cubeShapes) || !frame.cubeShapes.length) throw new ArmTrajectoryError('缺少实际魔方障碍', time);
    if (hasFingers) {
      const expected = new Set(hands.flatMap(hand => ['thumb', 'index', 'middle', 'ring', 'little'].map(finger => hand + ':' + finger)));
      for (const finger of frame.fingers!) {
        if (!expected.delete(finger.hand + ':' + finger.finger) || finger.joints.length !== 4 || finger.joints.some(point => point.length !== 3 || point.some(x => !Number.isFinite(x))))
          throw new ArmTrajectoryError('实际手指障碍数据无效', time);
      }
      if (expected.size) throw new ArmTrajectoryError('实际手指障碍必须覆盖双手十指', time);
    }
    if (includedFingers !== undefined && includedFingers !== hasFingers) throw new ArmTrajectoryError('同条轨迹的手指障碍输入不一致', time);
    includedFingers = hasFingers;
    const prepared: PreparedSample = { ...frame, palms: palmBoxes(frame.pose), cubes: frame.cubeShapes.map((box: RoundedBox) => {
      const half = box.half.map(value => Math.max(0, value - .00012)) as Vec3;
      return { ...box, half, rounding: Math.min(box.rounding, ...half) };
    }), fingerCapsules: fingerCapsules(frame.fingers ?? []), circles: { left: elbowCircle(frame.pose, 'left'), right: elbowCircle(frame.pose, 'right') } };
    cache.set(time, prepared); return prepared;
  };
  const frames = times.map(sample), n = options.angleSamples, unit = 2 * Math.PI / n;
  const candidates = Object.fromEntries(hands.map(hand => [hand, frames.map(frame => Array.from({ length: n }, (_, k) => {
    const arm = armOnCircle(frame.circles[hand], hand, k * unit), gap = ownPalmClearance(frame, arm);
    return gap >= options.palmClearance && !singleArmCollision(frame, arm) ? { arm, gap } : undefined;
  }))])) as Record<TeachingHand, ({ arm: ArmSolution; gap: number } | undefined)[][]>;
  const bans: Record<TeachingHand, Set<string>> = { left: new Set(), right: new Set() };
  const edge = (i: number, a: number, b: number) => i + ':' + a + ':' + b;
  interface Path { indices: number[]; angles: number[]; slopes: number[] }
  const search = (hand: TeachingHand, other?: { hand: TeachingHand; path: Path }): Path => {
    const allowed = (i: number, k: number) => {
      const candidate = candidates[hand][i][k]; if (!candidate) return false;
      if (!other) return true;
      const opposite = armOnCircle(frames[i].circles[other.hand], other.hand, other.path.angles[i]);
      return !armsCollide(candidate.arm, opposite);
    };
    let costs = Float64Array.from({ length: n }, (_, k) => allowed(0, k) ? .001 * (k - n / 2) ** 2 : Infinity);
    const predecessors: Int16Array[] = [new Int16Array(n).fill(-1)];
    for (let i = 1; i < times.length; i++) {
      const dt = times[i] - times[i - 1], hops = Math.min(n / 2 - 1, Math.floor(options.maximumAngularSpeed * dt / unit + 1e-9));
      const next = new Float64Array(n).fill(Infinity), previous = new Int16Array(n).fill(-1);
      for (let k = 0; k < n; k++) {
        if (!allowed(i, k)) continue;
        for (let offset = -hops; offset <= hops; offset++) {
          const from = (k + offset + n) % n;
          if (!Number.isFinite(costs[from]) || bans[hand].has(edge(i - 1, from, k))) continue;
          const cost = costs[from] + (offset * unit) ** 2 / dt + .000001 * dt / (candidates[hand][i][k]!.gap + .001);
          if (cost < next[k]) { next[k] = cost; previous[k] = from; }
        }
      }
      if (!next.some(Number.isFinite)) throw new ArmTrajectoryError('没有满足接入、碰撞和速度约束的连续肘分支', times[i], hand);
      costs = next; predecessors.push(previous);
    }
    let k = costs.indexOf(Math.min(...costs));
    const indices = new Array<number>(times.length);
    for (let i = times.length - 1; i >= 0; i--) { indices[i] = k; k = predecessors[i][k]; }
    const angles = [indices[0] * unit];
    for (let i = 1; i < indices.length; i++) {
      const delta = (indices[i] - indices[i - 1] + n * 1.5) % n - n / 2;
      angles.push(angles[i - 1] + delta * unit);
    }
    return { indices, angles, slopes: slopes(times, angles) };
  };
  let last: ArmTrajectoryError | undefined;
  for (const order of [['left', 'right'], ['right', 'left']] as TeachingHand[][]) {
    for (let attempt = 0; attempt < options.maximumRefinements; attempt++) {
      let paths: Record<TeachingHand, Path>;
      try {
        const first = search(order[0]), second = search(order[1], { hand: order[0], path: first });
        paths = { [order[0]]: first, [order[1]]: second } as Record<TeachingHand, Path>;
      } catch (error) { if (!(error instanceof ArmTrajectoryError)) throw error; last = error; break; }
      const data: ArmTrajectoryData = { version: ARM_TRAJECTORY_REVISION, geometrySignature: ARM_GEOMETRY_SIGNATURE, times,
        angles: { left: paths.left.angles, right: paths.right.angles }, slopes: { left: paths.left.slopes, right: paths.right.slopes }, fingerObstacles: includedFingers === true };
      let failed: { index: number; time: number; collision: Collision } | undefined;
      for (let i = 0; i < times.length - 1 && !failed; i++) {
        for (const hand of hands) if (maximumCurveSpeed(times, data.angles[hand], data.slopes[hand], i) > options.maximumAngularSpeed + 1e-8) {
          failed = { index: i, time: times[i], collision: { hand, detail: '连续肘角曲线超过角速度限制' } }; break;
        }
        if (failed) break;
        const count = Math.max(2, Math.ceil((times[i + 1] - times[i]) / options.verificationStepSeconds));
        for (let k = 1; k < count; k++) {
          const time = times[i] + (times[i + 1] - times[i]) * k / count, frame = sample(time), arms = sampleArmTrajectory(data, time, frame.pose);
          let collision = singleArmCollision(frame, arms[0]) ?? singleArmCollision(frame, arms[1]);
          if (!collision && armsCollide(arms[0], arms[1])) collision = { hand: order[1], detail: '两臂在节点之间相交' };
          if (!collision) for (const arm of arms) if (ownPalmClearance(frame, arm) < options.palmClearance) { collision = { hand: arm.hand, detail: '腕部接入净距不足' }; break; }
          if (collision) { failed = { index: i, time, collision }; break; }
        }
      }
      if (!failed) { validateArmTrajectory(data, times.at(-1)); return data; }
      const { index, time, collision } = failed, path = paths[collision.hand];
      bans[collision.hand].add(edge(index, path.indices[index], path.indices[index + 1]));
      last = new ArmTrajectoryError(collision.detail, time, collision.hand);
    }
  }
  throw last ?? new ArmTrajectoryError('没有找到可验证的手臂轨迹');
}
