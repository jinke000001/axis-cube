import { Vector3 } from 'three';
import { handPose } from '../scene/finger-data';
import type { FingerContact } from '../scene/finger-contact';
import { CENTER, type HandPose, type Side } from '../scene/motion';
import oldLeft from '../../art/wuji-teaching/wide-left-grip-calibration.json';
import oldRight from '../../art/wuji-teaching/wide-right-grip-calibration.json';
import data from '../../art/wuji-teaching/grip-c114-r1/wide-grip-a5.json';

/** The original wide-layer thumb material point and terminal orientation stay
 * fixed. The G1-derived variant uses middle/ring to turn the outside layer;
 * index/little are ready. This is a separately checked variant, not an old pass. */
export function wideGripC114(side: Side, p: HandPose) {
  const old = side === 'left' ? oldLeft : oldRight;
  if (!Object.entries(old.pose.joints).every(([k,v]) => Math.abs(p.joints![k]-v)<1e-6)) return undefined;
  const entry = data.hands[side], base = handPose(old.pose), pose = handPose(entry.pose);
  const q = p.quaternion.clone().multiply(base.quaternion.clone().invert());
  const transform = (v:Vector3) => v.sub(base.position).applyQuaternion(q).add(p.position);
  pose.position.copy(transform(pose.position)); pose.quaternion.premultiply(q);
  const contacts:FingerContact[] = entry.contacts.map(c => ({side,finger:c.finger as 1|2|3|4|5,role:'support',
    point:transform(new Vector3().fromArray(c.point).add(CENTER)).sub(CENTER),normal:new Vector3().fromArray(c.normal).applyQuaternion(q),padOffset:new Vector3().fromArray(c.padOffset)}));
  return {pose,contacts};
}
