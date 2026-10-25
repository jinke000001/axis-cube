/** Final bounded timing acceptance. Uses the production retimer unchanged. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { applyAlgorithm, parseAlgorithm, snapshots, SOLVED } from "../src/core/cube";
import { isCFOPPhaseSolved, solveCFOP, type CFOPResult } from "../src/core/cfop";
import { compileFingerSolve } from "../src/scene/finger-solve-program";
import { retimeFingerProgram } from "../src/scene/finger-cadence";
import type { FingerProgram, FingerSegment } from "../src/scene/finger-program";
import type { MotionFrame } from "../src/scene/motion";

const fixedOnly = process.argv.includes("--fixed-only");
const stem = `evidence/finger-final-cadence${fixedOnly ? "-fixed" : ""}`;
const duration = 5, pathDivisions = 128, phaseOffsets = [0, .25, .5, .75];
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sourcePaths = [
  "scripts/finger-final-cadence.ts", "src/scene/finger-cadence.ts", "src/scene/finger-solve-program.ts",
  "src/scene/finger-program.ts", "src/scene/finger-direct-program.ts", "src/scene/finger-direct.json",
  "src/scene/finger-face-program.ts", "src/scene/finger-rotation-program.ts", "src/scene/finger-data.ts",
  "src/scene/finger-library.json", "src/scene/finger-paths.json", "src/scene/finger-faces.json",
  "src/scene/finger-rotations.json", "src/core/execution-moves.ts", "src/core/cube.ts",
  "src/App.tsx", "src/scene/studio.ts", "evidence/finger-cadence-probe-128.json",
  "evidence/finger-solve-full.json", "evidence/real-photo-session.json",
  ...(!fixedOnly ? ["src/core/cfop.ts", "src/core/cfop-state.ts", "src/core/solver.worker.ts"] : []),
];
const sources = sourcePaths.map(path => ({ path, sha256: sha(path) }));
const legacy = JSON.parse(readFileSync("evidence/finger-cadence-probe-128.json", "utf8"));
const oldFixed = legacy.results.find((result: { id: string }) => result.id === "fixed-cfop66");
const oldFull = JSON.parse(readFileSync("evidence/finger-solve-full.json", "utf8"))
  .studies.find((study: { id: string }) => study.id === "demo-cfop");
if (oldFixed.algorithm !== oldFull.algorithm || oldFixed.state !== oldFull.sourceState)
  throw new Error("旧节奏证据与原 66 步几何证据不是同一公式/局面。");
const photo = JSON.parse(readFileSync("evidence/real-photo-session.json", "utf8"));
const quantile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), i = (sorted.length - 1) / 2;
  return (sorted[Math.floor(i)] + sorted[Math.ceil(i)]) / 2;
};
type Pose = ReturnType<FingerSegment["sample"]>;
type Case = { id: string; state: string; algorithm: string; selection?: CFOPResult; solverMS?: number };

function difference(a: Pose, b: Pose) {
  let positionM = 0, quaternionRad = 0, jointRad = 0, contactM = 0;
  for (const side of ["left", "right"] as const) {
    positionM = Math.max(positionM, a[side].position.distanceTo(b[side].position));
    quaternionRad = Math.max(quaternionRad, a[side].quaternion.angleTo(b[side].quaternion));
    for (const key of Object.keys(a[side].joints ?? {}))
      jointRad = Math.max(jointRad, Math.abs(a[side].joints![key] - (b[side].joints?.[key] ?? 0)));
  }
  if (a.contacts.length !== b.contacts.length) contactM = Infinity;
  else a.contacts.forEach((c, i) => {
    const d = b.contacts[i];
    if (c.side !== d.side || c.finger !== d.finger || c.role !== d.role) contactM = Infinity;
    contactM = Math.max(contactM, c.point.distanceTo(d.point), c.normal.distanceTo(d.normal), c.padOffset.distanceTo(d.padOffset));
  });
  return { positionM, quaternionRad, jointRad, contactM, angleRad: Math.abs(a.angle - b.angle) };
}
const within = (d: ReturnType<typeof difference>) => d.positionM < 1e-8 && d.quaternionRad < 2e-7
  && d.jointRad < 1e-7 && d.contactM < 1e-8 && d.angleRad < 1e-7;
const metadata = (f: MotionFrame) => [f.index, f.phase, f.stage, f.active, f.support, f.activeFinger, f.complete];
const presentationSample = (program: FingerProgram, wallSeconds: number, speed: number) =>
  program.sample(Math.min(program.duration, wallSeconds * speed));

function measurePath(program: FingerProgram) {
  let maxHandM = 0, leftM = 0, rightM = 0, maximumBoundaryM = 0;
  let previousEnd: Pose | undefined;
  for (const segment of program.segments) {
    let previous = segment.sample(0);
    if (previousEnd) maximumBoundaryM = Math.max(maximumBoundaryM,
      previous.left.position.distanceTo(previousEnd.left.position), previous.right.position.distanceTo(previousEnd.right.position));
    for (let i = 1; i <= pathDivisions; i++) {
      const current = segment.sample(i / pathDivisions);
      const l = current.left.position.distanceTo(previous.left.position), r = current.right.position.distanceTo(previous.right.position);
      leftM += l; rightM += r; maxHandM += Math.max(l, r); previous = current;
    }
    previousEnd = previous;
  }
  return { divisions: pathDivisions, maxHandM, leftM, rightM, sumBothHandsM: leftM + rightM, maximumBoundaryM };
}

function verifyPath(original: FingerProgram, program: FingerProgram) {
  const maximum = { positionM: 0, quaternionRad: 0, jointRad: 0, contactM: 0, angleRad: 0 };
  const failures: unknown[] = []; let checked = 0, endpoints = 0;
  const collect = (d: ReturnType<typeof difference>, context: unknown) => {
    checked++;
    for (const key of Object.keys(maximum) as (keyof typeof maximum)[]) maximum[key] = Math.max(maximum[key], d[key]);
    if (!within(d)) failures.push({ context, difference: d });
  };
  program.segments.forEach((segment, i) => {
    const source = original.segments[i];
    for (const p of [0, 1]) { collect(difference(segment.sample(p), source.sample(p)), { i, p, endpoint: true }); endpoints++; }
    let previousProgress = -Infinity;
    for (const p of [.01, .25, .5, .75, .99]) {
      const frame = program.sample(segment.start + segment.duration * p);
      if (frame.index !== segment.index || frame.phase !== segment.phase || frame.stage !== segment.stage
        || frame.active !== segment.active || frame.activeFinger !== segment.finger)
        failures.push({ i, p, reason: "public metadata mismatch", frame: metadata(frame) });
      if (frame.progress < previousProgress || frame.progress < 0 || frame.progress > 1)
        failures.push({ i, p, reason: "non-monotonic source progress", progress: frame.progress });
      previousProgress = frame.progress;
      collect(difference(frame, source.sample(frame.progress)), { i, p, public: true });
    }
  });
  const final = program.sample(duration), originalFinal = original.sample(duration);
  collect(difference(final, originalFinal), "final");
  if (JSON.stringify(metadata(final)) !== JSON.stringify(metadata(originalFinal)) || !final.complete || final.index !== program.steps.length)
    failures.push({ reason: "terminal metadata" });
  let slowSamples = 0;
  for (let i = 0; i <= 2048; i++) {
    const race = presentationSample(program, 5 * i / 2048, 1);
    const slow = presentationSample(program, 20 * i / 2048, .25);
    collect(difference(race, slow), { sameSpaceSlow: i }); slowSamples++;
    if (race.orientation.angleTo(slow.orientation) > 2e-7 || JSON.stringify(metadata(race)) !== JSON.stringify(metadata(slow))
      || race.progress !== slow.progress) failures.push({ reason: "5s/20s spatial state mismatch", i });
  }
  return { passed: failures.length === 0, checked, endpoints, slowSamples, maximum, failures: failures.slice(0, 10), failureCount: failures.length };
}

function temporalMetrics(program: FingerProgram, speed: number, hz: number, offset: number) {
  const seconds = program.duration / speed;
  const turns = program.segments.flatMap((s, i) => s.stage === "TURN" ? [i] : []);
  const counts = new Map(turns.map(i => [i, 0]));
  const wristMM: number[] = [], wristDegrees: number[] = [], badMetadata: unknown[] = [];
  let previous: MotionFrame | undefined, segmentIndex = 0;
  for (let k = 0; k <= Math.ceil(seconds * hz - offset); k++) {
    const wallTime = Math.min(seconds, (k + offset) / hz), time = wallTime * speed;
    const frame = presentationSample(program, wallTime, speed);
    while (segmentIndex + 1 < program.segments.length && program.segments[segmentIndex + 1].start <= time) segmentIndex++;
    if (!frame.complete) {
      const segment = program.segments[segmentIndex];
      if (frame.stage !== segment.stage || frame.index !== segment.index || frame.phase !== segment.phase)
        badMetadata.push({ wallTime, segmentIndex, stage: frame.stage, index: frame.index });
      if (frame.stage === "TURN" && frame.progress > 1e-8 && frame.progress < 1 - 1e-8)
        counts.set(segmentIndex, (counts.get(segmentIndex) ?? 0) + 1);
    }
    if (previous) {
      wristMM.push(Math.max(frame.left.position.distanceTo(previous.left.position), frame.right.position.distanceTo(previous.right.position)) * 1000);
      wristDegrees.push(Math.max(frame.left.quaternion.angleTo(previous.left.quaternion), frame.right.quaternion.angleTo(previous.right.quaternion)) * 180 / Math.PI);
    }
    previous = frame;
  }
  const values = turns.map(i => counts.get(i)!);
  return {
    hz, framePhaseOffset: offset, presentationSeconds: seconds, speed,
    turnSegments: turns.length, minTurnFrames: Math.min(...values), medianTurnFrames: median(values),
    zeroFrameTurns: values.filter(n => n === 0).length, oneFrameTurns: values.filter(n => n === 1).length,
    wristFrameMM: { max: Math.max(...wristMM), p90: quantile(wristMM, .9), mean: wristMM.reduce((a, b) => a + b, 0) / wristMM.length },
    wristFrameDegrees: { max: Math.max(...wristDegrees), p90: quantile(wristDegrees, .9) },
    turnFrames: values, badMetadata: badMetadata.slice(0, 8), badMetadataCount: badMetadata.length,
  };
}

function evaluate(c: Case) {
  const compiledAt = performance.now(), original = compileFingerSolve(parseAlgorithm(c.algorithm), duration), compileMS = performance.now() - compiledAt;
  const started = performance.now(), program = retimeFingerProgram(original), retimeMS = performance.now() - started;
  const solved = applyAlgorithm(c.state, c.algorithm) === SOLVED;
  const states = snapshots(c.state, program.steps.map(step => step.move));
  const phaseVerification = c.selection?.phases.map(phase => ({
    name: phase.name, start: phase.start, end: phase.end, solved: isCFOPPhaseSolved(states[phase.end], phase.name),
  }));
  const validation = verifyPath(original, program);
  const playback = [1, .25].map(speed => ({
    speed, seconds: duration / speed,
    byHz: [60, 120].map(hz => ({ hz, phases: phaseOffsets.map(offset => temporalMetrics(program, speed, hz, offset)) })),
  }));
  const turns = program.segments.flatMap((s, i) => s.stage === "TURN" ? [{
    segmentIndex: i, stepIndex: s.index, notation: program.steps[s.index].move.notation,
    phase: s.phase, finger: s.finger, active: s.active, start: s.start, duration: s.duration,
  }] : []);
  const passed = solved && validation.passed && (!phaseVerification || phaseVerification.every(p => p.solved))
    && turns.every(t => t.duration + 1e-12 >= 2.05 / 60)
    && playback.every(p => p.byHz.every(h => h.phases.every(m => !m.badMetadataCount && m.minTurnFrames >= (h.hz === 60 ? 2 : 4))));
  const result = { ...c, solved, passed, moves: program.steps.length, segments: program.segments.length,
    cost: program.cost, statistics: program.statistics, compileMS, retimeMS, phaseVerification,
    path: measurePath(original), turnTimeSeconds: turns.reduce((n, t) => n + t.duration, 0),
    nonTurnSegmentsUnderOne60HzFrame: program.segments.filter(s => s.stage !== "TURN" && s.duration < 1 / 60).length,
    turns, validation, playback };
  console.log(JSON.stringify({ id: c.id, passed, moves: result.moves, segments: result.segments,
    pathM: result.path.maxHandM, statistics: result.statistics, compileMS, retimeMS, turnTimeSeconds: result.turnTimeSeconds,
    race: playback[0].byHz.map(h => ({ hz: h.hz, ...h.phases[0], turnFrames: undefined })),
    slow: playback[1].byHz.map(h => ({ hz: h.hz, ...h.phases[0], turnFrames: undefined })), validation }));
  return result;
}

const results = [evaluate({ id: "fixed-cfop66", state: oldFixed.state, algorithm: oldFixed.algorithm })];
if (!fixedOnly) {
  const seed = applyAlgorithm(SOLVED, "R U2 F' L D B2 R' F2 U L2 D' B R2 U' F");
  for (const [id, state] of [["current-seed-cfop", seed], ["current-photo-cfop", photo.facelets]] as const) {
    const start = performance.now();
    const selection = solveCFOP(state, { gestureCost: algorithm => compileFingerSolve(parseAlgorithm(algorithm)).cost });
    results.push(evaluate({ id, state, algorithm: selection.solution, selection, solverMS: performance.now() - start }));
  }
}
const currentFixed = results[0];
const oldByVariant = ["baseline", "arc-turn-floor"].map(id => {
  const v = oldFixed.variants.find((variant: { id: string }) => variant.id === id);
  return { id, byHz: v.byHz.map(({ turnFrames: _, ...m }: { turnFrames: unknown; [key: string]: unknown }) => m) };
});
const comparison = {
  identicalAlgorithmAndState: true, legacyEvidence: "evidence/finger-cadence-probe-128.json",
  legacyMoves: oldFixed.moves, legacySegments: oldFixed.segments, currentSegments: currentFixed.segments,
  oldWristPathM: oldFixed.totalWristPathM, newWristPathM: currentFixed.path.maxHandM,
  pathReductionPercent: 100 * (1 - currentFixed.path.maxHandM / oldFixed.totalWristPathM), oldByVariant,
  current: currentFixed.playback[0].byHz.map(h => h.phases[0]),
};
const changedSources = sources.filter(s => sha(s.path) !== s.sha256);
const output = {
  date: new Date().toISOString(), mode: fixedOnly ? "fixed-only" : "final", sources, changedSources,
  passed: !changedSources.length && results.every(r => r.passed), comparison, results,
  samplingConvention: "Ideal fixed 60/120Hz presentation grids, offsets 0/.25/.5/.75 frames. Count each public TURN sample only at strict 0<source progress<1 (1e-8 endpoint margin). Wrist maximum is the larger left/right root translation between consecutive samples; P90 is nearest rank. Path uses max-hand distance at 128 divisions/segment, matching legacy evidence.",
  slowMotionContract: "App pace slow=0.25; Studio advances the same 5-second production program by dt*speed. 20-second mode is not independently recompiled or retimed. Compare equivalent progress at 2,049 wall-time pairs plus terminal and segment path checks.",
  limitations: [
    "Ideal temporal-resolution metrics are not measured browser FPS, dropped-frame behavior or human perceptual acceptance.",
    "A >=2-frame TURN floor makes the motion visible but does not ensure a smoothly perceived finger stroke.",
    "The retained path can still require large fast repositioning; timing-only verification does not prove hardware velocity, acceleration, torque, force closure or collision safety.",
    "Current seed/photo CFOP are independently solved from their own states; compare new geometry against legacy only through the identical fixed 66-step algorithm.",
  ],
};
writeFileSync(stem + ".json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ output: stem + ".json", passed: output.passed, changedSources, pathReductionPercent: comparison.pathReductionPercent }));
if (!output.passed) process.exitCode = 1;
