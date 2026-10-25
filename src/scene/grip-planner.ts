import { Quaternion, Vector3 } from "three";
import { NORMALS, type Move } from "../core/cube";

export type Side = "left" | "right";

export interface GripAssignment {
  move: Move;
  before: Quaternion;
  after: Quaternion;
  active: Side;
  reorient: boolean;
}

export interface GripPlannerOptions {
  /** Restricts whole-cube reorientation, not turns already aligned with a hand. */
  reorientHands?: readonly Side[];
}

export interface GripCost {
  duration: number;
  travel: number;
}

/**
 * Charge the previous turn's remaining recovery plus the current turn's
 * preparation, turn and release. current=null charges the final recovery.
 *
 * This must be a pure Markov cost: previous contributes only its terminal
 * active hand, move and after orientation. Its earlier before/reorient history
 * has already been charged and is not part of the planner's state.
 */
export type GripMeasure = (
  previous: GripAssignment | null,
  current: GripAssignment | null,
) => GripCost;

const SIDES: readonly Side[] = ["left", "right"];
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const EPSILON = 1e-9;

function orientationKey(orientation: Quaternion): string {
  if (Math.abs(orientation.lengthSq() - 1) > 1e-7)
    throw new Error("Grip planning requires a unit cube orientation.");
  const basis = AXES.flatMap((axis) =>
    axis.clone().applyQuaternion(orientation).toArray(),
  );
  if (basis.some((value) => Math.abs(value - Math.round(value)) > 1e-7))
    throw new Error("Grip planning requires one of the 24 cube orientations.");
  // A signed basis also identifies q and -q as the same physical orientation.
  return basis.map(Math.round).join(",");
}

/** Enumerate collision-permitted 0°/90° assignments, without selecting a hand. */
export function gripCandidates(
  move: Move,
  before: Quaternion,
  options: GripPlannerOptions = {},
): GripAssignment[] {
  orientationKey(before);
  const normal = new Vector3(...NORMALS[move.face]).applyQuaternion(before);
  if (Math.abs(normal.x) > 0.5) {
    return [
      {
        move,
        before: before.clone(),
        after: before.clone(),
        active: normal.x < 0 ? "left" : "right",
        reorient: false,
      },
    ];
  }

  return SIDES.filter((side) => {
    if (options.reorientHands && !options.reorientHands.includes(side))
      return false;
    // The L210/R90 base grip keeps every calibrated contact. Mesh sweeps allow
    // left approaches from world +Z/-Y and all four right approaches. Left +Y
    // clips the thumb during receiving; left -Z collides with the support arm.
    // Infeasible routes never enter the shortest-path search.
    return side === "right" || normal.y < -0.5 || normal.z > 0.5;
  }).map((active) => {
    const target = new Vector3(active === "left" ? -1 : 1, 0, 0);
    const delta = new Quaternion().setFromUnitVectors(normal, target);
    return {
      move,
      before: before.clone(),
      after: delta.multiply(before).normalize(),
      active,
      reorient: true,
    };
  });
}

/**
 * Default relative stage durations, matching the motion score before it is
 * fitted to five seconds. No distance is invented: real geometry is supplied
 * through an injected measure when available.
 */
export const defaultGripMeasure: GripMeasure = (previous, current) => {
  if (!current) return { duration: previous ? 0.6 + 0.18 + 1.5 : 0, travel: 0 };
  const carry = previous?.active === current.active && current.reorient;
  let duration = previous && !carry ? 0.6 + 0.18 : 0;
  if (current.reorient)
    duration += (carry ? 0 : 0.32) + 0.7 + 0.3 + 0.13 + 0.8 + 0.16;
  else if (!previous) duration += 0.12;
  if (current.move.turns === 2) duration += 0.12 + 0.55 + 0.12;
  duration += (current.move.turns === 2 ? 2.7 : 2) + 0.14;
  return { duration, travel: 0 };
};

interface Score extends GripCost {
  concentration: number;
}

interface Node {
  assignment: GripAssignment | null;
  parent: Node | null;
  score: Score;
  runLength: number;
}

function addCost(score: Score, cost: GripCost, concentration = 0): Score {
  if (
    !Number.isFinite(cost.duration) ||
    !Number.isFinite(cost.travel) ||
    cost.duration < 0 ||
    cost.travel < 0
  )
    throw new Error(
      "Grip costs must have finite nonnegative duration and travel.",
    );
  return {
    duration: score.duration + cost.duration,
    travel: score.travel + cost.travel,
    concentration: score.concentration + concentration,
  };
}

function better(a: Score, b: Score): boolean {
  if (Math.abs(a.duration - b.duration) > EPSILON)
    return a.duration < b.duration;
  if (a.concentration !== b.concentration)
    return a.concentration < b.concentration;
  if (Math.abs(a.travel - b.travel) > EPSILON) return a.travel < b.travel;
  return false;
}

/**
 * Layered shortest path within the permitted grip/rotation model (1e-9 cost
 * tolerance for numerically equivalent measurements).
 * At each move, its known turn fixes the released wrist pose, so the remaining
 * state is one of 24 cube orientations, the preceding active hand and its
 * current consecutive run length. Duration is primary. Among equal budgets,
 * prefer less concentrated visual participation (sum of squared hand runs),
 * then shorter travel. This is a choreography goal, not motor-load modeling.
 */
export function planGrips(
  moves: Move[],
  options: GripPlannerOptions = {},
  measure: GripMeasure = defaultGripMeasure,
): GripAssignment[] {
  if (!moves.length) return [];
  let frontier: Node[] = [
    {
      assignment: null,
      parent: null,
      score: { duration: 0, travel: 0, concentration: 0 },
      runLength: 0,
    },
  ];

  for (const [index, move] of moves.entries()) {
    const next = new Map<string, Node>();
    for (const node of frontier) {
      const previous = node.assignment;
      const candidates = gripCandidates(
        move,
        previous?.after ?? new Quaternion(),
        options,
      );
      for (const assignment of candidates) {
        const sameHand = previous?.active === assignment.active;
        const runLength = sameHand ? node.runLength + 1 : 1;
        const score = addCost(
          node.score,
          measure(previous, assignment),
          // (r + 1)^2 - r^2 = 2r + 1; a new run starts with 1^2.
          sameHand ? 2 * node.runLength + 1 : 1,
        );
        const key = `${orientationKey(assignment.after)}|${assignment.active}|${runLength}`;
        const existing = next.get(key);
        if (!existing || better(score, existing.score))
          next.set(key, { assignment, parent: node, score, runLength });
      }
    }
    if (!next.size)
      throw new Error(
        `No collision-permitted grip at step ${index + 1} (${move.notation}); ` +
          `allowed reorientation hands: ${(options.reorientHands ?? SIDES).join(", ") || "none"}.`,
      );
    frontier = [...next.values()];
  }

  let best: Node | null = null;
  let bestScore: Score | null = null;
  for (const node of frontier) {
    const score = addCost(node.score, measure(node.assignment, null));
    if (!bestScore || better(score, bestScore)) {
      best = node;
      bestScore = score;
    }
  }
  const assignments: GripAssignment[] = [];
  while (best?.assignment) {
    assignments.push(best.assignment);
    best = best.parent;
  }
  return assignments.reverse();
}
