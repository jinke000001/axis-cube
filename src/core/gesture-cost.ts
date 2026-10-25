import { parseAlgorithm, type Face, type Move } from "./cube";

type Hand = "left" | "right";
type Wrist = -1 | 0 | 1;
type Access = "home" | "back" | "bottom";
type Technique =
  | "index-pull"
  | "index-push"
  | "double-flick"
  | "wrist-turn"
  | "thumb-turn"
  | "ring-push"
  | "assisted-wrist-turn";

export interface GestureGrip {
  /** Symbolic quarter-turn offsets, not Wuji joint angles. */
  leftWrist: Wrist;
  rightWrist: Wrist;
  /** A temporary access pose; original algorithm face names never change. */
  access: Access;
}

export interface GestureCostParts {
  turn: number;
  access: number;
  regrip: number;
  reorientation: number;
  coordination: number;
}

export interface GestureCostStep {
  index: number;
  notation: string;
  face: Face;
  direction: 1 | -1;
  hand: Hand;
  technique: Technique;
  fingers: readonly ("index" | "middle" | "thumb" | "ring")[];
  before: GestureGrip;
  after: GestureGrip;
  cost: number;
  parts: GestureCostParts;
  regrips: number;
  reorientations: number;
  alternations: number;
}

export interface GestureCostExplanation {
  model: "symbolic-grip-v1";
  /** Dimensionless ranking points. These are neither milliseconds nor feasibility. */
  score: number;
  /** Expanded input tokens (HTM); no cancellation or algorithm rewriting. */
  moves: number;
  quarterTurns: number;
  /** Extra single-hand repositionings; excludes handoffs inside a reorientation. */
  regrips: number;
  /** Entering/leaving a back/bottom access pose, including the return home. */
  reorientations: number;
  /** Changes of driving hand between uninterrupted turns; an access change resets it. */
  alternations: number;
  doubleFlicks: number;
  indexPushes: number;
  accessMoves: number;
  steps: GestureCostStep[];
  /** All candidates are compared with neutral wrists and front/up restored at the end. */
  finish: {
    before: GestureGrip;
    after: GestureGrip;
    cost: number;
    parts: GestureCostParts;
    regrips: number;
    reorientations: number;
  };
}

interface State extends GestureGrip {
  lastHand: Hand | null;
}
interface Node {
  state: State;
  score: number;
  regrips: number;
  reorientations: number;
  previous?: Node;
  step?: GestureCostStep;
}

const NEUTRAL: GestureGrip = { leftWrist: 0, rightWrist: 0, access: "home" };
const WRISTS: readonly Wrist[] = [-1, 0, 1];
const opposite = (hand: Hand): Hand => (hand === "left" ? "right" : "left");
const wristKey = (hand: Hand) => (hand === "left" ? "leftWrist" : "rightWrist");
const grip = ({ leftWrist, rightWrist, access }: GestureGrip): GestureGrip => ({
  leftWrist,
  rightWrist,
  access,
});
const emptyParts = (): GestureCostParts => ({
  turn: 0,
  access: 0,
  regrip: 0,
  reorientation: 0,
  coordination: 0,
});
const sum = (parts: GestureCostParts) =>
  Object.values(parts).reduce((a, b) => a + b, 0);
const key = (state: State) =>
  `${state.access}/${state.leftWrist}/${state.rightWrist}/${state.lastHand}`;
const directionOf = (move: Move): 1 | -1 =>
  move.turns === 3 || (move.turns === 2 && move.direction === -1) ? -1 : 1;

// Explicit policy weights, not measured human or mechanical timings. The finite
// vocabulary mirrors the project's candidate gestures; geometry must filter real
// paths separately. Holding a turned wrist lets the other hand push U, and lets
// the inverse R/L return without a gratuitous reset. A second same-direction
// wrist turn requires a release/reposition unless it was prepared earlier.
const REORIENT = 260;
const regripCost = (from: Wrist, to: Wrist) => 110 + 25 * Math.abs(to - from);

