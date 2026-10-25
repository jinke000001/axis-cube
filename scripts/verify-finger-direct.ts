/** Independent product compiler vs measured direct-finger evidence audit.
 * Does not alter business code, contracts or rerun the STL collision sweep. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Mesh, Quaternion, Vector3 } from "three";
import { NORMALS, DEFAULT_PALETTE, SOLVED, parseAlgorithm, snapshots, type Move } from "../src/core/cube";
import { CENTER, type HandPose, type Side } from "../src/scene/motion";
import { compileDirectFingerProgram } from "../src/scene/finger-direct-program";
import { hasMeasuredSupport, measureContact, type FingerContact } from "../src/scene/finger-contact";
import { fingerJoints, type FingerIndex } from "../src/scene/finger-rig";
import { CubeModel } from "../src/scene/cube-model";
import type { FingerProgram } from "../src/scene/finger-program";

type Pose = { position: number[]; quaternion: number[]; joints: Record<string, number> };
type Contact = { side: Side; finger: FingerIndex; role: "support" | "drive"; point: number[]; normal: number[]; padOffset: number[] };
type Frame = { left: Pose; right: Pose; contacts: Contact[]; cubeAngle: number; turning: boolean; progress: number };
type Segment = { id: string; moving: Side; frames: Frame[]; passed: boolean };
type Evidence = { notation: string; active: Side; rotation: number[]; passed: boolean; segments: Segment[]; sources: { path: string; sha256: string }[]; final: Record<Side, Pose> };
type Output = ReturnType<FingerProgram["segments"][number]["sample"]>;
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const raw = read("src/scene/finger-direct.json"), library = read("src/scene/finger-library.json"), paths = read("src/scene/finger-paths.json");
const sides: Side[] = ["left", "right"];
const sourceNames = ["src/scene/finger-direct-program.ts", "src/scene/finger-direct.json", "src/scene/finger-data.ts", "src/scene/finger-program.ts", "src/scene/finger-library.json", "src/scene/finger-paths.json", "src/scene/finger-contact.ts", "src/scene/finger-rig.ts", "src/scene/finger-rig.json", "src/scene/cube-model.ts", "src/core/cube.ts", "scripts/verify-finger-direct.ts"];
const sourceHashes = sourceNames.map(path => ({ path, sha256: sha(path) }));
const failures: any[] = [], observations: any[] = [];
const requireCheck = (condition: boolean, reason: string, detail: any = {}) => {
  if (!condition) failures.push({ reason, ...detail });
};
const ease = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
function inverseEase(s: number) {
  if (s <= 0 || s >= 1) return s;
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ease(mid) < s) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function blend(a: Pose, b: Pose, t: number): Pose {
  return { position: new Vector3().fromArray(a.position).lerp(new Vector3().fromArray(b.position), t).toArray(),
    quaternion: new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion), t).toArray(),
    joints: Object.fromEntries(Object.keys(a.joints).map(k => [k, a.joints[k] + (b.joints[k] - a.joints[k]) * t])) };
}
function at(nodes: Pose[], s: number) {
  const x = s * (nodes.length - 1), a = Math.floor(x), b = Math.min(a + 1, nodes.length - 1);
  return blend(nodes[a], nodes[b], x - a);
}
function rotate(pose: Pose, q: Quaternion): Pose {
  return { ...pose, position: new Vector3().fromArray(pose.position).sub(CENTER).applyQuaternion(q).add(CENTER).toArray(),
    quaternion: q.clone().multiply(new Quaternion().fromArray(pose.quaternion)).toArray() };
}
function poseData(p: HandPose): Pose { return { position: p.position.toArray(), quaternion: p.quaternion.toArray(), joints: { ...p.joints } }; }
function contactData(c: FingerContact): Contact { return { ...c, point: c.point.toArray(), normal: c.normal.toArray(), padOffset: c.padOffset.toArray() }; }
function outputData(value: Output): Frame { return { left: poseData(value.left), right: poseData(value.right), contacts: value.contacts.map(contactData), cubeAngle: value.angle, turning: false, progress: 0 }; }
function poseDifference(a: Pose, b: Pose) {
  return { wristMM: new Vector3().fromArray(a.position).distanceTo(new Vector3().fromArray(b.position)) * 1000,
    wristRAD: new Quaternion().fromArray(a.quaternion).angleTo(new Quaternion().fromArray(b.quaternion)),
    jointRAD: Math.max(0, ...Object.keys(a.joints).map(k => Math.abs(a.joints[k] - b.joints[k]))) };
}
function difference(a: Frame, b: Frame) {
  const p = sides.map(s => poseDifference(a[s], b[s]));
  let contactMM = 0, normal = 0, contactIdentity = a.contacts.length !== b.contacts.length;
  const other = new Map(b.contacts.map(c => [`${c.side}/${c.finger}/${c.role}`, c]));
  for (const c of a.contacts) {
    const d = other.get(`${c.side}/${c.finger}/${c.role}`);
    if (!d) { contactIdentity = true; continue; }
    contactMM = Math.max(contactMM, new Vector3().fromArray(c.point).distanceTo(new Vector3().fromArray(d.point)) * 1000,
      new Vector3().fromArray(c.padOffset).distanceTo(new Vector3().fromArray(d.padOffset)) * 1000);
    normal = Math.max(normal, new Vector3().fromArray(c.normal).distanceTo(new Vector3().fromArray(d.normal)));
  }
  return { wristMM: Math.max(...p.map(x => x.wristMM)), wristRAD: Math.max(...p.map(x => x.wristRAD)),
    jointRAD: Math.max(...p.map(x => x.jointRAD)), angleRAD: Math.abs(a.cubeAngle - b.cubeAngle), contactMM, normal, contactIdentity };
}
const numerical = (d: ReturnType<typeof difference>) => !d.contactIdentity && d.wristMM < 1e-6 && d.wristRAD < 1e-6 && d.jointRAD < 1e-8 && d.angleRAD < 1e-8 && d.contactMM < 1e-6 && d.normal < 1e-8;
function maximum(target: Record<string, number>, data: Record<string, any>) {
  for (const [k, v] of Object.entries(data)) if (typeof v === "number") target[k] = Math.max(target[k] ?? 0, v);
}
function evidenceInterpolated(segment: Segment, s: number): Frame {
  const x = s * (segment.frames.length - 1), lo = Math.floor(x), hi = Math.min(segment.frames.length - 1, lo + 1), t = x - lo;
  const a = segment.frames[lo], b = segment.frames[hi];
  return { ...a, left: blend(a.left, b.left, t), right: blend(a.right, b.right, t), cubeAngle: a.cubeAngle + (b.cubeAngle - a.cubeAngle) * t,
    contacts: a.contacts.map((c, i) => ({ ...c, padOffset: new Vector3().fromArray(c.padOffset).lerp(new Vector3().fromArray(b.contacts[i].padOffset), t).toArray() })) };
}
/** Independent reconstruction of the source's full-density U paths. The probe
 * exports 65 samples, but the product deliberately retains these 321-point paths. */
