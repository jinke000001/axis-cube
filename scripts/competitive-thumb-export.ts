/** Export the accepted thumb poses without resampling or changing geometry. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Quaternion, Vector3 } from "three";
import { parseMove, moveAngle } from "../src/core/cube";
import { hasMeasuredSupport, measureContact, type FingerContact } from "../src/scene/finger-contact";
import type { Side } from "../src/scene/motion";

const files = ["evidence/competitive-thumb-entry-release0.008-x0.03-y-0.02-follow0.1-roll0-64.json", "evidence/competitive-thumb-reverse-64.json"];
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const library = JSON.parse(readFileSync("src/scene/finger-library.json", "utf8"));
const sides: Side[] = ["left", "right"], Z = new Vector3(0, 0, 1);
const pose = (p: any) => ({ position: new Vector3().fromArray(p.position), quaternion: new Quaternion().fromArray(p.quaternion), joints: { ...p.joints }, closed: 1 });
const contact = (c: any): FingerContact => ({ ...c, point: new Vector3().fromArray(c.point), normal: new Vector3().fromArray(c.normal), padOffset: new Vector3().fromArray(c.padOffset) });
const delta = (a: any, b: any) => Math.max(new Vector3().fromArray(a.position).distanceTo(new Vector3().fromArray(b.position)), new Quaternion().fromArray(a.quaternion).angleTo(new Quaternion().fromArray(b.quaternion)), ...Object.keys(a.joints).map(k => Math.abs(a.joints[k] - b.joints[k])));
const variants: any[] = [], provenance: any[] = [];
let checkedFrames = 0, maximumContactMM = 0;
for (const sourceFile of files) {
  const source = JSON.parse(readFileSync(sourceFile, "utf8"));
  for (const input of source.sources) if (sha(input.path) !== input.sha256) throw new Error(`Source drift: ${input.path}`);
  if (sha(source.scriptSnapshot) !== source.scriptSHA256) throw new Error("Script snapshot drift");
  provenance.push({ path: sourceFile, sha256: sha(sourceFile), scriptSHA256: source.scriptSHA256, scriptSnapshot: source.scriptSnapshot });
  for (const record of source.cases) {
    if (!record.passed || record.segments.some((s: any) => !s.passed)) throw new Error(`Unaccepted case ${record.id}`);
    const move = parseMove(record.notation), segments = record.segments.map((s: any) => ({ id: s.id, stage: s.stage, active: s.active, ...(s.finger ? { finger: s.finger } : {}), frames: s.frames.map((f: any) => ({ left: f.left, right: f.right, contacts: f.contacts, cubeAngle: f.cubeAngle })) }));
    const first = segments[0].frames[0], last = segments.at(-1).frames.at(-1), turnIndex = segments.findIndex((s: any) => s.stage === "TURN");
    if (segments.filter((s: any) => s.stage === "TURN").length !== 1) throw new Error("Expected exactly one complete thumb quarter turn");
    if (Math.abs(first.cubeAngle) > 1e-10 || Math.abs(last.cubeAngle - moveAngle(move)) > 1e-10) throw new Error("Incorrect per-step angle convention");
    for (const side of sides) if (delta(first[side], library.hands[side].support) > 1e-7 || delta(last[side], library.hands[side].support) > 1e-7) throw new Error("Primitive does not start/end at low");
    let previous: any;
    for (const segment of segments) {
      if (segment.frames.length !== 65) throw new Error("Expected unchanged 65-node groups");
      if (previous) for (const side of sides) if (delta(previous[side], segment.frames[0][side]) > 1e-7) throw new Error("Exported boundary differs");
      for (let i = 0; i < 129; i++) {
        const p = i / 2, lo = Math.floor(p), hi = Math.min(lo + 1, 64), t = p - lo, a = segment.frames[lo], b = segment.frames[hi];
        const state = Object.fromEntries(sides.map(side => { const x = pose(a[side]), y = pose(b[side]); return [side, { position: x.position.lerp(y.position, t), quaternion: x.quaternion.slerp(y.quaternion, t), joints: Object.fromEntries(Object.keys(x.joints).map(k => [k, x.joints[k] + (y.joints[k] - x.joints[k]) * t])), closed: 1 }]; })) as any;
        const angle = a.cubeAngle + (b.cubeAngle - a.cubeAngle) * t;
        const cs = a.contacts.map((c: any, j: number) => { const item = contact(c); item.padOffset.lerp(new Vector3().fromArray(b.contacts[j].padOffset), t); return item; });
        const currentMove = segment.stage === "TURN" ? move : undefined;
        if (!hasMeasuredSupport(state, cs, currentMove, angle)) throw new Error(`Exported support fails ${record.id}/${segment.id}/${i}`);
        for (const c of cs) {
          const check = measureContact(state[c.side], c, currentMove, angle); maximumContactMM = Math.max(maximumContactMM, check.error * 1000);
          if (!check.valid || check.error > .0003) throw new Error(`Exported contact fails ${record.id}/${segment.id}/${i}`);
        }
        checkedFrames++;
      }
      previous = segment.frames.at(-1);
    }
    const turn = segments[turnIndex], ready = turn.frames[0], finished = turn.frames.at(-1);
    const resting = (frame: any) => ({ left: frame.left, right: frame.right, cubeAngle: 0, contacts: frame.contacts.map((c: any) => ({ ...c, role: "support", point: c.role === "drive" ? new Vector3().fromArray(c.point).applyAxisAngle(Z, frame.cubeAngle).toArray() : c.point, normal: c.role === "drive" ? new Vector3().fromArray(c.normal).applyAxisAngle(Z, frame.cubeAngle).toArray() : c.normal })) });
    variants.push({ id: record.id, notation: record.notation, active: record.active, finger: 1, route: sourceFile === files[0] ? "natural" : "reverse", cubeOrientation: [0, 0, 0, 1],
      source: { path: sourceFile, caseId: record.id, sha256: sha(sourceFile) }, segments, turnSegmentIndex: turnIndex,
      landmarks: { low: { left: first.left, right: first.right }, thumbReady: { duringStep: ready, resting: resting(ready) }, thumbFinished: { duringStep: finished, resting: resting(finished) } },
      partition: { prepareSegmentIndices: Array.from({ length: turnIndex }, (_, i) => i), turnSegmentIndices: [turnIndex], returnSegmentIndices: Array.from({ length: segments.length - turnIndex - 1 }, (_, i) => turnIndex + 1 + i) },
      geometry: { checkedFrames: record.checkedFrames, maximum: record.maximum, pathMM: record.pathMM },
    });
  }
}
const output = "evidence/competitive-thumb-primitives.json";
writeFileSync(output, JSON.stringify({ schemaVersion: 1, date: new Date().toISOString(), kind: "competitive-thumb-F", thresholdMM: .3, provenance, exportScriptSHA256: sha("scripts/competitive-thumb-export.ts"),
  parameters: { startContactMM: ["side sign * 30", -20, 45.2], wristFollowFraction: .1, maximumTurnWristDisplacementMM: Math.sqrt(26), releaseWristOffsetMM: 8, turnWristRotationDegrees: 0 },
  convention: { frameSampling: "65 equally spaced nodes; runtime linear position/joint/padOffset interpolation and quaternion slerp. Do not replace with a spline without validation.", cubeAngle: "Each primitive is one move: starts at 0 and finishes at moveAngle(notation), including PREPARE after the TURN.", driveContact: "Material point before this move; rotate point/normal by cubeAngle during TURN. padOffset remains tip-local.", supportContact: "Stationary contact in current aligned cube coordinates. Static PREPARE uses no moving-layer argument for the contact gate.", landmarks: "duringStep preserves the move's angle/material coordinates. resting maps drive material points to their current position, labels every held contact support and resets angle to 0 for a committed-state handoff." },
  exportVerification: { passed: true, checkedFrames, maximumContactMM }, variants,
  limitations: ["Sampled visual/kinematic validation only; no continuous triangle collision, contact force/friction, actuator speed or hardware proof.", "Runtime composition, timing and perception require the parent product's integration checks."] }, null, 2) + "\n");
console.log(JSON.stringify({ output, variants: variants.map(v => ({ id: v.id, notation: v.notation, active: v.active, turnSegmentIndex: v.turnSegmentIndex })), checkedFrames, maximumContactMM }));
