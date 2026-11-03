import { describe, expect, it } from "vitest";
import {
  canReadProgress,
  emptyProgress,
  mergeProgress,
  nextProgressTimestamp,
  parseProgress,
} from "./progress";
describe("learning progress recovery", () => {
  it("recovers valid lessons independently of malformed records", () => {
    const result = parseProgress(
      JSON.stringify({
        version: 1,
        lastLesson: "notation",
        lessons: {
          notation: {
            caseId: "right",
            step: 3,
            checks: ["orientation", 5],
            completed: true,
          },
          broken: { step: -2 },
          __proto__: { caseId: "x", step: 0 },
        },
      }),
    );
    expect(Object.keys(result.lessons)).toEqual(["notation"]);
    expect(result.lessons.notation.checks).toEqual(["orientation"]);
    expect(result.lessons.notation.completed).toBe(true);
  });
  it("does not interpret unknown schemas or damaged JSON as completed lessons", () => {
    for (const raw of [
      "{",
      "null",
      '{"version":2,"lessons":{}}',
      '{"version":1,"lessons":[]}',
    ])
      expect(parseProgress(raw).lessons).toEqual({});
  });
  it("blocks writes over damaged nested records while allowing partial reading", () => {
    const raw = JSON.stringify({
      version: 1,
      lessons: {
        notation: { caseId: "right", step: 3, checks: [], completed: true },
        broken: { caseId: "right", step: -1, checks: [], completed: false },
      },
    });
    expect(parseProgress(raw).lessons.notation.step).toBe(3);
    expect(canReadProgress(raw)).toBe(false);
    expect(
      canReadProgress(
        JSON.stringify({
          version: 1,
          lessons: {
            notation: { caseId: "right", step: 3, checks: [], completed: true },
          },
        }),
      ),
    ).toBe(true);
  });
  it("does not revive deleted lessons when a stale native backup arrives", () => {
    const backup = {
      ...emptyProgress(),
      lastLesson: "notation",
      lessons: {
        notation: {
          caseId: "right",
          step: 3,
          checks: [],
          completed: true,
          updatedAt: "2026-11-01T01:00:00.000Z",
        },
      },
    };
    const cleared = { ...emptyProgress(), resetAt: "2026-11-01T01:00:01.000Z" };
    expect(mergeProgress(cleared, backup).lessons).toEqual({});
    expect(mergeProgress(backup, cleared).lessons).toEqual({});
    const restarted = {
      ...cleared,
      lessons: {
        notation: {
          ...backup.lessons.notation,
          step: 0,
          completed: false,
          updatedAt: "2026-11-01T01:00:02.000Z",
        },
      },
    };
    expect(mergeProgress(restarted, backup).lessons.notation.completed).toBe(
      false,
    );
  });
  it("preserves a newer explicit motion setting in either direction", () => {
    const before = {
      ...emptyProgress(),
      reduceMotion: true,
      preferencesUpdatedAt: "2026-11-01T01:00:00.000Z",
    };
    const after = {
      ...emptyProgress(),
      reduceMotion: false,
      preferencesUpdatedAt: "2026-11-01T01:00:01.000Z",
    };
    expect(mergeProgress(after, before).reduceMotion).toBe(false);
    expect(mergeProgress(before, after).reduceMotion).toBe(false);
  });
  it("keeps writes after a reset ordered even if the wall clock moves backwards", () => {
    const future = { ...emptyProgress(), resetAt: "2099-11-01T01:00:00.000Z" };
    expect(nextProgressTimestamp(future)).toBe("2099-11-01T01:00:00.001Z");
    expect(canReadProgress('{"version":2,"lessons":{}}')).toBe(false);
    expect(canReadProgress("{bad")).toBe(false);
  });
});
