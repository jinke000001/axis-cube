import { Quaternion, Vector3 } from "three";
import grips from "./finger-grips.json";
import type { HandPose, Side, MotionFrame } from "./motion";
import type { PlaybackProgram } from "./playback";
import type { FingerIndex } from "./finger-rig";

/** Static, mesh-calibrated hand placement; active trajectories are separate. */
export function stableGrip(side: Side): HandPose {
  const grip = grips.hands[side];
  return {
    position: new Vector3().fromArray(grip.position),
    quaternion: new Quaternion().fromArray(grip.quaternion),
    closed: 1,
    joints: Object.fromEntries(grip.fingers.flatMap((finger) => finger.angles.map((angle, i) => [
      `${side}_finger${finger.finger}_joint${i + 1}`, angle,
    ]))),
  };
}

export function gripContact(side: Side, finger: FingerIndex) {
  const contact = grips.hands[side].fingers[finger - 1];
  return {
    side, finger,
    point: new Vector3().fromArray(contact.point),
    normal: new Vector3().fromArray(contact.normal),
    padOffset: new Vector3().fromArray(contact.padOffset),
    angles: contact.angles.slice(),
  };
}

export function restingFingerFrame(): MotionFrame {
  return {
    index: 0, phase: "稳持", stage: "HOLD", angle: 0,
    orientation: new Quaternion(), left: stableGrip("left"), right: stableGrip("right"),
    support: "left", progress: 1, active: null, complete: true,
  };
}

/** Used by the same renderer for mesh calibration before a gesture is certified. */
export function staticFingerPlayback(): PlaybackProgram {
  return { steps: [], duration: 0, sample: restingFingerFrame };
}
