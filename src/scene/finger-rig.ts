import { Euler, Matrix3, Quaternion, Vector3 } from "three";
import rigData from "./finger-rig.json";
import type { Side } from "./grip-planner";

export type FingerIndex = 1 | 2 | 3 | 4 | 5;
export interface WristTransform {
  position: Vector3;
  quaternion: Quaternion;
}
interface JointDefinition {
  name: string;
  type: string;
  parent: string;
  child: string;
  xyz: number[];
  rpy: number[];
  axis: number[];
  lower: number;
  upper: number;
  velocity: number;
}
const chains = new Map<string, JointDefinition[]>();
for (const side of ["left", "right"] as const)
  for (let finger = 1; finger <= 5; finger++) {
    const chain: JointDefinition[] = [];
    let link = `${side}_finger${finger}_tip_link`;
    while (link !== `${side}_palm_link`) {
      const joint = rigData.sides[side].joints.find((j) => j.child === link);
      if (!joint) throw new Error(`Incomplete Wuji kinematic chain: ${link}`);
      chain.unshift(joint);
      link = joint.parent;
    }
    chains.set(`${side}:${finger}`, chain);
  }

/** Manufacturer limits, in radians; no human-hand axes are substituted. */
export function fingerJoints(side: Side, finger: FingerIndex): readonly JointDefinition[] {
  return chains.get(`${side}:${finger}`)!.filter((j) => j.type !== "fixed");
}

/** Exact URDF forward kinematics including the fixed fingertip frame. */
export function forwardFinger(
  side: Side,
  finger: FingerIndex,
  angles: readonly number[],
  wrist?: WristTransform,
  padOffset = new Vector3(),
) {
  if (angles.length !== 4 || angles.some((a) => !Number.isFinite(a)))
    throw new Error("A Wuji finger requires four finite joint angles.");
  const position = wrist?.position.clone() ?? new Vector3();
  const quaternion = wrist?.quaternion.clone() ?? new Quaternion();
  const origins: Vector3[] = [], axes: Vector3[] = [];
  let index = 0;
  for (const joint of chains.get(`${side}:${finger}`)!) {
    position.add(new Vector3().fromArray(joint.xyz).applyQuaternion(quaternion));
    quaternion.multiply(new Quaternion().setFromEuler(new Euler(
      joint.rpy[0], joint.rpy[1], joint.rpy[2], "ZYX",
    )));
    if (joint.type !== "fixed") {
      const axis = new Vector3().fromArray(joint.axis).normalize();
      origins.push(position.clone());
      axes.push(axis.clone().applyQuaternion(quaternion));
      quaternion.multiply(new Quaternion().setFromAxisAngle(axis, angles[index++]));
    }
  }
  position.add(padOffset.clone().applyQuaternion(quaternion));
  const jacobian = axes.map((axis, i) => axis.clone().cross(position.clone().sub(origins[i])));
  return { position, quaternion, origins, axes, jacobian };
}

export interface FingerTarget {
  side: Side;
  finger: FingerIndex;
  position: Vector3;
  initial: readonly number[];
  wrist?: WristTransform;
  padOffset?: Vector3;
  tolerance?: number;
  iterations?: number;
}

/**
 * Damped least-squares IK constrained by each real URDF joint limit.
 * Error is returned explicitly: an unreachable contact is never called a grip.
 * Geometry/collision acceptance belongs to the trajectory calibration pass.
 */
export function fitFinger(target: FingerTarget) {
  const joints = fingerJoints(target.side, target.finger);
  if (target.initial.length !== 4 || target.initial.some((a) => !Number.isFinite(a)))
    throw new Error("A finger seed requires four finite joint angles.");
  let angles = target.initial.map((a, i) => Math.max(joints[i].lower, Math.min(joints[i].upper, a)));
  let best = angles.slice(), bestError = Infinity, iterations = 0;
  const tolerance = target.tolerance ?? 0.00004;
  for (; iterations < (target.iterations ?? 100); iterations++) {
    const frame = forwardFinger(target.side, target.finger, angles, target.wrist, target.padOffset);
    const error = target.position.clone().sub(frame.position);
    const distance = error.length();
    if (distance < bestError) { bestError = distance; best = angles.slice(); }
    if (distance <= tolerance) break;
    const j = frame.jacobian;
    const sum = (a: "x" | "y" | "z", b: "x" | "y" | "z") => j.reduce((n, v) => n + v[a] * v[b], 0);
    const damping = 0.000001;
    const inverse = new Matrix3().set(
      sum("x", "x") + damping, sum("x", "y"), sum("x", "z"),
      sum("y", "x"), sum("y", "y") + damping, sum("y", "z"),
      sum("z", "x"), sum("z", "y"), sum("z", "z") + damping,
    ).invert();
    const direction = error.applyMatrix3(inverse);
    const delta = j.map((column) => Math.max(-0.22, Math.min(0.22, column.dot(direction))));
    let accepted = false;
    for (const scale of [1, 0.5, 0.25, 0.1]) {
      const next = angles.map((a, i) => Math.max(joints[i].lower, Math.min(joints[i].upper, a + delta[i] * scale)));
      const candidate = forwardFinger(target.side, target.finger, next, target.wrist, target.padOffset);
      if (candidate.position.distanceTo(target.position) < distance - 1e-10) {
        angles = next; accepted = true; break;
      }
    }
    if (!accepted) break;
  }
  const finalError = forwardFinger(target.side, target.finger, angles, target.wrist, target.padOffset).position.distanceTo(target.position);
  if (finalError < bestError) { bestError = finalError; best = angles; }
  return { angles: best, error: bestError, reached: bestError <= tolerance, iterations };
}
