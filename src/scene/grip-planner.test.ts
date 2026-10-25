import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { FACES, NORMALS, parseAlgorithm, type Move } from "../core/cube";
import {
  defaultGripMeasure,
  gripCandidates,
  planGrips,
  type GripAssignment,
  type GripMeasure,
  type GripPlannerOptions,
} from "./grip-planner";

function enumerate(moves: Move[], options: GripPlannerOptions = {}) {
  let paths: GripAssignment[][] = [[]];
  for (const move of moves)
    paths = paths.flatMap((path) =>
      gripCandidates(move, path.at(-1)?.after ?? new Quaternion(), options).map(
        (assignment) => [...path, assignment],
      ),
    );
  return paths;
}

function score(path: GripAssignment[], measure: GripMeasure) {
  let duration = 0,
    travel = 0;
  for (let i = 0; i <= path.length; i++) {
    const previous = path[i - 1] ?? null,
      current = path[i] ?? null,
      cost = measure(previous, current);
    duration += cost.duration;
    travel += cost.travel;
  }
  // Independently group complete runs instead of using the planner's
  // incremental 2r+1 formula.
  const runs: number[] = [];
  for (const [index, assignment] of path.entries()) {
    if (index > 0 && path[index - 1].active === assignment.active)
      runs[runs.length - 1]++;
    else runs.push(1);
  }
  const concentration = runs.reduce((sum, length) => sum + length * length, 0);
  return { duration, concentration, travel };
}

function compare(a: ReturnType<typeof score>, b: ReturnType<typeof score>) {
  if (Math.abs(a.duration - b.duration) > 1e-9) return a.duration - b.duration;
  if (a.concentration !== b.concentration)
    return a.concentration - b.concentration;
  if (Math.abs(a.travel - b.travel) > 1e-9) return a.travel - b.travel;
  return 0;
}

function allOrientations() {
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ];
  const orientations = [new Quaternion()];
  for (let i = 0; i < orientations.length; i++)
    for (const axis of axes) {
      const candidate = new Quaternion()
        .setFromAxisAngle(axis, Math.PI / 2)
        .multiply(orientations[i]);
      if (!orientations.some((q) => q.angleTo(candidate) < 1e-7))
        orientations.push(candidate);
    }
  return orientations;
}

describe("collision-permitted grip candidates", () => {
  it("covers all cube orientations and aligns each chosen face with its hand", () => {
    const orientations = allOrientations();
    expect(orientations).toHaveLength(24);
    for (const before of orientations)
      for (const face of FACES) {
        const move = parseAlgorithm(face)[0];
        const normal = new Vector3(...NORMALS[face]).applyQuaternion(before);
        const candidates = gripCandidates(move, before);
        expect(candidates.length).toBeGreaterThan(0);
        for (const assignment of candidates) {
          const target = new Vector3(
            assignment.active === "left" ? -1 : 1,
            0,
            0,
          );
          expect(
            new Vector3(...NORMALS[face])
              .applyQuaternion(assignment.after)
              .distanceTo(target),
          ).toBeLessThan(1e-7);
          expect(assignment.before.angleTo(before)).toBeLessThan(1e-7);
          expect(assignment.before.angleTo(assignment.after)).toBeCloseTo(
            assignment.reorient ? Math.PI / 2 : 0,
            7,
          );
          if (assignment.reorient && assignment.active === "left")
            expect(normal.y < -0.5 || normal.z > 0.5).toBe(true);
        }
        const expectedHands =
          Math.abs(normal.x) > 0.5
            ? [normal.x < 0 ? "left" : "right"]
            : normal.y < -0.5 || normal.z > 0.5
              ? ["left", "right"]
              : ["right"];
        expect(candidates.map((candidate) => candidate.active)).toEqual(
          expectedHands,
        );
      }
  });

  it("uses world direction, not the face letter, for asymmetric clearance", () => {
    const flipped = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI,
    );
    expect(
      gripCandidates(parseAlgorithm("D")[0], flipped).map((c) => c.active),
    ).toEqual(["right"]);
    expect(
      gripCandidates(parseAlgorithm("U")[0], flipped).map((c) => c.active),
    ).toEqual(["left", "right"]);
  });

  it("applies hand restrictions only to reorientations and never falls back silently", () => {
    expect(
      planGrips(parseAlgorithm("L"), { reorientHands: ["right"] })[0].active,
    ).toBe("left");
    expect(
      planGrips(parseAlgorithm("R L R2"), { reorientHands: [] }),
    ).toHaveLength(3);
    expect(
      planGrips(parseAlgorithm("U"), { reorientHands: ["right"] })[0].active,
    ).toBe("right");
    expect(() =>
      planGrips(parseAlgorithm("U"), { reorientHands: ["left"] }),
    ).toThrow(/step 1 \(U\).*left/);
    expect(() => planGrips(parseAlgorithm("U"), { reorientHands: [] })).toThrow(
      /step 1 \(U\).*none/,
    );
    expect(
      planGrips(parseAlgorithm("D U"), { reorientHands: ["left"] }).map(
        (s) => s.active,
      ),
    ).toEqual(["left", "right"]);
  });

  it("rejects orientations outside the discrete planning model without mutating input", () => {
    const move = parseAlgorithm("D")[0];
    expect(() =>
      gripCandidates(
        move,
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3),
      ),
    ).toThrow(/24 cube orientations/);
    expect(() => gripCandidates(move, new Quaternion(0, 0, 0, 2))).toThrow(
      /unit/,
    );
    const before = new Quaternion();
    const snapshot = before.toArray();
    const candidates = gripCandidates(move, before);
    expect(before.toArray()).toEqual(snapshot);
    candidates[0].before.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    expect(before.toArray()).toEqual(snapshot);
    expect(candidates[1].before.toArray()).toEqual(snapshot);
  });
});

