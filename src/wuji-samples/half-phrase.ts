import { Quaternion, Vector3 } from "three";
import { moveAngle } from "../core/cube";
import { getFormula } from "../demonstrator/catalog";
import {
  clonePose,
  fingerContacts,
  fingerLibrary,
  handPose,
  oppositeHand,
  rotatedFingerPose,
} from "../scene/finger-data";
import type { FingerProgram, FingerSegment } from "../scene/finger-program";
import {
  smooth,
  type HandPose,
  type MotionFrame,
  type Side,
} from "../scene/motion";
import type { FingerContact } from "../scene/finger-contact";
import type { PlaybackStep } from "../scene/playback";
import { createTipFlickProgram } from "./tip-flick";
import { createLeftSideFlickProgram } from "./left-side-flick";
import { createCompactU2Program } from "./compact-relay";
import { createThumbSideFlickProgram } from "./thumb-side-flick";
import { rightHalfHandoff as compactHandoff } from "./right-half-handoff";

/** R/U family compiler forked from frozen C8 R2. Compilation is calibration,
 * not playback approval: only the separately verified inventory may expose it. */
export function createHalfPhrase(formulaId: string): FingerProgram {
  const formula = getFormula(formulaId);
  if (!formula) throw new Error(`未知原表公式 ${formulaId}`);
  if (
    formula.steps.some(
      (s) =>
        !["R", "R'", "R2", "R2'", "U", "U'", "U2"].includes(s.move.notation) ||
        (s.hint &&
          (s.move.notation !== "U'" ||
            !(
              (s.hint.hand === "left" && s.hint.finger === "index") ||
              (s.hint.hand === "right" && s.hint.finger === "thumb")
            ))),
    )
  )
    throw new Error("此公式包含本阶段未编排的动作或指法。");
  const low = {
    left: handPose(fingerLibrary.hands.left.support),
    right: handPose(fingerLibrary.hands.right.support),
  };
  const held = { left: clonePose(low.left), right: clonePose(low.right) };
  const contacts: Record<Side, FingerContact[]> = {
    left: fingerContacts("left", fingerLibrary.hands.left.contacts),
    right: fingerContacts("right", fingerLibrary.hands.right.contacts),
  };
  const mode: Record<Side, string> = { left: "low", right: "low" };
  const guidePad = {
    left: new Vector3().fromArray(
      fingerLibrary.hands.left.gripContacts.find((c) => c.finger === 2)!
        .padOffset,
    ),
    right: new Vector3().fromArray(
      fingerLibrary.hands.right.gripContacts.find((c) => c.finger === 2)!
        .padOffset,
    ),
  };
  const guideDigit: Record<Side, 1 | 2> = { left: 2, right: 2 };
  const guideNormal = {
    left: new Vector3(-1, 0, 0),
    right: new Vector3(1, 0, 0),
  };
  const segments: FingerSegment[] = [],
    steps: PlaybackStep[] = [];
  let time = 0,
    index = 0,
    wristAngle = 0,
    regrips = 0;
  function add(
    duration: number,
    stage: string,
    phase: string,
    active: Side | null,
    sample: FingerSegment["sample"],
    finger?: 1 | 2 | 3,
  ) {
    segments.push({
      index,
      start: time,
      duration,
      stage,
      phase,
      active,
      finger,
      sample,
    });
    time += duration;
    const end = sample(1);
    held.left = clonePose(end.left);
    held.right = clonePose(end.right);
  }
  function transfer(
    side: Side,
    target: HandPose,
    phase: string,
    targetPad = new Vector3().fromArray(
      fingerLibrary.hands[side].gripContacts.find((c) => c.finger === 2)!
        .padOffset,
    ),
    targetNormal = new Vector3(side === "right" ? 1 : -1, 0, 0),
    targetDigit: 1 | 2 = 2,
  ) {
    const other = oppositeHand(side),
      fixed = clonePose(held[other]),
      support = contacts[other].slice();
    if (support.length < 3) throw new Error("换握前另一手必须已经接稳。");
    const parts = compactHandoff(
      side,
      clonePose(held[side]),
      target,
      guidePad[side],
      targetPad,
      guideNormal[side],
      targetNormal,
      guideDigit[side] === 1 || targetDigit === 1 ? 1 : undefined,
    );
    for (const part of parts)
      add(part.duration, "TRANSFER", part.phase + " · " + phase, side, (p) => ({
        left: side === "left" ? part.sample(p) : clonePose(fixed),
        right: side === "right" ? part.sample(p) : clonePose(fixed),
        contacts: support,
        angle: 0,
      }));
    contacts[side] = [];
    guideDigit[side] = targetDigit;
    guidePad[side] = targetPad.clone();
    guideNormal[side] = targetNormal.clone();
    if (parts.length) regrips++;
  }
  function home(side: Side) {
    if (mode[side] === "low") return;
    transfer(side, low[side], `${side === "left" ? "左" : "右"}手回接稳持`);
    contacts[side] = fingerContacts(side, fingerLibrary.hands[side].contacts);
    mode[side] = "low";
  }
  for (index = 0; index < formula.steps.length; index++) {
    const step = formula.steps[index],
      move = step.move,
      start = time;
    if (move.face === "U") {
      const thumb = step.hint?.hand === "right" && step.hint.finger === "thumb",
        active: Side = thumb ? "right" : move.turns === 3 ? "left" : "right",
        other = oppositeHand(active),
        program = thumb
          ? createThumbSideFlickProgram()
          : move.turns === 2
            ? createCompactU2Program()
            : active === "right"
              ? createTipFlickProgram()
              : createLeftSideFlickProgram();
      home(other);
      const turns = program.segments.filter((s) => s.stage === "TURN"),
        indexTurns = turns.filter((s) => s.finger === 2);
      const firstDrive = turns[0]
          .sample(0)
          .contacts.find((c) => c.role === "drive")!,
        lastDrive = (indexTurns.at(-1) ?? turns.at(-1))!
          .sample(1)
          .contacts.find((c) => c.role === "drive")!;
      const entryPad = firstDrive.padOffset;
      transfer(
        active,
        program.sample(0)[active],
        `${other === "left" ? "左" : "右"}手接稳 · ${active === "left" ? "左" : "右"}指准备侧拨`,
        entryPad,
        firstDrive.normal,
        thumb ? 1 : 2,
      );
      for (const s of program.segments.filter((s) => s.stage !== "HOLD"))
        add(
          s.duration,
          s.stage,
          s.phase,
          active,
          (p) => s.sample(p),
          s.finger as 1 | 2 | 3,
        );
      guidePad[active] = lastDrive.padOffset.clone();
      guideDigit[active] = thumb ? 1 : 2;
      guideNormal[active] = new Vector3(active === "right" ? 1 : -1, 0, 0);
      contacts[active] = [];
      mode[active] = "side";
    } else {
      home("left");
      if (mode.right !== "wrist" || move.turns===2) {
        wristAngle = move.turns===2 ? (move.direction===-1?-Math.PI/2:Math.PI/2) : move.turns === 1 ? 0 : -Math.PI / 2;
        transfer(
          "right",
          rotatedFingerPose(
            handPose(fingerLibrary.hands.right.grip),
            new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), wristAngle),
          ),
          "左手接稳 · 右手接回右层",
        );
      }
      const before = wristAngle,
        after = before + moveAngle(move),
        grip = handPose(fingerLibrary.hands.right.grip),
        fixed = clonePose(held.left),
        support = contacts.left.slice();
      const drive = fingerContacts(
        "right",
        fingerLibrary.hands.right.gripContacts,
        "drive",
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), before),
      );
      add(0.3, "CONTACT", "右手接稳右层", "right", () => ({
        left: clonePose(fixed),
        right: rotatedFingerPose(
          grip,
          new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), before),
        ),
        angle: 0,
        contacts: [...support, ...drive],
      }));
      add(
        move.turns===2?2.6:1.65,
        "TURN",
        `右腕转层 · ${move.notation.replace("'", "′")}`,
        "right",
        (p) => ({
          left: clonePose(fixed),
          right: rotatedFingerPose(
            grip,
            new Quaternion().setFromAxisAngle(
              new Vector3(1, 0, 0),
              before + (after - before) * smooth(p),
            ),
          ),
          angle: moveAngle(move) * smooth(p),
          contacts: [...support, ...drive],
        }),
      );
      wristAngle = after;
      mode.right = "wrist";
      contacts.right = fingerContacts(
        "right",
        fingerLibrary.hands.right.gripContacts,
        "support",
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), after),
      );
    }
    steps.push({
      move,
      start,
      duration: time - start,
      active:
        step.hint?.finger === "thumb"
          ? "right"
          : move.face === "U" && move.turns === 3
            ? "left"
            : "right",
    });
  }
  index = formula.steps.length - 1;
  const final = { left: clonePose(held.left), right: clonePose(held.right) },
    finalContacts = [...contacts.left, ...contacts.right];
  add(0.6, "HOLD", "整式完成 · 稳持", null, () => ({
    ...final,
    left: clonePose(final.left),
    right: clonePose(final.right),
    angle: moveAngle(formula.steps.at(-1)!.move),
    contacts: finalContacts,
  }));
  steps.at(-1)!.duration += 0.6;
  const duration = time;
  function sample(t: number): MotionFrame {
    const complete = t >= duration,
      s = segments.find((s) => t < s.start + s.duration) ?? segments.at(-1)!,
      progress = Math.max(0, Math.min(1, (t - s.start) / s.duration)),
      f = s.sample(progress);
    return {
      ...f,
      index: complete ? steps.length : s.index,
      complete,
      angle: complete ? 0 : f.angle,
      orientation: new Quaternion(),
      phase: s.phase,
      stage: s.stage,
      active: complete ? null : s.active,
      support: s.active ? oppositeHand(s.active) : "left",
      activeFinger: s.finger,
      progress,
    };
  }
  return {
    duration,
    cost: duration,
    steps,
    segments,
    sample,
    statistics: {
      fingerTurns: formula.steps
        .filter((s) => s.move.face === "U")
        .reduce((n, s) => n + (s.move.turns === 2 ? 2 : 1), 0),
      wristTurns: formula.steps.filter((s) => s.move.face === "R").length,
      regrips,
      retainedWrists: 0,
      reorientations: 0,
    },
  };
}
