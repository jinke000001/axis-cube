import { Quaternion, Vector3 } from 'three';
import { clonePose, handPose, fingerLibrary } from '../scene/finger-data';
import { CENTER, type HandPose } from '../scene/motion';
import type { FingerContact } from '../scene/finger-contact';
import data from '../../art/wuji-teaching/grip-c114-r1/context-r-uprime-a10.json';
import zero from '../../art/wuji-teaching/grip-c114-r1/context-r-zero-uprime-a10.json';

const contacts = (cs: typeof data.loaded.contacts): FingerContact[] => cs.map(c => ({
  side: 'right', finger: c.finger as 1|2|3|4|5, role: 'support',
  point: new Vector3().fromArray(c.point), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset),
}));
/** A separate G1-derived wrist variant. Its loaded thumb retains the G1
 * support pad and terminal direction, rather than claiming the grip thumb is
 * unchanged. I/M/R are prepared below the following U slab before the R turn. */
export function contextWristC114(old: HandPose) {
  const base = handPose(fingerLibrary.hands.right.grip);
  const q = old.quaternion.clone().multiply(base.quaternion.clone().invert());
  const point = (v: Vector3) => v.sub(base.position).applyQuaternion(q).add(old.position);
  const pose = handPose(data.loaded.pose);
  pose.position.copy(point(pose.position)); pose.quaternion.premultiply(q);
  return { pose, contacts: contacts(data.loaded.contacts).map(c => ({ ...c,
    point: point(c.point.clone().add(CENTER)).sub(CENTER), normal: c.normal.clone().applyQuaternion(q),
  })) };
}
export function contextSupportC114(angle: number) {
  if (Math.abs(angle + Math.PI / 2) < 1e-7) return { pose: handPose(data.carry.pose), contacts: contacts(data.carry.contacts), digit: 1 as const };
  if (Math.abs(angle) < 1e-7) return { pose: handPose(zero.pose), contacts: contacts(zero.contacts), digit: 2 as const };
  return undefined;
}
export function contextLoadedC114(angle: number) {
  const pose = handPose(data.loaded.pose), q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
  pose.position.sub(CENTER).applyQuaternion(q).add(CENTER); pose.quaternion.premultiply(q);
  return { pose: clonePose(pose), contacts: contacts(data.loaded.contacts).map(c => ({ ...c,
    point: c.point.clone().applyQuaternion(q), normal: c.normal.clone().applyQuaternion(q),
  })) };
}
