import { Quaternion, Vector3 } from "three";
import {
  blendFingerPose,
  clonePose,
  handPose,
  type PoseData,
} from "../scene/finger-data";
import { fingerJoints, forwardFinger } from "../scene/finger-rig";
import { smooth, type HandPose, type Side } from "../scene/motion";
import data from "../../art/wuji-teaching/compact-handoff-calibration.json";
export interface HandoffPart {
  duration: number;
  phase: string;
  sample: (p: number) => HandPose;
}
function record(side: Side, pose: HandPose) {
  const r = (
    data.records as unknown as {
      side: Side;
      from: PoseData;
      parked: PoseData;
      thumbPad: number[];
      thumbNormal: number[];
    }[]
  ).find(
    (r) =>
      r.side === side &&
      pose.position.distanceTo(new Vector3().fromArray(r.from.position)) <
        1e-8 &&
      pose.quaternion.angleTo(new Quaternion().fromArray(r.from.quaternion)) <
        1e-7 &&
      Object.entries(r.from.joints).every(
        ([k, v]) => Math.abs(pose.joints![k] - v) < 1e-7,
      ),
  );
  return r;
}
export function ringHandoff(
  side: Side,
  from: HandPose,
  to: HandPose,
  padA: Vector3,
  padB: Vector3,
  normalA: Vector3,
  normalB: Vector3,
  preferredFinger?: 1 | 2 | 4,
): HandoffPart[] {
  const same = (a: HandPose, b: HandPose) =>
    a.position.distanceTo(b.position) < 1e-8 &&
    a.quaternion.angleTo(b.quaternion) < 1e-7 &&
    Object.entries(a.joints!).every(
      ([k, v]) => Math.abs(v - b.joints![k]) < 1e-7,
    );
  if (same(from, to)) return [];
  if (
    from.position.distanceTo(to.position) < 1e-8 &&
    from.quaternion.angleTo(to.quaternion) < 1e-7
  )
    return [
      {
        duration: 0.4,
        phase: "接稳后调整握指",
        sample: (p) => blendFingerPose(from, to, smooth(p)),
      },
    ];
  const ra = record(side, from),
    rb = record(side, to),
    a = ra ? handPose(ra.parked) : clonePose(from),
    b = rb ? handPose(rb.parked) : clonePose(to),
    parts: HandoffPart[] = [];
  // The free thumb was the witness, so route its real distal pad. The
  // ring remains the active digit only during the subsequent M-prime stroke.
  const guideFinger = preferredFinger===4&&ra ? 1 : preferredFinger ?? (ra && rb ? 1 : 4);
  if(preferredFinger===4&&ra){
    const raw=data.records.find(r=>r.side===side&&r.id===side+'-low')!;
    padA=new Vector3().fromArray(raw.thumbPad);padB=padA.clone();
    if(!ra)normalA=new Vector3(side==='left'?-1:1,0,0);
    if(!rb)normalB=new Vector3(side==='left'?-1:1,0,0);
  }
  if (guideFinger === 1) {
    if (ra) {
      padA = new Vector3().fromArray(ra.thumbPad);
      normalA = new Vector3().fromArray(ra.thumbNormal);
    }
    if (rb) {
      padB = new Vector3().fromArray(rb.thumbPad);
      normalB = new Vector3().fromArray(rb.thumbNormal);
    }
  }
  if (!same(from, a))
    parts.push({
      duration: 0.38,
      phase: "另一手接稳 · 拇指卸力与闲置指让位",
      sample: (p) => blendFingerPose(from, a, smooth(p)),
    });
  const fk = (pose: HandPose, pad: Vector3) =>
    forwardFinger(
      side,
      guideFinger,
      fingerJoints(side, guideFinger).map((j) => pose.joints![j.name]),
      pose,
      pad,
    ).position;
  const start = fk(a, padA),
    end = fk(b, padB),
    bow =
      guideFinger === 1
        ? (ra && rb ? 0.055 : 0.1)
        : normalB.z < -0.5 && a.position.y > 0.43
          ? 0.05
          : 0.02,
    ca = start.clone().addScaledVector(normalA, bow),
    cb = end.clone().addScaledVector(normalB, bow);
  const sample = (p: number) => {
    const t = smooth(p),
      u = 1 - t,
      pose = blendFingerPose(a, b, t),
      pad = padA.clone().lerp(padB, t);
    const target = start
      .clone()
      .multiplyScalar(u * u * u)
      .addScaledVector(ca, 3 * u * u * t)
      .addScaledVector(cb, 3 * u * t * t)
      .addScaledVector(end, t * t * t);
    pose.position.add(target.sub(fk(pose, pad)));
    return pose;
  };
  let length = 0,
    last = sample(0).position;
  for (let i = 1; i <= 64; i++) {
    const next = sample(i / 64).position;
    length += next.distanceTo(last);
    last = next;
  }
  parts.push({
    duration: Math.max(0.7, length / 0.18),
    phase: "指尖离面 · 沿方边连续换握",
    sample,
  });
  if (!same(b, to))
    parts.push({
      duration: 0.38,
      phase: "腕先到位 · 手指重新接稳",
      sample: (p) => blendFingerPose(b, to, smooth(p)),
    });
  return parts;
}
