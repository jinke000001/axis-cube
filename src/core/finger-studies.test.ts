import { describe, expect, it } from "vitest";
import { FINGER_STUDIES, studySession } from "./finger-studies";
import { applyAlgorithm, parseAlgorithm, SOLVED } from "./cube";
import { readSession } from "./session";

describe("finger study fixtures", () => {
  it("keeps eight independent, legal, actually solvable phrases", () => {
    expect(FINGER_STUDIES).toHaveLength(8);
    expect(new Set(FINGER_STUDIES.map((study) => study.id)).size).toBe(8);
    for (const study of FINGER_STUDIES) {
      const session = studySession(study);
      expect(readSession(session)).toEqual(session);
      expect(applyAlgorithm(session.facelets, session.solution)).toBe(SOLVED);
    }
  });
  it("preserves the two double-flick directions with the same starting state", () => {
    const right = studySession(FINGER_STUDIES[2]), left = studySession(FINGER_STUDIES[3]);
    expect(right.facelets).toBe(left.facelets);
    expect(parseAlgorithm(right.solution)[0].direction).not.toBe(parseAlgorithm(left.solution)[0].direction);
  });
});
