import { describe, it, expect } from "vitest";
import { ACADEMY_LESSONS, getLessonActivities } from "../learning/academy";
import {
  canReadAcademy,
  mergeAcademyProgress,
  parseAcademyProgress,
  emptyAcademyProgress,
  nextAcademyTimestamp,
  type AcademyProgress,
} from "./academy-progress";
const older = "2026-11-01T01:00:00.000Z",
  newer = "2026-11-01T02:00:00.000Z";
function record(at: string, passed = true): AcademyProgress {
  return {
    version: 1,
    resetAt: "",
    cases: {
      "f2l-foundations/pair": {
        revision: 1,
        answers: {
          identify: { answer: "a", passed, attempts: 1, updatedAt: at },
        },
        physicalChecked: true,
        physicalUpdatedAt: at,
      },
    },
  };
}
describe("new exercise history remains distinct from legacy self reports", () => {
  it("round-trips the real catalogue IDs for all 216 activities", () => {
    const progress = emptyAcademyProgress();
    for (const lesson of ACADEMY_LESSONS)
      for (const example of lesson.cases) {
        const answers = Object.fromEntries(
          getLessonActivities(lesson.id, example.id).map((activity) => [
            activity.id,
            {
              answer: activity.answer,
              passed: true,
              attempts: 2,
              updatedAt: older,
            },
          ]),
        );
        progress.cases[`${lesson.id}/${example.id}`] = {
          revision: 1,
          answers,
          physicalChecked: false,
          physicalUpdatedAt: "",
        };
      }
    const raw = JSON.stringify(progress);
    expect(canReadAcademy(raw)).toBe(true);
    expect(parseAcademyProgress(raw)).toEqual(progress);
    expect(
      Object.values(parseAcademyProgress(raw).cases).flatMap((item) =>
        Object.keys(item.answers),
      ),
    ).toHaveLength(216);
  });
  it("does not interpret legacy completion as passing an activity", () => {
    expect(
      parseAcademyProgress(
        JSON.stringify({ version: 1, lessons: { intro: { completed: true } } }),
      ),
    ).toEqual(emptyAcademyProgress());
  });
  it("honors reset tombstones against a delayed native backup", () => {
    expect(
      mergeAcademyProgress(
        { ...emptyAcademyProgress(), resetAt: newer },
        record(older),
      ).cases,
    ).toEqual({});
  });
  it("merges independent answers and takes a later failed retry over an older pass", () => {
    const local = record(newer, false),
      backup = record(older);
    backup.cases["f2l-foundations/pair"].answers.transfer = {
      answer: "b",
      passed: true,
      attempts: 1,
      updatedAt: older,
    };
    const result = mergeAcademyProgress(local, backup);
    expect(result.cases["f2l-foundations/pair"].answers.identify.passed).toBe(
      false,
    );
    expect(result.cases["f2l-foundations/pair"].answers.transfer.passed).toBe(
      true,
    );
  });
  it("retains an explicit unchecked physical check during merge", () => {
    const local = record(newer);
    local.cases["f2l-foundations/pair"].physicalChecked = false;
    expect(
      mergeAcademyProgress(local, record(older)).cases["f2l-foundations/pair"]
        .physicalChecked,
    ).toBe(false);
  });
  it("ignores unknown exercise revisions, malformed dates and unsafe keys", () => {
    const valid = record(older);
    valid.cases["f2l-foundations/pair"].revision = 999;
    expect(canReadAcademy(JSON.stringify(valid))).toBe(false);
    expect(parseAcademyProgress(JSON.stringify(valid)).cases).toEqual({});
    expect(parseAcademyProgress("{broken")).toEqual(emptyAcademyProgress());
  });
  it("creates a timestamp after all persisted events, even if the local clock moves back", () => {
    const future = record("2099-01-01T00:00:00.000Z");
    expect(nextAcademyTimestamp(future)).toBe("2099-01-01T00:00:00.001Z");
  });
});
