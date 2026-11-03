import type { Face, Vec3 } from "../core/cube.ts";

/** The initial position is teaching data; piece identity always follows its colors. */
export interface ActivityOption {
  id: string;
  label: string;
  explanation?: string;
  /** Optional state preview, expressed as moves from the standard solved cube. */
  setup?: string;
}

interface ActivityBase {
  id: string;
  kind: "recognize" | "predict" | "transfer";
  title: string;
  question: string;
  setup: string;
  /** Revealed as a demonstration after answering; may be empty for identification. */
  algorithm: string;
  hint: string;
  explanation: string;
  /** Highlight only after answering or explicitly requesting a hint. */
  focusPieces?: Face[][];
  options: ActivityOption[];
}

export interface ChoiceActivity extends ActivityBase {
  mode: "choice";
  answer: string;
}

export interface PickPieceActivity extends ActivityBase {
  mode: "pick-piece";
  answerColors: Face[];
  answerPosition: Vec3;
  /** Correct option for the text-only fallback; options name physical colors. */
  answer: string;
}

export type LessonActivity = ChoiceActivity | PickPieceActivity;

export function isChoiceActivity(activity: LessonActivity): activity is ChoiceActivity {
  return activity.mode === "choice";
}

export function isPickPieceActivity(activity: LessonActivity): activity is PickPieceActivity {
  return activity.mode === "pick-piece";
}

export interface LearningTrack {
  id: string;
  title: string;
  description: string;
  lessonIds: string[];
}
