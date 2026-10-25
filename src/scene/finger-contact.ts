import { Quaternion, Vector3 } from "three";
import { NORMALS, type Move } from "../core/cube";
import { CENTER, CUBE_SIZE, type HandPose, type Side } from "./motion";
import { fingerJoints, forwardFinger, type FingerIndex } from "./finger-rig";

export interface FingerContact {
  side: Side;
  finger: FingerIndex;
  role: "support" | "drive";
  /** Object-space point and normal, before the current move rotates its layer. */
  point: Vector3;
  normal: Vector3;
  /** A measured point on the actual distal pad mesh, in its fixed tip frame. */
  padOffset: Vector3;
}

export function contactTarget(contact: FingerContact, move?: Move, angle = 0, orientation = new Quaternion()) {
  const rotation = contact.role === "drive" && move
    ? new Quaternion().setFromAxisAngle(new Vector3(...NORMALS[move.face]), angle)
    : new Quaternion();
  return {
    point: contact.point.clone().applyQuaternion(rotation).applyQuaternion(orientation).add(CENTER),
    normal: contact.normal.clone().applyQuaternion(rotation).applyQuaternion(orientation),
  };
}

/** A support contact cannot be rigidly attached to the layer being driven. */
export function contactHasCorrectBody(contact: FingerContact, move?: Move) {
  if (!move) return contact.role === "support";
  const coordinate = contact.point.dot(new Vector3(...NORMALS[move.face]));
  const layer = coordinate < -CUBE_SIZE / 6 ? -1 : coordinate > CUBE_SIZE / 6 ? 1 : 0;
  const moving = (move.layers ?? [1]).some((n) => n === layer);
  return contact.role === "drive" ? moving : !moving;
}

export function measureContact(pose: HandPose, contact: FingerContact, move?: Move, angle = 0, orientation = new Quaternion()) {
  const definitions = fingerJoints(contact.side, contact.finger);
  const angles = definitions.map((joint) => pose.joints?.[joint.name]);
  if (angles.some((a) => a === undefined || !Number.isFinite(a)))
    return { valid: false, error: Infinity, actual: new Vector3(), target: contactTarget(contact, move, angle, orientation).point };
  const actual = forwardFinger(contact.side, contact.finger, angles as number[], pose, contact.padOffset).position;
  const target = contactTarget(contact, move, angle, orientation).point;
  const error = actual.distanceTo(target);
  return { actual, target, error, valid: error <= 0.00035 && contactHasCorrectBody(contact, move) };
}

/**
 * Visual support gate: three separated, non-collinear measured pad contacts.
 * This deliberately does not claim force closure, friction or hardware stability.
 */
export function hasMeasuredSupport(
  poses: Record<Side, HandPose>, contacts: readonly FingerContact[], move?: Move, angle = 0, orientation = new Quaternion(),
) {
  const support = contacts.filter((contact) => (contact.role === "support" || move?.kind === "rotation") &&
    measureContact(poses[contact.side], contact, move, angle, orientation).valid);
  for (let a = 0; a < support.length; a++)
    for (let b = a + 1; b < support.length; b++)
      for (let c = b + 1; c < support.length; c++) {
        const edge = support[b].point.clone().sub(support[a].point);
        const other = support[c].point.clone().sub(support[a].point);
        if (edge.cross(other).length() / 2 > 0.00015) return true;
      }
  return false;
}
