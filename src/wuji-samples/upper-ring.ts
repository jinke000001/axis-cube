import { Quaternion, Vector3 } from 'three';
import { moveAngle, parseMove } from '../core/cube';
import { blendFingerPose, clonePose, handPose, type PoseData } from '../scene/finger-data';
import { contactTarget, type FingerContact } from '../scene/finger-contact';
import { fingerJoints, forwardFinger } from '../scene/finger-rig';
import type { FingerProgram, FingerSegment } from '../scene/finger-program';
import { smooth, type MotionFrame, type Side } from '../scene/motion';
import rawCompact from '../../art/wuji-teaching/compact/upper-ring-calibration.json';
import { unpackFlickCalibration } from './flick-calibration-codec';
const raw = unpackFlickCalibration<typeof rawCompact.summary>(rawCompact);

export const UPPER_RING_METADATA = {
  id: 'right-ring-U-c2', move: "U", hand: raw.side, finger: 4,
  sourceAlgorithm: 'OLL 27', sourceStepIndex: 3,
  originalInstruction: '原表橙字：无名指；左右手依连续握姿编排。',
  method: '右无名指末节侧垫沿上层右侧屈指拨动U；复用C5曲线并按真实环指根部与末节网格独立适配，腕小幅平移辅助，另一手三点支撑。',
  contactRegion: '上层右侧x=45.2mm、y=38mm，接触位于真实独立末节指垫前12mm。',
  jointOverrides: {}, ...raw.summary,
  status: '直接U侧拨动作族候选；实际慢放与完整公式衔接另行验收。',
} as const;

interface ContactData {
  side: Side; finger: 1 | 2 | 3 | 4 | 5; role: 'support' | 'drive';
  point: number[]; normal: number[]; padOffset: number[];
}
interface FrameData { progress: number; angle: number; left: PoseData; right: PoseData; active: ContactData; }
const frames = raw.frames as unknown as FrameData[], move = parseMove('U');
const active = raw.side as Side, other: Side = active === 'left' ? 'right' : 'left';
const contact = (c: ContactData): FingerContact => ({ ...c, point: new Vector3().fromArray(c.point), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) });

function at(progress: number) {
  const cursor = Math.max(0, Math.min(1, progress)) * (frames.length - 1), lo = Math.floor(cursor), hi = Math.min(frames.length - 1, lo + 1);
  const a = frames[lo], b = frames[hi], p = cursor - lo;
  const poses = { left: blendFingerPose(handPose(a.left), handPose(b.left), p), right: blendFingerPose(handPose(a.right), handPose(b.right), p) };
  const angle = moveAngle(move) * progress, drive = contact(a.active);
  drive.padOffset.lerp(new Vector3().fromArray(b.active.padOffset), p);
  // Original ring FK corrects the interpolation chord; no IK, mesh deformation,
  // extra outer moves or time-varying wrist rotation is used by the player.
  const pose = poses[active], actual = forwardFinger(active, 4, fingerJoints(active, 4).map(j => pose.joints![j.name]), pose, drive.padOffset).position;
  pose.position.add(contactTarget(drive, move, angle).point.sub(actual));
  return { ...poses, angle, drive };
}

export function createUpperRingProgram(duration = 4.5): FingerProgram {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无名指U样片时长必须为正数。');
  const start = at(0), end = at(1), before = handPose(raw.before), after = handPose(raw.after);
  const support = (raw.supports as ContactData[]).map(contact), segments: FingerSegment[] = [];
  function add(from: number, length: number, stage: string, phase: string, sample: FingerSegment['sample']) {
    segments.push({ index: 0, start: from * duration, duration: length * duration, stage, phase, active, finger: 4, sample });
  }
  const state = (moving: ReturnType<typeof handPose>, fixed: ReturnType<typeof handPose>, angle: number, contacts: FingerContact[]) => ({
    left: active === 'left' ? moving : fixed, right: active === 'right' ? moving : fixed, angle, contacts,
  });
  add(0, .2, 'PREPARE', '另一手接稳 · 无名指从上层右侧靠近', p => state(blendFingerPose(before, start[active], smooth(p)), clonePose(start[other]), 0, support));
  add(.2, .1, 'CONTACT', '无名指末节侧垫接触上层', () => state(clonePose(start[active]), clonePose(start[other]), 0, [...support, start.drive]));
  add(.3, .24, 'TURN', '无名指沿侧边屈指拨动 · U', p => {
    const frame = at(smooth(p)); return { left: frame.left, right: frame.right, angle: frame.angle, contacts: [...support, frame.drive] };
  });
  add(.54, .24, 'RELEASE', '上层停止 · 无名指松开离面', p => state(blendFingerPose(end[active], after, smooth(p)), clonePose(end[other]), end.angle, support));
  add(.78, .22, 'HOLD', '无名指U单拨完成', () => state(clonePose(after), clonePose(end[other]), end.angle, support));
  function sample(time: number): MotionFrame {
    const complete = time >= duration, s = segments.find(s => time < s.start + s.duration) ?? segments.at(-1)!;
    const progress = Math.max(0, Math.min(1, (time - s.start) / s.duration)), f = s.sample(progress);
    return { ...f, index: complete ? 1 : 0, angle: complete ? 0 : f.angle, phase: s.phase, stage: s.stage,
      orientation: new Quaternion(), active: complete ? null : active, support: other, activeFinger: 4, progress, complete };
  }
  return { duration, cost: duration, segments, steps: [{ move, start: 0, duration, active }], sample,
    statistics: { fingerTurns: 1, wristTurns: 0, retainedWrists: 0, regrips: 0, reorientations: 0 } };
}
