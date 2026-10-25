import type { Move } from "../core/cube";
import { compileMotion, motionDuration, sampleMotion, type MotionFrame, type Side } from "./motion";

export interface PlaybackStep {
  move: Move;
  start: number;
  duration: number;
  active: Side;
}
/** A deterministic timeline; state changes happen exactly at step boundaries. */
export interface PlaybackProgram {
  steps: readonly PlaybackStep[];
  duration: number;
  sample(time: number): MotionFrame;
}

export function mechanicalPlayback(moves: Move[]): PlaybackProgram {
  const steps = compileMotion(moves);
  return { steps, duration: motionDuration(steps), sample: (time) => sampleMotion(steps, time) };
}