function accessPose(state: State, access: Access) {
  const changed = state.access !== access;
  // Back <-> bottom is represented by two access changes via home. This is
  // intentionally conservative, not an unverified shortcut rotation.
  const reorientations = changed
    ? Number(state.access !== "home") + Number(access !== "home")
    : 0;
  return {
    state: changed
      ? ({ ...NEUTRAL, access, lastHand: null } as State)
      : { ...state },
    reorientations,
  };
}

function options(node: Node, move: Move, index: number): GestureCostStep[] {
  const result: GestureCostStep[] = [];
  const direction = directionOf(move);
  const amount = (move.turns === 2 ? 2 : 1) * direction;

  function emit(
    access: Access,
    hand: Hand,
    technique: Technique,
    fingers: GestureCostStep["fingers"],
    turn: number,
    accessCost: number,
    start: Wrist,
    end: Wrist,
  ) {
    const prepared = accessPose(node.state, access);
    const state = prepared.state;
    const wrist = wristKey(hand);
    const regrips = Number(state[wrist] !== start);
    const alternations = Number(
      state.lastHand !== null && state.lastHand !== hand,
    );
    const parts: GestureCostParts = {
      turn,
      access: accessCost,
      regrip: regrips ? regripCost(state[wrist], start) : 0,
      reorientation: prepared.reorientations * REORIENT,
      // Same-hand preparation cannot all overlap; changing hands has no penalty.
      coordination: state.lastHand === hand ? 24 : 0,
    };
    state[wrist] = end;
    result.push({
      index,
      notation: move.notation,
      face: move.face,
      direction,
      hand,
      technique,
      fingers,
      before: grip(node.state),
      after: grip(state),
      cost: sum(parts),
      parts,
      regrips,
      reorientations: prepared.reorientations,
      alternations,
    });
  }

  function wristOptions(access: Access, hand: Hand, assisted = false) {
    for (const start of WRISTS) {
      const end = start + amount;
      if (end < -1 || end > 1) continue;
      emit(
        access,
        hand,
        assisted ? "assisted-wrist-turn" : "wrist-turn",
        [],
        move.turns === 2 ? 185 : 120,
        assisted ? 45 : 0,
        start,
        end as Wrist,
      );
    }
  }

  if (move.face === "U") {
    const natural: Hand = direction === 1 ? "right" : "left";
    if (move.turns === 2) {
      // Do not silently substitute U2' for U2: equal states have different paths.
      emit("home", natural, "double-flick", ["index", "middle"], 170, 0, 0, 0);
    } else {
      emit("home", natural, "index-pull", ["index"], 100, 0, 0, 0);
      emit("home", opposite(natural), "index-push", ["index"], 116, 0, 0, 0);
    }
  } else if (move.face === "R" || move.face === "L") {
    wristOptions("home", move.face === "R" ? "right" : "left");
  } else if (move.face === "F") {
    // A front thumb route is preferred to whole-cube access in this vocabulary.
    const natural: Hand = direction === 1 ? "right" : "left";
    emit(
      "home",
      natural,
      "thumb-turn",
      ["thumb"],
      move.turns === 2 ? 235 : 140,
      30,
      0,
      0,
    );
    emit(
      "home",
      opposite(natural),
      "thumb-turn",
      ["thumb"],
      move.turns === 2 ? 255 : 156,
      30,
      0,
      0,
    );
  } else if (move.face === "D") {
    if (move.turns !== 2) {
      emit(
        "home",
        direction === 1 ? "left" : "right",
        "ring-push",
        ["ring"],
        160,
        45,
        0,
        0,
      );
    }
    // No uncalibrated double-ring flick is assumed for D2. Bottom access is a
    // costly conservative alternative, also available when D's grip is awkward.
    // Each access pose exposes this logical face to the right wrist proxy. A
    // left-hand access alternative needs its own pose; do not switch for free.
    wristOptions("bottom", "right", true);
  } else {
    // The front-facing vocabulary does not claim a validated blind B finger trick.
    wristOptions("back", "right", true);
  }
  return result;
}