describe("whole-sequence grip optimization", () => {
  it("matches exhaustive search on every face triple and longer mixed-turn sequences", () => {
    const algorithms = FACES.flatMap((a) =>
      FACES.flatMap((b) => FACES.map((c) => `${a} ${b} ${c}`)),
    );
    algorithms.push(
      "U2 D' F' U R' B' R2 L",
      "U R U' R' F2 B2 L D",
      "F2 L2 B' D2 R U' L2 U",
    );
    const geometricMeasure: GripMeasure = (previous, current) => {
      const base = defaultGripMeasure(previous, current);
      return {
        duration: base.duration,
        travel:
          (current?.reorient ? current.before.angleTo(current.after) : 0) +
          (previous && current && previous.active !== current.active
            ? 0.07
            : 0) +
          (current?.active === "left" ? 0.013 : 0.017),
      };
    };
    for (const measure of [defaultGripMeasure, geometricMeasure])
      for (const algorithm of algorithms) {
        const moves = parseAlgorithm(algorithm);
        const exhaustive = enumerate(moves)
          .map((path) => score(path, measure))
          .sort(compare)[0];
        const actual = score(planGrips(moves, {}, measure), measure);
        expect(actual.duration, algorithm).toBeCloseTo(exhaustive.duration, 8);
        expect(actual.travel, algorithm).toBeCloseTo(exhaustive.travel, 8);
        expect(actual.concentration, algorithm).toBe(exhaustive.concentration);
      }
  });

  it("can choose a locally dearer hand to make the complete sequence cheaper", () => {
    const moves = parseAlgorithm("D R");
    const measure: GripMeasure = (previous, current) => ({
      duration: !current
        ? 0
        : previous
          ? previous.active === "right"
            ? 10
            : 0
          : current.active === "right"
            ? 1
            : 2,
      travel: 0,
    });
    const firstCandidates = gripCandidates(moves[0], new Quaternion());
    expect(firstCandidates.map((candidate) => candidate.active)).toEqual([
      "left",
      "right",
    ]);
    const greedyFirst = firstCandidates.sort(
      (a, b) => measure(null, a).duration - measure(null, b).duration,
    )[0];
    const greedySecond = gripCandidates(moves[1], greedyFirst.after)[0];
    expect(score([greedyFirst, greedySecond], measure).duration).toBe(11);
    const optimal = planGrips(moves, {}, measure);
    expect(optimal.map((s) => s.active)).toEqual(["left", "right"]);
    expect(score(optimal, measure).duration).toBe(2);
  });

  it("charges the final recovery when choosing the path", () => {
    const measure: GripMeasure = (previous, current) => ({
      duration: current ? 1 : previous?.active === "left" ? 10 : 0,
      travel: 0,
    });
    const moves = parseAlgorithm("D");
    expect(gripCandidates(moves[0], new Quaternion())).toHaveLength(2);
    expect(planGrips(moves, {}, measure)[0].active).toBe("right");
  });

  it("orders duration, then hand-run concentration, then travel", () => {
    const moves = parseAlgorithm("D");
    expect(gripCandidates(moves[0], new Quaternion())).toHaveLength(2);
    expect(
      planGrips(moves, {}, (_previous, current) => ({
        duration: current ? (current.active === "left" ? 2 : 1) : 0,
        travel: current?.active === "right" ? 100 : 0,
      }))[0].active,
    ).toBe("right");
    expect(
      planGrips(moves, {}, (_previous, current) => ({
        duration: current ? 1 : 0,
        travel: current?.active === "left" ? 1 : 2,
      }))[0].active,
    ).toBe("left");
    const cheaperSameHand = planGrips(
      parseAlgorithm("D R"),
      {},
      (_previous, current) => ({
        duration: !current
          ? 0
          : current.move.face === "D" && current.active === "left"
            ? 2
            : 1,
        travel: 0,
      }),
    );
    // Saving real stage budget outranks spreading the two turns across hands.
    expect(cheaperSameHand.map((s) => s.active)).toEqual(["right", "right"]);
    expect(
      planGrips(parseAlgorithm("D R"), {}, (_previous, current) => ({
        duration: 0,
        // The lower-concentration route deliberately travels farther.
        travel: current?.active === "left" ? 100 : 0,
      })).map((s) => s.active),
    ).toEqual(["left", "right"]);
  });

  it("keeps run length in the state so a locally better prefix cannot hide the best sharing", () => {
    const moves = parseAlgorithm("L D F B U L U R R B");
    const measure: GripMeasure = (_previous, current) => ({
      duration: current ? 1 : 0,
      travel: 0,
    });
    const all = enumerate(moves);
    const exhaustive = all.map((path) => score(path, measure)).sort(compare)[0];
    const result = score(planGrips(moves, {}, measure), measure);
    expect(result).toEqual(exhaustive);
    expect(result.duration).toBe(10);
    expect(result.concentration).toBe(16);
    // Merging only by orientation + hand can retain this prefix and finish at
    // 18, because a later third consecutive turn costs more than a second.
    const longRun = all.find(
      (path) => path.map((step) => step.active[0]).join("") === "lrlrrlrrrl",
    );
    expect(longRun).toBeDefined();
    expect(score(longRun!, measure).concentration).toBe(18);
  });

  it("makes default costs independently summable including terminal recovery", () => {
    const plan = planGrips(parseAlgorithm("R2"));
    // Initial preparation + half-turn windup + turn + release + final return/hold.
    const expected =
      0.12 + (0.12 + 0.55 + 0.12) + 2.7 + 0.14 + 0.6 + 0.18 + 1.5;
    expect(score(plan, defaultGripMeasure).duration).toBeCloseTo(expected, 12);
    const pair = planGrips(parseAlgorithm("U F"), { reorientHands: ["right"] });
    const separately = defaultGripMeasure(null, pair[1]).duration;
    // A same-hand reorientation carries the release: no CLEAR and no prior recovery.
    expect(defaultGripMeasure(pair[0], pair[1]).duration).toBeCloseTo(
      separately - 0.32,
      12,
    );
  });

  it("is deterministic, continuous in orientation, and does not mutate moves", () => {
    const moves = parseAlgorithm(
      "U2 D' F' U R' B' R2 L D R F2 U2 R2 D L2 U B2 U' R2 D2 B2",
    );
    const original = JSON.stringify(moves);
    const serialize = (path: GripAssignment[]) =>
      path.map((step) => ({
        move: step.move,
        before: step.before.toArray(),
        after: step.after.toArray(),
        active: step.active,
        reorient: step.reorient,
      }));
    const first = planGrips(moves);
    expect(serialize(planGrips(moves))).toEqual(serialize(first));
    expect(JSON.stringify(moves)).toBe(original);
    expect(first).toHaveLength(moves.length);
    for (let i = 1; i < first.length; i++)
      expect(first[i].before.angleTo(first[i - 1].after)).toBeLessThan(1e-7);
    expect(new Set(first.map((step) => step.active)).size).toBe(2);
  });

  it("handles an empty solution without evaluating artificial steps", () => {
    let calls = 0;
    expect(
      planGrips([], {}, () => {
        calls++;
        return { duration: 0, travel: 0 };
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects invalid measurements instead of silently selecting a path", () => {
    for (const value of [NaN, Infinity, -1]) {
      expect(() =>
        planGrips(parseAlgorithm("U"), {}, () => ({
          duration: value,
          travel: 0,
        })),
      ).toThrow(/finite nonnegative/);
      expect(() =>
        planGrips(parseAlgorithm("U"), {}, () => ({
          duration: 0,
          travel: value,
        })),
      ).toThrow(/finite nonnegative/);
    }
  });
});
