import {
  FACES,
  SLOTS,
  moveAngle,
  parseAlgorithm,
  snapshots,
  type Move,
  type Face,
} from "../core/cube";

export interface LessonPlayback {
  moves: Move[];
  states: string[];
}

export interface LessonFrame {
  state: string;
  completed: number;
  move?: Move;
  angle: number;
}

const pieceSlots = [...new Set(SLOTS.map(slot => slot.position.join(",")))].map(position => SLOTS.filter(slot => slot.position.join(",") === position));
export function targetStickerIndices(state: string, pieces: readonly (readonly Face[])[] = []): Set<number> {
  const wanted = new Set(pieces.filter(colors => colors.length === 2 || colors.length === 3).map(colors => [...colors].sort().join("")));
  const result = new Set<number>();
  for (const slots of pieceSlots) {
    if (wanted.has(slots.map(slot => state[slot.index]).sort().join(""))) slots.forEach(slot => result.add(slot.index));
  }
  return result;
}

export function createLessonPlayback(initialState: string, algorithm: string): LessonPlayback {
  if (initialState.length !== 54 || [...initialState].some((face) => !FACES.includes(face as typeof FACES[number]))) {
    throw new Error("这个教学局面不完整，请返回课程重新选择。");
  }
  const moves = parseAlgorithm(algorithm);
  return { moves, states: snapshots(initialState, moves) };
}

export function clampLessonPosition(position: number, count: number): number {
  return Math.max(0, Math.min(count, Number.isFinite(position) ? position : 0));
}

/** The state commits only at an integer boundary; a partial turn never changes a saved step. */
export function sampleLessonFrame(
  playback: LessonPlayback,
  position: number,
  reducedMotion = false,
): LessonFrame {
  const clamped = clampLessonPosition(position, playback.moves.length);
  const completed = Math.floor(clamped);
  if (completed === playback.moves.length || clamped === completed || reducedMotion) {
    return { state: playback.states[completed], completed, angle: 0 };
  }
  const move = playback.moves[completed];
  // Leave a short still moment before and after each turn so its reference is readable.
  const fraction = Math.min(1, Math.max(0, (clamped - completed - 0.1) / 0.76));
  const eased = fraction * fraction * (3 - 2 * fraction);
  return { state: playback.states[completed], completed, move, angle: moveAngle(move) * eased };
}

export function previousLessonStep(position: number, count: number): number {
  return Math.max(0, Math.ceil(clampLessonPosition(position, count)) - 1);
}

export function nextLessonStep(position: number, count: number): number {
  return Math.min(count, Math.floor(clampLessonPosition(position, count)) + 1);
}
