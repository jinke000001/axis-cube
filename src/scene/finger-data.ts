import { Quaternion, Vector3 } from "three";
import raw from "./finger-library.json";
import { CENTER, type HandPose, type Side } from "./motion";
import type { FingerIndex } from "./finger-rig";
import type { FingerContact } from "./finger-contact";

export interface PoseData { position: number[]; quaternion: number[]; joints: Record<string, number>; }
export interface ContactData { finger: FingerIndex; point: number[]; normal: number[]; padOffset: number[]; }
export interface FingerStroke {
  side: Side; finger: FingerIndex;
  samples: { phase: number; angle: number; angles: number[]; target: number[]; normal: number[]; padLocalOffset: number[] }[];
  hover: Record<"start" | "end", { angles: number[]; posePass: boolean }>;
}
export interface FingerLibrary {
  hands: Record<Side, { support: PoseData; contacts: ContactData[]; active: PoseData;
    freeAngles: Record<FingerIndex, number[]>; grip: PoseData; gripContacts: ContactData[] }>;
  strokes: Record<string, FingerStroke>;
  carries: Record<Side, { angle: number; withdrawal: PoseData[]; relocation: PoseData[]; hold: PoseData; contacts: ContactData[] }>;
}
export const fingerLibrary = raw as unknown as FingerLibrary;
export const oppositeHand = (side: Side): Side => side === "left" ? "right" : "left";

export function handPose(data: PoseData): HandPose {
  return { position: new Vector3().fromArray(data.position), quaternion: new Quaternion().fromArray(data.quaternion), joints: { ...data.joints }, closed: 1 };
}
export function clonePose(pose: HandPose): HandPose {
  return { position: pose.position.clone(), quaternion: pose.quaternion.clone(), joints: { ...pose.joints }, closed: pose.closed };
}
export function blendFingerPose(a: HandPose, b: HandPose, t: number): HandPose {
  return { position: a.position.clone().lerp(b.position,t), quaternion: a.quaternion.clone().slerp(b.quaternion,t), closed: 1,
    joints: Object.fromEntries(Object.entries(a.joints!).map(([name,value]) => [name,value + (b.joints![name] - value)*t])) };
}
export function sampledPose(frames: readonly PoseData[], progress: number): HandPose {
  const p = Math.min(1, Math.max(0,progress)) * (frames.length-1), lo = Math.floor(p), hi = Math.min(frames.length-1,lo+1);
  return blendFingerPose(handPose(frames[lo]),handPose(frames[hi]),p-lo);
}
export function withFinger(pose: HandPose, side: Side, finger: FingerIndex, angles: readonly number[]): HandPose {
  const result = clonePose(pose);
  angles.forEach((angle,i) => { result.joints![`${side}_finger${finger}_joint${i+1}`] = angle; });
  return result;
}
export function rotatedFingerPose(pose: HandPose, q: Quaternion): HandPose {
  return { ...clonePose(pose), position:pose.position.clone().sub(CENTER).applyQuaternion(q).add(CENTER), quaternion:q.clone().multiply(pose.quaternion) };
}
export function fingerContacts(side: Side, data: readonly ContactData[], role: FingerContact["role"] = "support", q = new Quaternion()): FingerContact[] {
  return data.map((c) => ({ side, finger:c.finger, role, point:new Vector3().fromArray(c.point).applyQuaternion(q), normal:new Vector3().fromArray(c.normal).applyQuaternion(q), padOffset:new Vector3().fromArray(c.padOffset) }));
}
export function strokeSample(stroke: FingerStroke, progress: number) {
  const p = Math.max(0, Math.min(1,progress))*(stroke.samples.length-1), lo = Math.floor(p), hi = Math.min(stroke.samples.length-1,lo+1);
  const a = stroke.samples[lo], b = stroke.samples[hi], t = p-lo;
  return { angle:a.angle+(b.angle-a.angle)*t, angles:a.angles.map((v,i) => v+(b.angles[i]-v)*t),
    padOffset:new Vector3().fromArray(a.padLocalOffset).lerp(new Vector3().fromArray(b.padLocalOffset),t) };
}
