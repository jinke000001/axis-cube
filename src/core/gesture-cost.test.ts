import { describe, expect, it } from "vitest";
import { applyAlgorithm, parseAlgorithm, SOLVED } from "./cube";
import { solveCFOP } from "./cfop";
import { estimateGestureCost, explainGestureCost } from "./gesture-cost";

describe("symbolic gesture cost", () => {
  it("has no cost or handling events for an empty candidate", () => {
    expect(explainGestureCost(" ")).toMatchObject({
      score: 0,
      moves: 0,
      quarterTurns: 0,
      regrips: 0,
      reorientations: 0,
      alternations: 0,
      doubleFlicks: 0,
      indexPushes: 0,
      accessMoves: 0,
      steps: [],
    });
  });

  it("assigns neutral U/U' pulls and preserves both double-flick directions", () => {
    expect(explainGestureCost("U").steps[0]).toMatchObject({
      hand: "right",
      technique: "index-pull",
      fingers: ["index"],
    });
    expect(explainGestureCost("U'").steps[0]).toMatchObject({
      hand: "left",
      technique: "index-pull",
      fingers: ["index"],
    });
    expect(explainGestureCost("U2").steps[0]).toMatchObject({
      hand: "right",
      direction: 1,
      fingers: ["index", "middle"],
    });
    expect(explainGestureCost("U2′").steps[0]).toMatchObject({
      notation: "U2'",
      hand: "left",
      direction: -1,
      fingers: ["index", "middle"],
    });
    expect(explainGestureCost("U2 U2'")).toMatchObject({
      moves: 2,
      quarterTurns: 4,
      doubleFlicks: 2,
      alternations: 1,
    });
  });

  it("retains R's wrist through the other hand's U push and returns on R'", () => {
    const result = explainGestureCost("R U R' U'");
    expect(result).toMatchObject({
      moves: 4,
      regrips: 0,
      reorientations: 0,
      alternations: 3,
      indexPushes: 1,
    });
    expect(result.steps[0].after.rightWrist).toBe(1);
    expect(result.steps[1]).toMatchObject({
      hand: "left",
      technique: "index-push",
      before: { rightWrist: 1 },
      after: { rightWrist: 1 },
    });
    expect(result.steps[2].after.rightWrist).toBe(0);
    expect(result.finish.cost).toBe(0);
  });

  it("charges repeated same-direction wrist use instead of a free wrist reset", () => {
    const trigger = explainGestureCost("R U R' U'");
    const repeated = explainGestureCost("R U R U'");
    expect(repeated.moves).toBe(trigger.moves);
    expect(repeated.regrips).toBeGreaterThan(trigger.regrips);
    expect(repeated.score).toBeGreaterThan(trigger.score);
  });

  it("looks ahead rather than always choosing the cheapest isolated U", () => {
    expect(explainGestureCost("U").steps[0].hand).toBe("right");
    const connected = explainGestureCost("U R U' R'");
    expect(connected.steps[0]).toMatchObject({
      hand: "left",
      technique: "index-push",
    });
    expect(connected).toMatchObject({ regrips: 0, alternations: 3 });
  });

  it("distinguishes equal-state U2 routes in the context of the retained R wrist", () => {
    const forward = "R U2 R'",
      reverse = "R U2' R'";
    expect(applyAlgorithm(SOLVED, forward)).toBe(
      applyAlgorithm(SOLVED, reverse),
    );
    const a = explainGestureCost(forward),
      b = explainGestureCost(reverse);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.regrips).toBeGreaterThan(b.regrips);
    expect(b).toMatchObject({ regrips: 0, reorientations: 0, doubleFlicks: 1 });
    expect(b.steps[1]).toMatchObject({
      notation: "U2'",
      hand: "left",
      direction: -1,
    });
  });

  it("mirrors the RU trigger without changing the meaning of L'", () => {
    const right = explainGestureCost("R U R' U'"),
      left = explainGestureCost("L' U' L U");
    expect(left.score).toBe(right.score);
    expect(left).toMatchObject({
      regrips: 0,
      reorientations: 0,
      alternations: 3,
    });
    expect(left.steps[0].after.leftWrist).toBe(-1);
    expect(left.steps[1]).toMatchObject({
      hand: "right",
      technique: "index-push",
    });
    expect(left.steps[2].after.leftWrist).toBe(0);
  });

  it("retains reverse wrist half-turn direction, with a prepared grip and a home finish", () => {
    const result = explainGestureCost("R2'");
    expect(result.steps[0]).toMatchObject({
      notation: "R2'",
      direction: -1,
      after: { rightWrist: -1 },
    });
    expect(result.regrips).toBeGreaterThan(0);
    expect(result.finish.after).toEqual({
      leftWrist: 0,
      rightWrist: 0,
      access: "home",
    });
  });

  it("prices F/D access and conservative B/D2 orientation separately", () => {
    const front = explainGestureCost("F"),
      down = explainGestureCost("D'");
    expect(front).toMatchObject({ reorientations: 0, accessMoves: 1 });
    expect(front.steps[0]).toMatchObject({
      technique: "thumb-turn",
      parts: { access: 30 },
    });
    expect(down).toMatchObject({ reorientations: 0, accessMoves: 1 });
    expect(down.steps[0].technique).toBe("ring-push");
    for (const algorithm of ["B", "D2"]) {
      const result = explainGestureCost(algorithm);
      expect(result.reorientations).toBe(2);
      expect(result.steps[0].technique).toBe("assisted-wrist-turn");
      expect(result.finish.reorientations).toBe(1);
      expect(result.score).toBeGreaterThan(front.score);
    }
  });

  it("shares consecutive rear access, while returning home before a front-facing action", () => {
    expect(explainGestureCost("B B'").reorientations).toBe(2);
    expect(explainGestureCost("B R B' R'").reorientations).toBe(4);
  });

  it("does not optimize away input moves or substitute their execution directions", () => {
    const result = explainGestureCost("(R R') (U2 U2')");
    expect(result.steps.map((step) => step.notation)).toEqual([
      "R",
      "R'",
      "U2",
      "U2'",
    ]);
    expect(result.moves).toBe(4);
    expect(result.score).toBeGreaterThan(0);
    expect(
      applyAlgorithm(
        SOLVED,
        result.steps.map((step) => step.notation).join(" "),
      ),
    ).toBe(SOLVED);
    expect(estimateGestureCost("U2")).toBeLessThan(estimateGestureCost("U U"));
  });

  it("returns a deterministic, auditable breakdown without shared mutable results", () => {
    const algorithm = "R U R' F D' B2 U2' L U' L'";
    const first = explainGestureCost(algorithm),
      second = explainGestureCost(algorithm);
    expect(second).toEqual(first);
    expect(first.score).toBe(
      first.steps.reduce((sum, step) => sum + step.cost, first.finish.cost),
    );
    expect(first.regrips).toBe(
      first.steps.reduce(
        (sum, step) => sum + step.regrips,
        first.finish.regrips,
      ),
    );
    expect(first.reorientations).toBe(
      first.steps.reduce(
        (sum, step) => sum + step.reorientations,
        first.finish.reorientations,
      ),
    );
    expect(first.moves).toBe(parseAlgorithm(algorithm).length);
    for (const step of first.steps) {
      expect(step.cost).toBe(
        Object.values(step.parts).reduce((sum, cost) => sum + cost, 0),
      );
      expect(step.cost).toBeGreaterThan(0);
    }
    first.steps[0].after.rightWrist = 0;
    expect(explainGestureCost(algorithm)).toEqual(second);
  });

  it("rejects malformed notation and unsupported extended moves instead of guessing", () => {
    for (const input of [
      "Q",
      "R3",
      "U2''",
      "(R U",
      "R)",
      "M",
      "Rw",
      "x",
      "r",
    ]) {
      expect(() => estimateGestureCost(input)).toThrow();
    }
    expect(() => estimateGestureCost(null as unknown as string)).toThrow(
      "字符串",
    );
  });

  it("fits the bounded CFOP ranking hook and leaves the verified solution intact", () => {
    const state = applyAlgorithm(SOLVED, "R U F2 D' L B");
    const result = solveCFOP(state, { gestureCost: estimateGestureCost });
    expect(result.candidateCount).toBe(4);
    expect(result.score).toBe(estimateGestureCost(result.solution));
    expect(result.score).toBe(
      Math.min(...result.candidates.map((candidate) => candidate.score)),
    );
    expect(applyAlgorithm(state, result.solution)).toBe(SOLVED);
  });
});
