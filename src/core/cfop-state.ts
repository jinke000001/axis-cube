import { FACES, SLOTS, SOLVED } from "./cube";

export const CFOP_PHASES = ["cross", "f2l", "oll", "pll"] as const;
export type CFOPPhaseName = (typeof CFOP_PHASES)[number];
const crossSlots = SLOTS.filter((slot) => slot.position[1] === -1 &&
  Math.abs(slot.position[0]) + Math.abs(slot.position[2]) === 1).map((slot) => slot.index);
const f2lSlots = SLOTS.filter((slot) => slot.position[1] < 1).map((slot) => slot.index);
const centers = FACES.map((_, index) => index * 9 + 4);
const matches = (state: string, indices: number[]) => indices.every((index) => state[index] === SOLVED[index]);

/** Geometric postconditions, independent of the algorithm library. */
export function isCFOPPhaseSolved(state: string, phase: CFOPPhaseName): boolean {
  if (state.length !== 54 || !matches(state, centers)) return false;
  if (phase === "cross") return matches(state, crossSlots);
  if (!matches(state, f2lSlots)) return false;
  if (phase === "f2l") return true;
  if (state.slice(0, 9) !== "U".repeat(9)) return false;
  return phase === "oll" || state === SOLVED;
}
