import { Quaternion, Vector3 } from "three";
import { moveAngle, NORMALS, type Move } from "../core/cube";
import { smooth, type Side } from "./motion";
import { blendFingerPose, handPose, type ContactData, type PoseData } from "./finger-data";
import type { FingerContact } from "./finger-contact";
import type { FingerIndex } from "./finger-rig";
import { assembleFingerPrograms, emptyFingerStatistics } from "./finger-program-assembly";
import type { FingerProgram, FingerSegment } from "./finger-program";

export interface RecordedContact extends ContactData { side: Side; role: FingerContact["role"]; }
export interface RecordedFingerFrame {
  left: PoseData; right: PoseData; contacts: RecordedContact[]; cubeAngle: number;
}
export interface RecordedFingerSegment {
  id: string; phase?: string; stage: "PREPARE" | "TURN" | "HOLD";
  active: Side; finger?: FingerIndex; frames: RecordedFingerFrame[];
  weight?: number;
}
export interface RecordedFingerPrimitive {
  notation: string;
  segments: RecordedFingerSegment[];
  /** Rotation records may keep static contacts in the primitive's entry frame. */
  rotationContactsInEntryFrame?: boolean;
}
const fingerName = ["拇指", "食指", "中指", "无名指", "小指"];
const weightCache = new WeakMap<RecordedFingerSegment, number>();
function segmentWeight(segment: RecordedFingerSegment, rotation: boolean) {
  if (segment.weight !== undefined) return segment.weight;
  const cached = weightCache.get(segment); if (cached !== undefined) return cached;
  let work = 0;
  for (let i = 1; i < segment.frames.length; i++) {
    const a = segment.frames[i - 1], b = segment.frames[i];
    work += Math.max(...(["left", "right"] as Side[]).map((side) => {
      const from = a[side], to = b[side];
      return 2.5 * new Vector3().fromArray(from.position).distanceTo(new Vector3().fromArray(to.position)) +
        .15 * new Quaternion().fromArray(from.quaternion).angleTo(new Quaternion().fromArray(to.quaternion)) +
        .1 * Math.max(0, ...Object.keys(from.joints).map((joint) => Math.abs(from.joints[joint] - to.joints[joint])));
    }));
  }
  // Same relative turn budget as the accepted compiler; preparation is priced
  // by the measured joint/wrist travel. These are ranking units, not seconds.
  const value = segment.stage === "TURN" ? (rotation ? 1.4 : 1) : Math.max(.03, work);
  weightCache.set(segment, value); return value;
}

export function compileRecordedFingerMove(move: Move, primitive: RecordedFingerPrimitive, duration = 5): FingerProgram {
  if (primitive.notation !== move.notation || !primitive.segments.length)
    throw new Error("动作与已校准的指法记录不匹配。");
  const axis = new Vector3(...NORMALS[move.face]);
  let total = 0;
  const segments: FingerSegment[] = primitive.segments.map((record) => {
    if (!record.frames.length) throw new Error("指法记录缺少路径。");
    const identities = record.frames[0].contacts.map((contact) => `${contact.side}:${contact.finger}:${contact.role}`);
    if (record.frames.some((frame) => frame.contacts.length !== identities.length ||
      frame.contacts.some((contact, i) => `${contact.side}:${contact.finger}:${contact.role}` !== identities[i])))
      throw new Error("接触交接必须放在独立片段边界。");
    const weight = segmentWeight(record, move.kind === "rotation"), start = total;
    total += weight;
    return { index: 0, start, duration: weight, stage: record.stage, active: record.active, finger: record.finger,
      phase: record.phase ?? (record.stage === "TURN" ? move.kind === "rotation" ? "接握顺势换面" :
        `${record.active === "left" ? "左" : "右"}${record.finger ? fingerName[record.finger - 1] : "手"}拨层` : "手指接应就位"),
      sample: (progress) => {
        const at = smooth(progress) * (record.frames.length - 1), lo = Math.floor(at), hi = Math.min(record.frames.length - 1, lo + 1);
        const a = record.frames[lo], b = record.frames[hi], t = at - lo;
        const angle = a.cubeAngle + (b.cubeAngle - a.cubeAngle) * t;
        const contacts = a.contacts.map((contact, i): FingerContact => {
          const next = b.contacts[i];
          if (!next || contact.side !== next.side || contact.finger !== next.finger || contact.role !== next.role)
            throw new Error("接触交接必须放在独立片段边界。");
          const point = new Vector3().fromArray(contact.point).lerp(new Vector3().fromArray(next.point), t);
          const normal = new Vector3().fromArray(contact.normal).lerp(new Vector3().fromArray(next.normal), t).normalize();
          if (primitive.rotationContactsInEntryFrame && record.stage !== "TURN") {
            point.applyAxisAngle(axis, angle); normal.applyAxisAngle(axis, angle);
          }
          return { ...contact, point, normal, padOffset: new Vector3().fromArray(contact.padOffset).lerp(new Vector3().fromArray(next.padOffset), t) };
        });
        return { left: blendFingerPose(handPose(a.left), handPose(b.left), t), right: blendFingerPose(handPose(a.right), handPose(b.right), t), contacts, angle };
      } };
  });
  if (Math.abs(segments[0].sample(0).angle) > 1e-8 ||
    Math.abs(segments.at(-1)!.sample(1).angle - moveAngle(move)) > 1e-8)
    throw new Error("指法记录没有完成指定转角。");
  const statistics = emptyFingerStatistics();
  statistics.fingerTurns = segments.filter((segment) => segment.stage === "TURN" && segment.finger).length;
  statistics.reorientations = move.kind === "rotation" ? 1 : 0;
  const last = segments.at(-1)!.sample(1);
  const block: FingerProgram = { segments, steps: [{ move, start: 0, duration: total,
    active: primitive.segments.find((segment) => segment.stage === "TURN")?.active ?? primitive.segments[0].active }],
    cost: total, duration: total, statistics,
    // Assembly provides the normal deterministic sampler; this branch is used
    // only after the entire primitive has committed to the logical cube.
    sample: () => ({ ...last, angle: 0, orientation: new Quaternion(), index: 1, active: null,
      support: "left", stage: "HOLD", phase: "稳持完成", progress: 1, complete: true }),
  };
  return assembleFingerPrograms([block], duration);
}