function denseSource(evidence: Evidence, segment: Segment, s: number): Frame {
  const baseline = evidenceInterpolated(segment, s), active = evidence.active, q = new Quaternion().fromArray(evidence.rotation);
  const staticPath = segment.id.match(/^finger-(prepare|release)-(\d)-(\d)$/);
  if (staticPath) {
    const kind = staticPath[1], quarter = Number(staticPath[2]), group = Number(staticPath[3]);
    const record = paths.strokes[`${active}-${quarter ? "middle" : "index"}`];
    const double = evidence.notation.includes("2");
    let groups = record[kind];
    if (double && kind === "release" && quarter === 0) groups = record.overlapRelease;
    if (double && kind === "prepare" && quarter === 1) groups = record.prepare.slice(-1);
    baseline[active] = rotate(at(groups[group], s), q);
  }
  const turn = segment.id.match(/^finger-turn-(\d)$/);
  if (turn) {
    const quarter = Number(turn[1]), finger = quarter ? 3 : 2, id = `${active}-${quarter ? "middle" : "index"}`;
    const samples = library.strokes[id].samples, x = s * (samples.length - 1), lo = Math.floor(x), hi = Math.min(samples.length - 1, lo + 1), t = x - lo;
    const angles = samples[lo].angles.map((v: number, i: number) => v + (samples[hi].angles[i] - v) * t);
    if (evidence.notation.includes("2") && quarter === 0) baseline[active] = rotate(at(paths.strokes[id].overlapTurn, s), q);
    else {
      baseline[active] = structuredClone(segment.frames[0][active]);
      angles.forEach((v: number, i: number) => baseline[active].joints[`${active}_finger${finger}_joint${i + 1}`] = v);
    }
    baseline.cubeAngle = segment.frames[0].cubeAngle + samples[lo].angle + (samples[hi].angle - samples[lo].angle) * t;
    baseline.contacts = structuredClone(segment.frames[0].contacts);
    baseline.contacts.find(c => c.role === "drive")!.padOffset = new Vector3().fromArray(samples[lo].padLocalOffset).lerp(new Vector3().fromArray(samples[hi].padLocalOffset), t).toArray();
  }
  return baseline;
}
function validateFrame(value: Output, move: Move | undefined, context: any, totals: Record<string, number>) {
  const contacts = value.contacts, support = contacts.filter(c => c.role === "support"), drives = contacts.filter(c => c.role === "drive");
  requireCheck(hasMeasuredSupport(value, contacts, move, value.angle), "measured support fails", context);
  requireCheck(support.length === 3 && new Set(support.map(c => c.side)).size === 1, "three stationary contacts required", context);
  requireCheck(drives.length === (move ? 1 : 0), "static/turn contact semantics differ", context);
  for (const c of contacts) {
    const check = measureContact(value[c.side], c, move, value.angle);
    totals.contactMM = Math.max(totals.contactMM ?? 0, check.error * 1000);
    requireCheck(check.valid && check.error <= .0003, "actual FK contact fails 0.3 mm gate", { ...context, side: c.side, finger: c.finger, role: c.role, errorMM: check.error * 1000 });
  }
  for (const side of sides) for (const finger of [1, 2, 3, 4, 5] as FingerIndex[]) for (const joint of fingerJoints(side, finger))
    requireCheck(value[side].joints![joint.name] >= joint.lower - 1e-8 && value[side].joints![joint.name] <= joint.upper + 1e-8, "joint outside limits", { ...context, joint: joint.name });
}