function finishAtHome(state: State): GestureCostExplanation["finish"] {
  const prepared = accessPose(state, "home");
  const parts = emptyParts();
  const regrips =
    Number(prepared.state.leftWrist !== 0) +
    Number(prepared.state.rightWrist !== 0);
  parts.reorientation = prepared.reorientations * REORIENT;
  for (const hand of ["left", "right"] as const) {
    const wrist = prepared.state[wristKey(hand)];
    if (wrist !== 0) parts.regrip += regripCost(wrist, 0);
  }
  return {
    before: grip(state),
    after: { ...NEUTRAL },
    cost: sum(parts),
    parts,
    regrips,
    reorientations: prepared.reorientations,
  };
}

/**
 * Rank a verified six-face candidate without altering its moves or cube state.
 * Dynamic programming carries grip state across the entire candidate, so a
 * locally cheap finger choice need not win if it leaves a costly later grip.
 * This is a bounded symbolic vocabulary, not a global/hardware optimum or a
 * collision/contact check. The caller must use only actually choreographable
 * candidates; none of these explanation steps should drive joint animation.
 * Wide/slice/whole rotations are deliberately rejected until given a cost model.
 */
export function explainGestureCost(algorithm: string): GestureCostExplanation {
  if (typeof algorithm !== "string")
    throw new TypeError("手法成本需要公式字符串。");
  const moves = parseAlgorithm(algorithm);
  if (moves.some((move) => move.kind))
    throw new Error("手法成本目前仅支持六面外层候选解法。");
  let frontier = new Map<string, Node>();
  const initial: Node = {
    state: { ...NEUTRAL, lastHand: null },
    score: 0,
    regrips: 0,
    reorientations: 0,
  };
  frontier.set(key(initial.state), initial);
  moves.forEach((move, index) => {
    const next = new Map<string, Node>();
    for (const previous of frontier.values()) {
      for (const step of options(previous, move, index)) {
        const state: State = { ...step.after, lastHand: step.hand };
        const node: Node = {
          state,
          score: previous.score + step.cost,
          regrips: previous.regrips + step.regrips,
          reorientations: previous.reorientations + step.reorientations,
          previous,
          step,
        };
        const existing = next.get(key(state));
        // Stable iteration is the final tie-break, with fewer handling events first.
        if (
          !existing ||
          node.score < existing.score ||
          (node.score === existing.score &&
            (node.reorientations < existing.reorientations ||
              (node.reorientations === existing.reorientations &&
                node.regrips < existing.regrips)))
        ) {
          next.set(key(state), node);
        }
      }
    }
    frontier = next;
  });
  const ranked = [...frontier.values()].map((node) => ({
    node,
    finish: finishAtHome(node.state),
  }));
  ranked.sort(
    (a, b) =>
      a.node.score + a.finish.cost - b.node.score - b.finish.cost ||
      a.node.reorientations +
        a.finish.reorientations -
        b.node.reorientations -
        b.finish.reorientations ||
      a.node.regrips + a.finish.regrips - b.node.regrips - b.finish.regrips,
  );
  const best = ranked[0];
  const steps: GestureCostStep[] = [];
  for (let node = best.node; node.step; node = node.previous!)
    steps.push(node.step);
  steps.reverse();
  return {
    model: "symbolic-grip-v1",
    score: best.node.score + best.finish.cost,
    moves: moves.length,
    quarterTurns: moves.reduce(
      (total, move) => total + (move.turns === 2 ? 2 : 1),
      0,
    ),
    regrips: best.node.regrips + best.finish.regrips,
    reorientations: best.node.reorientations + best.finish.reorientations,
    alternations: steps.reduce((total, step) => total + step.alternations, 0),
    doubleFlicks: steps.filter((step) => step.technique === "double-flick")
      .length,
    indexPushes: steps.filter((step) => step.technique === "index-push").length,
    accessMoves: moves.filter(
      (move) => move.face === "F" || move.face === "B" || move.face === "D",
    ).length,
    steps,
    finish: best.finish,
  };
}

/** Adapter for solveCFOP({ gestureCost }); see explainGestureCost for its limits. */
export function estimateGestureCost(algorithm: string): number {
  return explainGestureCost(algorithm).score;
}
