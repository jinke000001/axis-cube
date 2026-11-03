import { describe, expect, it } from "vitest";
import { applyAlgorithm, parseAlgorithm, snapshots, SOLVED } from "../core/cube";
import { canShowMechanicalHands, completedMechanicalSourceStep, expandMechanicalSource, loadMechanicalTimeline } from "./motion-loader";

const start = applyAlgorithm(SOLVED, "R2 D F' U L2 B R' U2 x");
describe("original logical steps survive mechanical expansion and cadence", () => {
  it("preserves every source boundary for outer, M, wide, signed half and x/y moves", () => {
    for (const token of ["R", "U", "F", "B", "D", "L", "M", "r", "Rw", "Lw", "x", "y"]) {
      for (const suffix of ["", "'", "2", "2'"]) {
        const source = parseAlgorithm(`U ${token}${suffix} R'`), expanded = expandMechanicalSource(source);
        const expected = snapshots(start, source), actual = snapshots(start, expanded.moves);
        expect(expanded.boundaries.map(boundary => actual[boundary]), token + suffix).toEqual(expected);
      }
    }
  });
  it.each(["R U R' U'", "M2 U Rw'", "x2' R U2' x", "y2' R U y", "Lw2' M' U2"])("retimed program maps %s to the same 54 stickers at each committed step", async algorithm => {
    const timeline = await loadMechanicalTimeline(algorithm, 15);
    const expected = snapshots(start, timeline.sourceMoves), actual = snapshots(start, timeline.program.steps.map(step => step.move));
    expect(timeline.sourceTimes).toHaveLength(expected.length);
    timeline.sourceBoundaries.forEach((boundary, sourceStep) => {
      const frame = timeline.program.sample(timeline.sourceTimes[sourceStep]);
      expect(frame.index, `source step ${sourceStep}`).toBe(boundary);
      expect(actual[frame.index]).toBe(expected[sourceStep]);
      expect(completedMechanicalSourceStep(timeline, frame.index)).toBe(sourceStep);
      expect(Math.abs(frame.angle)).toBeLessThan(1e-7);
    });
    for (let execution = 0; execution < timeline.program.steps.length; execution++) {
      const sourceStep = completedMechanicalSourceStep(timeline, execution);
      expect(execution).toBeGreaterThanOrEqual(timeline.sourceBoundaries[sourceStep]);
      expect(execution).toBeLessThan(timeline.sourceBoundaries[sourceStep + 1]);
    }
  }, 20000);
  it("hides uncalibrated z/E/S/wide axes instead of silently approximating", async () => {
    for (const algorithm of ["z", "E2", "S'", "Fw", "Uw2"]) {
      expect(canShowMechanicalHands(algorithm)).toBe(false);
      await expect(loadMechanicalTimeline(algorithm, 5)).rejects.toThrow("尚未提供");
    }
  });
});