const cases: any[] = [], standalone = new Map<string, FingerProgram>();
for (const [face, prefix] of [["F", "front"], ["B", "back"], ["D", "down"]]) {
  for (const side of sides) for (const count of ["single", "double"]) {
    const filename = `evidence/finger-${prefix}-${side}-${count}-entry-0.04-64.json`, evidence = read(filename) as Evidence;
    const beginFailures = failures.length, move = parseAlgorithm(evidence.notation)[0], program = compileDirectFingerProgram([move]);
    standalone.set(evidence.notation, program);
    const result: any = { notation: evidence.notation, evidence: filename, evidenceSHA256: sha(filename), segments: program.segments.length, cost: program.cost, sourceNodes: 0, actualSamples: 0,
      nodeDifference: {}, denseSourceDifference: {}, coarseInterpolationDifference: {}, actual: {}, joins: {}, publicSamplerDifference: {}, changedEvidenceSources: [] };
    for (const source of evidence.sources) if (sha(source.path) !== source.sha256) result.changedEvidenceSources.push(source.path);
    requireCheck(evidence.passed && program.segments.length === evidence.segments.length, "source not passed or segment count changed", { notation: evidence.notation });
    requireCheck(program.segments.length === (count === "single" ? 19 : 24), "unexpected segment count", { notation: evidence.notation });
    for (let k = 0; k < program.segments.length; k++) {
      const compiled = program.segments[k], reference = evidence.segments[k], turning = reference.frames[0].turning;
      requireCheck(compiled.stage === (turning ? "TURN" : "PREPARE") && compiled.active === reference.moving && compiled.index === 0, "stage, active or index mismatch", { notation: evidence.notation, segment: reference.id });
      if (k) {
        const a = outputData(program.segments[k - 1].sample(1)), b = outputData(compiled.sample(0));
        const delta = difference({ ...a, contacts: [] }, { ...b, contacts: [] }); maximum(result.joins, delta);
        requireCheck(numerical(delta), "segment boundary discontinuity", { notation: evidence.notation, segment: reference.id, delta });
      }
      for (let i = 0; i <= 128; i++) {
        const s = i / 128, p = inverseEase(s), value = compiled.sample(p), actual = outputData(value), expected = denseSource(evidence, reference, s);
        const delta = difference(actual, expected); maximum(result.denseSourceDifference, delta);
        requireCheck(numerical(delta), "product differs from source path", { notation: evidence.notation, segment: reference.id, progress: s, delta });
        const coarseReference = evidenceInterpolated(reference, s), coarse = difference(actual, coarseReference);
        if (coarse.jointRAD > (result.coarseInterpolationDifference.jointRAD ?? 0) + 1e-9) {
          let joint = "", side: Side = evidence.active;
          for (const hand of sides) for (const name of Object.keys(actual[hand].joints))
            if (Math.abs(actual[hand].joints[name] - coarseReference[hand].joints[name]) >= coarse.jointRAD - 1e-12) { joint = name; side = hand; }
          result.coarseInterpolationWitness = { segment: reference.id, progress: s, side, joint,
            actual: actual[side].joints[joint], exportedInterpolation: coarseReference[side].joints[joint], deltaRAD: coarse.jointRAD };
        }
        maximum(result.coarseInterpolationDifference, coarse);
        if (!(i % 2)) {
          result.sourceNodes++; maximum(result.nodeDifference, coarse);
          requireCheck(numerical(coarse), "product differs from recorded source node", { notation: evidence.notation, segment: reference.id, progress: s, delta: coarse });
        }
        result.actualSamples++; validateFrame(value, turning ? move : undefined, { notation: evidence.notation, segment: reference.id, progress: s }, result.actual);
        if (i < 128) {
          const publicValue = program.sample(compiled.start + compiled.duration * p), publicDelta = difference(outputData(publicValue as Output), actual);
          maximum(result.publicSamplerDifference, publicDelta);
          requireCheck(numerical(publicDelta) && publicValue.stage === compiled.stage && publicValue.index === 0 && publicValue.active === compiled.active && publicValue.activeFinger === compiled.finger,
            "public sampler differs from compiled segment", { notation: evidence.notation, segment: reference.id, progress: s, delta: publicDelta });
          requireCheck(publicValue.orientation.angleTo(new Quaternion()) < 1e-8, "cube orientation changed", { notation: evidence.notation, segment: reference.id, progress: s });
        }
      }
    }
    for (const s of sides) {
      const initial = poseDifference(poseData(program.segments[0].sample(0)[s]), library.hands[s].support), final = poseDifference(poseData(program.sample(program.duration)[s]), library.hands[s].support);
      requireCheck(Object.values(initial).every(v => v < 1e-7) && Object.values(final).every(v => v < 1e-7), "initial/final low differs", { notation: evidence.notation, side: s, initial, final });
    }
    result.passed = failures.length === beginFailures; cases.push(result);
    console.log(JSON.stringify({ notation: result.notation, passed: result.passed, segments: result.segments, maxFKContactMM: result.actual.contactMM, nodeDifference: result.nodeDifference, coarseInterpolationDifference: result.coarseInterpolationDifference }));
  }
}

