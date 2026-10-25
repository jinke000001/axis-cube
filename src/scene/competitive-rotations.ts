import type { Move } from "../core/cube";
import type { Side } from "./motion";
import { compileRecordedFingerMove, type RecordedFingerFrame, type RecordedFingerPrimitive } from "./recorded-finger-program";
import raw from "./competitive-rotations.json";

interface RotationSegment { id: string; frames: (RecordedFingerFrame & { turning: boolean })[]; }
const data = raw as unknown as { primitives: Record<string, RotationSegment[]> };
const primitives = new Map<string, RecordedFingerPrimitive>();
for (const [notation, segments] of Object.entries(data.primitives)) {
  primitives.set(notation, { notation, rotationContactsInEntryFrame: true,
    segments: segments.map((segment) => {
      const turning = segment.frames.some((frame) => frame.turning);
      const active: Side = turning ? notation === "y" ? "left" : "right" : segment.id.startsWith("right") ? "right" : "left";
      return { ...segment, active, stage: turning ? "TURN" : "PREPARE",
        phase: turning ? "持握换面 · 对手预备接应" : `${active === "left" ? "左" : "右"}手顺势接握`,
      };
    }),
  });
}
export function compileCompetitiveRotation(move: Move, duration = 5) {
  const primitive = move.kind === "rotation" && primitives.get(move.notation);
  if (!primitive) throw new Error(`转体 ${move.notation} 尚未校准。`);
  return compileRecordedFingerMove(move, primitive, duration);
}
