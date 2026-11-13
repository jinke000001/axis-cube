import type { Move } from "../core/cube";
import type { CFOPCase } from "../learning/cfop-library";

export type TeachingHand = "left" | "right";
export type TeachingFinger = "thumb" | "index" | "middle" | "ring" | "little";
export interface FingerHint {
  hand?: TeachingHand;
  finger: TeachingFinger;
  source: "chart" | "choreography";
  color?: "blue" | "red" | "orange";
  reason: string;
}
export interface FormulaStep {
  index: number;
  move: Move;
  group: number;
  /** Original printed token index. Repeated groups share printed tokens. */
  printedIndex: number;
  hint?: FingerHint;
}
export interface FormulaGroup {
  index: number;
  text: string;
  start: number;
  end: number;
}
export interface FormulaRecord {
  id: string;
  case: CFOPCase;
  variant: number;
  label: string;
  algorithm: string;
  steps: readonly FormulaStep[];
  groups: readonly FormulaGroup[];
  initialState: string;
  sources: readonly {
    url: string;
    title: string;
    reviewed: boolean;
    note: string;
  }[];
}
export interface DemonstratorStatus {
  ready: boolean;
  playing: boolean;
  /** Number of fully committed source steps at a stable boundary. */
  completed: number;
  active: number;
  phase: string;
  stageCode?: string;
  time?: number;
  duration?: number;
  stepBoundaries?: readonly number[];
  instruction: string;
  finger: string;
  error?: string;
}
export interface DemonstratorHandle {
  play(): void;
  pause(): void;
  seek(step: number): void;
  seekTime?(seconds: number): void;
  resetView(): void;
  setView(view: "solver" | "side" | "back"): void;
}
