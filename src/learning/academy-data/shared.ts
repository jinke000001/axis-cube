import { applyAlgorithm, COLOR_NAMES, FACES, SLOTS, SOLVED, parseAlgorithm } from "../../core/cube.ts";
import type { Face, Vec3 } from "../../core/cube.ts";
import type { LessonCase } from "../types.ts";

export const WHITE_DOWN = "z2";
export const EDGE_CYCLE = "R U' R U R U R U' R' U' R2";
export const LATE = `${WHITE_DOWN} ${EDGE_CYCLE}`;
export const HOLD = "白色中心朝下、黄色中心朝上。先读前面和右面的中心色，一段动作内保持这个正面；y 表示整颗横向换向，不是只转顶层。";
export type Segment = [moves: string, label: string, explanation: string];

export function inverse(algorithm: string): string {
  return parseAlgorithm(algorithm).reverse().map((move) => {
    const symbol = move.notation.replace(/[2']+$/, "");
    return move.turns === 2 ? `${symbol}2` : move.turns === 3 ? symbol : `${symbol}'`;
  }).join(" ");
}

export function makeCase(
  data: Omit<LessonCase, "algorithm" | "steps" | "orientation"> & { orientation?: string },
  segments: Segment[],
): LessonCase {
  let end = 0;
  return {
    ...data,
    orientation: data.orientation ?? HOLD,
    algorithm: segments.map(([moves]) => moves).join(" "),
    steps: segments.map(([moves, label, explanation]) => ({
      end: end += parseAlgorithm(moves).length, label, explanation,
    })),
  };
}

export const POSITIONS: Vec3[] = [...new Set(SLOTS.map((slot) => slot.position.join()))]
  .map((key) => key.split(",").map(Number) as Vec3);
export const center = (state: string, face: Face): Face => state[FACES.indexOf(face) * 9 + 4] as Face;
export const colorKey = (colors: readonly string[]) => [...colors].sort().join("");
export const slotsAt = (position: readonly number[]) => SLOTS.filter((slot) => slot.position.join() === position.join());
export const colorsAt = (state: string, position: readonly number[]): Face[] => slotsAt(position).map((slot) => state[slot.index] as Face);
export const colorLabel = (colors: readonly Face[]) => colors.map((color) => COLOR_NAMES[color]).join("·");
export function findPiece(state: string, colors: readonly Face[]): Vec3 {
  const position = POSITIONS.find((p) => colorKey(colorsAt(state, p)) === colorKey(colors));
  if (!position) throw new Error(`Teaching piece not found: ${colors.join()}`);
  return [...position];
}
export function homePosition(state: string, colors: readonly Face[]): Vec3 {
  const faces = FACES.filter((face) => colors.includes(center(state, face)));
  return [Number(faces.includes("R")) - Number(faces.includes("L")), Number(faces.includes("U")) - Number(faces.includes("D")), Number(faces.includes("F")) - Number(faces.includes("B"))];
}
export function stickerFace(state: string, colors: readonly Face[], color: Face): Face {
  const position = findPiece(state, colors);
  return slotsAt(position).find((slot) => state[slot.index] === color)!.face;
}
export function solvedPosition(state: string, position: readonly number[]): boolean {
  return slotsAt(position).every((slot) => state[slot.index] === center(state, slot.face));
}
export const setupState = (item: Pick<LessonCase, "setup">) => applyAlgorithm(SOLVED, item.setup);
