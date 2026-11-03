import type { Face } from "./cube";
import type { Quad, RGB } from "./vision";

/** A measured sticker, before assigning any cube color. Fractions are 0..1. */
export interface CellEvidence {
  rgb: RGB;
  alternatives: RGB[];
  coverage: number;
  glare: number;
  spread: number;
}

export interface FaceAnalysis {
  /** Coordinates in the input image. Null means no reliable 3×3 grid found. */
  quad: Quad | null;
  cells: CellEvidence[];
  confidence: number;
  warnings: string[];
  method: "grid" | "manual";
}

export type CaptureEvidence = Partial<Record<Face, CellEvidence[]>>;

export interface CaptureClassification {
  colors: string;
  uncertain: number[];
  /** Changes supported by image candidates and whole-cube constraints. */
  adjusted: number[];
  rotations: Partial<Record<Face, number>>;
  status: "incomplete" | "ready" | "review";
  message: string;
}
