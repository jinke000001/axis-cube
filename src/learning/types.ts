import type { Face } from "../core/cube";

/** A published example is independent of the visitor's captured cube. */
export interface LessonCase {
  id: string;
  title: string;
  when: string;
  orientation: string;
  explanation: string[];
  /** Moves from the standard solved cube to the example's starting state. */
  setup: string;
  algorithm: string;
  steps: { end: number; label: string; explanation: string }[];
  check: string;
  focusFace?: Face;
  /** Fixed sticker-colour ids for complete physical edges/corners, not position faces. */
  focusPieces?: Face[][];
  /** Names the tracked physical pieces in the demonstration's colour scheme. */
  focusLabel?: string;
}

export interface CourseLesson {
  id: string;
  number: number;
  title: string;
  kicker: string;
  summary: string;
  goal: string;
  prepare: string[];
  cases: LessonCase[];
  checklist: string[];
  pitfalls: { title: string; body: string }[];
  practice: string;
  relatedStudyIds: string[];
}
