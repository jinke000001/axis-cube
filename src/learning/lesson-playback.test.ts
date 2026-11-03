import { describe, expect, it } from "vitest";
import { applyAlgorithm, applyMove, moveAngle, SOLVED, type Face } from "../core/cube";
import { createLessonPlayback, nextLessonStep, previousLessonStep, sampleLessonFrame, targetStickerIndices } from "./lesson-playback";

describe("lesson playback state boundaries", () => {
  it("tracks whole target pieces through layer and whole-cube turns without changing sticker colors", () => {
    const targets: Face[][] = [["U", "R", "F"], ["F", "R"]];
    const playback = createLessonPlayback(SOLVED, "R U z2 F' M y x");
    const original = [...targetStickerIndices(SOLVED, targets)];
    for (const state of playback.states) {
      const indices = [...targetStickerIndices(state, targets)];
      expect(indices).toHaveLength(5);
      expect(indices.map(index => state[index]).sort()).toEqual(targets.flat().sort());
    }
    expect([...targetStickerIndices(playback.states[1], targets)]).not.toEqual(original);
    expect(targetStickerIndices(SOLVED, [["U", "D"]]).size).toBe(0);
  });
  it("keeps a partial turn separate from the committed state and lands exactly on the next state", () => {
    const lesson = createLessonPlayback(SOLVED, "R U U' R'");
    const partial = sampleLessonFrame(lesson, 0.5);
    expect(partial.state).toBe(SOLVED);
    expect(partial.completed).toBe(0);
    expect(partial.move?.notation).toBe("R");
    expect(partial.angle).toBeLessThan(0);
    expect(partial.angle).toBeGreaterThan(-Math.PI / 2);
    expect(sampleLessonFrame(lesson, 1)).toEqual({ state: applyMove(SOLVED, "R"), completed: 1, angle: 0 });
    expect(sampleLessonFrame(lesson, 4)).toEqual({ state: SOLVED, completed: 4, angle: 0 });
    expect(sampleLessonFrame(lesson, 500)).toEqual(sampleLessonFrame(lesson, 4));
  });

  it("can seek backwards after a whole-cube rotation without silently restoring standard centers", () => {
    const start = applyAlgorithm(SOLVED, "x2");
    const lesson = createLessonPlayback(start, "y R2' U' R2 y'");
    expect(sampleLessonFrame(lesson, 0).state[4]).toBe("D");
    expect(sampleLessonFrame(lesson, 1).state).toBe(applyAlgorithm(start, "y"));
    expect(sampleLessonFrame(lesson, 2).state).toBe(applyAlgorithm(start, "y R2'"));
    expect(sampleLessonFrame(lesson, previousLessonStep(2.3, 5)).state).toBe(applyAlgorithm(start, "y R2'"));
    expect(sampleLessonFrame(lesson, previousLessonStep(2, 5)).state).toBe(applyAlgorithm(start, "y"));
    expect(sampleLessonFrame(lesson, 0).state).toBe(start);
  });

  it("preserves the chosen path of inverse and half turns, not just their matching final state", () => {
    const lesson = createLessonPlayback(SOLVED, "R2' U' x'");
    const half = sampleLessonFrame(lesson, .9);
    expect(half.angle).toBe(Math.PI);
    expect(half.angle).toBe(moveAngle(lesson.moves[0]));
    expect(sampleLessonFrame(lesson, 1.9).angle).toBe(Math.PI / 2);
    expect(sampleLessonFrame(lesson, 2.9).move?.kind).toBe("rotation");
  });

  it("reduced motion advances the same exact snapshots without transient turn geometry", () => {
    const lesson = createLessonPlayback(SOLVED, "F U R");
    expect(sampleLessonFrame(lesson, 1.6, true)).toEqual(sampleLessonFrame(lesson, 1, true));
    expect(sampleLessonFrame(lesson, 3, true)).toEqual(sampleLessonFrame(lesson, 3));
  });

  it("handles single-step navigation at the start, a partial move and the last move", () => {
    expect(previousLessonStep(.4, 4)).toBe(0);
    expect(previousLessonStep(0, 4)).toBe(0);
    expect(previousLessonStep(4, 4)).toBe(3);
    expect(nextLessonStep(.4, 4)).toBe(1);
    expect(nextLessonStep(4, 4)).toBe(4);
    expect(nextLessonStep(3.99, 4)).toBe(4);
    expect(nextLessonStep(NaN, 4)).toBe(1);
  });

  it("allows an observation-only lesson and rejects malformed states and instructions", () => {
    expect(sampleLessonFrame(createLessonPlayback(SOLVED, ""), 20)).toEqual({ state: SOLVED, completed: 0, angle: 0 });
    expect(() => createLessonPlayback("U".repeat(53), "R")).toThrow("局面不完整");
    expect(() => createLessonPlayback("?".repeat(54), "R")).toThrow("局面不完整");
    expect(() => createLessonPlayback(SOLVED, "Q")).toThrow("不支持");
  });
});