// All 144 ordered direct-move pairs catch captured mutable state that a
// standalone move cannot reveal. Sample each corresponding segment at 9 points.
const pairing = { pairs: 0, samples: 0, maximum: {} as Record<string, number> };
for (const a of standalone.keys()) for (const b of standalone.keys()) {
  const joined = compileDirectFingerProgram(parseAlgorithm(a + " " + b)), originals = [standalone.get(a)!, standalone.get(b)!];
  let offset = 0;
  for (let move = 0; move < originals.length; move++) {
    for (let k = 0; k < originals[move].segments.length; k++) {
      const current = joined.segments[offset + k], original = originals[move].segments[k];
      requireCheck(current.index === move && current.stage === original.stage && current.active === original.active, "joined segment metadata differs", { pair: [a, b], segment: offset + k });
      for (let i = 0; i <= 8; i++) {
        const delta = difference(outputData(current.sample(i / 8)), outputData(original.sample(i / 8))); maximum(pairing.maximum, delta); pairing.samples++;
        requireCheck(numerical(delta), "joining moves changed a path", { pair: [a, b], segment: offset + k, progress: i / 8, delta });
      }
    }
    offset += originals[move].segments.length;
  }
  const boundary = joined.steps[1].start;
  requireCheck(joined.sample(boundary - 1e-9).index === 0 && joined.sample(boundary).index === 1 && joined.sample(5).index === 2, "half-open move commit index differs", { pair: [a, b] });
  pairing.pairs++;
}

