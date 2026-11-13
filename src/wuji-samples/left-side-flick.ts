import { Quaternion, Vector3 } from 'three';
import { moveAngle, parseMove } from '../core/cube';
import { blendFingerPose, clonePose, handPose, type PoseData } from '../scene/finger-data';
import { contactTarget, type FingerContact } from '../scene/finger-contact';
import { fingerJoints, forwardFinger } from '../scene/finger-rig';
import type { FingerProgram, FingerSegment } from '../scene/finger-program';
import { smooth, type MotionFrame } from '../scene/motion';
import rawCompact from '../../art/wuji-teaching/compact/left-side-flick-calibration.json';
import { unpackFlickCalibration } from './flick-calibration-codec';
const raw = unpackFlickCalibration<typeof rawCompact.summary>(rawCompact);

export const LEFT_SIDE_FLICK_METADATA = {
  id: 'left-index-side-U-prime-c1', move: "U'", hand: 'left', finger: 2,
  method: '原左手食指末节侧垫从上层后侧接触，屈指拨动 U′，指尖释放；右手三点持续承托。',
  contactRegion: '上层后侧，距顶面7mm、左外角17mm；只使用原左手独立末节指垫前12mm。',
  jointOverrides: {}, ...raw.summary,
  status: '左食指U′动作族候选；完整公式衔接与实际慢放另行验收。',
} as const;

interface ContactData {
  side: 'left' | 'right'; finger: 1 | 2 | 3 | 4 | 5; role: 'support' | 'drive';
  point: number[]; normal: number[]; padOffset: number[];
}
interface FrameData { progress: number; angle: number; left: PoseData; right: PoseData; active: ContactData; }
const frames = raw.frames as unknown as FrameData[], move = parseMove("U'");
const contact = (c: ContactData): FingerContact => ({ ...c, point: new Vector3().fromArray(c.point), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) });

function at(progress: number) {
  const cursor = Math.max(0, Math.min(1, progress)) * (frames.length - 1), lo = Math.floor(cursor), hi = Math.min(frames.length - 1, lo + 1);
  const a = frames[lo], b = frames[hi], p = cursor - lo;
  const left = blendFingerPose(handPose(a.left), handPose(b.left), p), right = handPose(a.right);
  const angle = moveAngle(move) * progress, drive = contact(a.active);
  drive.padOffset.lerp(new Vector3().fromArray(b.active.padOffset), p);
  // Correct only the submillimetre interpolation chord, using actual left URDF
  // FK. Authoring projects each contact onto the unchanged left distal STL.
  const actual = forwardFinger('left', 2, fingerJoints('left', 2).map(j => left.joints![j.name]), left, drive.padOffset).position;
  left.position.add(contactTarget(drive, move, angle).point.sub(actual));
  return { left, right, angle, drive };
}

export function createLeftSideFlickProgram(duration = 4.5): FingerProgram {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('左食指U′样片时长必须为正数。');
  const start = at(0), end = at(1), before = handPose(raw.before), after = handPose(raw.after);
  const support = (raw.supports as ContactData[]).map(contact), segments: FingerSegment[] = [];
  function add(from: number, length: number, stage: string, phase: string, sample: FingerSegment['sample']) {
    segments.push({ index: 0, start: from * duration, duration: length * duration, stage, phase, active: 'left', finger: 2, sample });
  }
  add(0, .2, 'PREPARE', '右手接稳 · 左食指从侧边靠近', p => ({ left: blendFingerPose(before, start.left, smooth(p)), right: clonePose(start.right), angle: 0, contacts: support }));
  add(.2, .1, 'CONTACT', '左食指侧垫接触上层后侧', () => ({ left: clonePose(start.left), right: clonePose(start.right), angle: 0, contacts: [...support, start.drive] }));
  add(.3, .24, 'TURN', '左食指沿侧边拨动 · U′', p => {
    const frame = at(smooth(p)); return { left: frame.left, right: frame.right, angle: frame.angle, contacts: [...support, frame.drive] };
  });
  add(.54, .24, 'RELEASE', '左指尖松开 · 右手继续承托', p => ({ left: blendFingerPose(end.left, after, smooth(p)), right: clonePose(end.right), angle: end.angle, contacts: support }));
  add(.78, .22, 'HOLD', '左食指U′单拨完成', () => ({ left: clonePose(after), right: clonePose(end.right), angle: end.angle, contacts: support }));
  function sample(time: number): MotionFrame {
    const complete = time >= duration, s = segments.find(s => time < s.start + s.duration) ?? segments.at(-1)!;
    const progress = Math.max(0, Math.min(1, (time - s.start) / s.duration)), state = s.sample(progress);
    return { ...state, index: complete ? 1 : 0, angle: complete ? 0 : state.angle, phase: s.phase, stage: s.stage,
      orientation: new Quaternion(), active: complete ? null : 'left', support: 'right', activeFinger: 2, progress, complete };
  }
  return { duration, cost: duration, segments, steps: [{ move, start: 0, duration, active: 'left' }], sample,
    statistics: { fingerTurns: 1, wristTurns: 0, retainedWrists: 0, regrips: 0, reorientations: 0 } };
}