// Use unique material labels to avoid solved-color symmetry hiding a commit
// mismatch. Positions/normals come from the actual CubeModel, not an oracle mesh.
const commitSequence = [...standalone.keys()].join(" "), commitProgram = compileDirectFingerProgram(parseAlgorithm(commitSequence));
const labels = Array.from({ length: 54 }, (_, i) => String.fromCharCode(0x100 + i)).join("");
const states = snapshots(labels, commitProgram.steps.map(s => s.move)), cube = new CubeModel();
function visual(time: number) {
  const frame = commitProgram.sample(time); cube.update(SOLVED, DEFAULT_PALETTE, frame.orientation, commitProgram.steps[frame.index]?.move, frame.angle); cube.root.updateMatrixWorld(true);
  const visible: string[] = [];
  cube.root.traverse(node => {
    if (!(node instanceof Mesh) || !node.name.startsWith("sticker-")) return;
    const id = Number(node.name.slice(8)), position = node.getWorldPosition(new Vector3()), normal = new Vector3(0, 0, 1).applyQuaternion(node.getWorldQuaternion(new Quaternion()));
    visible.push(states[frame.index][id] + ":" + [...position.toArray(), ...normal.toArray()].map(v => Math.round(v * 1e7)).join(","));
  });
  return visible.sort().join("|");
}
const commits: any[] = [];
for (let i = 0; i < commitProgram.steps.length; i++) {
  const time = commitProgram.steps[i + 1]?.start ?? commitProgram.duration, passed = visual(time - 1e-9) === visual(time);
  requireCheck(passed, "54 unique visible stickers discontinuous at commit", { index: i, notation: commitProgram.steps[i].move.notation });
  commits.push({ index: i, notation: commitProgram.steps[i].move.notation, passed });
}
cube.dispose();
for (const source of raw.provenance) requireCheck(sha(source.path) === source.sha256, "product primitive provenance hash differs", source);
const changedSources = sourceHashes.filter(s => sha(s.path) !== s.sha256);
requireCheck(!changedSources.length, "source changed during audit", { changedSources });
observations.push({ kind: "timing revision", note: "Current source uses measured active-entry wrist path metres times 2.5 for entry and return timing weights. This audit reran the source-path, FK and public-sampler comparisons against that current revision; no geometric path change was detected." });
observations.push({ kind: "dense overlap sampling", note: "Only double-turn index-overlap motion differs from interpolation of the 65 exported reference nodes. It matches the original full-density U overlap table; per-case witnesses identify the middle-finger joint and phase. This is not asserted as full-STL equivalence between the two midpoint paths." });
const output = { date: new Date().toISOString(), scope: "Actual compileDirectFingerProgram output against 12 measured F/B/D round trips, full-density U source paths, actual FK contacts, segment and move boundaries. No STL rerun.",
  passed: !failures.length, thresholdMM: .3, sourceHashes, changedSources, cases, pairing, commits, failures, observations,
  limitations: ["Geometry collision coverage is inherited from recorded source checks, not recomputed here.", "The product retains full-density source U prepare/turn/release tables. Their midpoint poses can differ slightly from linear interpolation of the probe's coarser 65 exported samples; both are reported separately.", "No retimed mixed full-solve, frame-rate perception, dynamic force or hardware validation in this audit."] };
writeFileSync("evidence/finger-direct-compiler-audit.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ output: "evidence/finger-direct-compiler-audit.json", passed: output.passed, failures: failures.length, pairing, firstFailures: failures.slice(0, 5) }));
if (failures.length) process.exitCode = 1;
