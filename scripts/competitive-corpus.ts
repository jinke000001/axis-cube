import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { applyAlgorithm, DEFAULT_PALETTE, FACES, moveAngle, NORMALS, parseAlgorithm,
  SLOTS, snapshots, SOLVED, validateFacelets, type Move } from "../src/core/cube";
import { solveCompetitiveCFOP } from "../src/core/competitive-cfop";
import { competitionVariant, readCompetitionVariant } from "../src/core/competition";
import { isCFOPPhaseSolved } from "../src/core/cfop-state";
import { competitivePhraseCost, compileCompetitiveExecution, planCompetitiveExecution } from "../src/scene/competitive-program";
import { compileFingerSolve } from "../src/scene/finger-solve-program";
import { retimeFingerProgram } from "../src/scene/finger-cadence";
import type { FingerProgram } from "../src/scene/finger-program";
import type { HandPose, MotionFrame } from "../src/scene/motion";
import { CubeModel } from "../src/scene/cube-model";

/** Serial, bounded corpus evidence. No STL/FK sweep, browser or hardware claim.
 * Run: nice -n 10 npx tsx scripts/competitive-corpus.ts
 * Every result is checkpointed, including errors, before the next case starts.
 */
const startedAt = new Date().toISOString();
const stem = `evidence/competitive-corpus-${startedAt.replace(/[:.]/g, "-")}`;
const replayArgument = process.argv.indexOf("--replay");
const replayPath = replayArgument < 0 ? undefined : process.argv[replayArgument + 1];
if (replayArgument >= 0 && !replayPath) throw new Error("--replay 需要原始语料 JSON 路径。");
const replay = replayPath ? JSON.parse(readFileSync(replayPath, "utf8")) : undefined;
const seed = 0x5eedc0de, scrambleCount = 32, scrambleLength = 25, divisions = 128;
const floor = 2.05 / 60, offsets = [0, 0.25, 0.5, 0.75];
const sides = ["left", "right"] as const;
const sourceFiles = [
  "scripts/competitive-corpus.ts", "package-lock.json", "src/core/cube.ts", "src/core/cfop.ts",
  "src/core/cfop-state.ts", "src/core/competitive-cfop.ts", "src/core/competition.ts",
  "src/core/reorientation-plan.ts", "src/core/execution-moves.ts", "src/core/solver.worker.ts",
  "src/scene/competitive-program.ts", "src/scene/competitive-library.ts", "src/scene/competitive-library.json",
  "src/scene/recorded-finger-program.ts", "src/scene/finger-program-assembly.ts", "src/scene/finger-cadence.ts",
  "src/scene/finger-solve-program.ts", "src/scene/finger-program.ts", "src/scene/finger-direct-program.ts",
  "src/scene/finger-direct.json", "src/scene/finger-face-program.ts", "src/scene/finger-faces.json",
  "src/scene/finger-rotation-program.ts", "src/scene/finger-rotations.json", "src/scene/finger-data.ts",
  "src/scene/finger-library.json", "src/scene/finger-paths.json", "src/scene/motion.ts",
  "src/scene/grip-planner.ts", "src/scene/cube-model.ts", "src/scene/playback.ts",
].filter(existsSync);
const hashes = () => Object.fromEntries(sourceFiles.map((file) => [file,
  createHash("sha256").update(readFileSync(file)).digest("hex")]));
const sources = hashes();
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const algorithm = (moves: readonly Move[]) => moves.map((move) => move.notation).join(" ");
function rng(initial: number) {
  let state = initial >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
}
function scramble(initial: number) {
  const next = rng(initial), result: string[] = [];
  let previousAxis = -1;
  while (result.length < scrambleLength) {
    const face = next() % 6, axis = face % 3;
    if (axis === previousAxis) continue;
    result.push(FACES[face] + ["", "'", "2"][next() % 3]); previousAxis = axis;
  }
  return result.join(" ");
}
const nextSeed = rng(seed);
const generatedCases = [{ id: "solved", seed: null as number | null, scramble: "", state: SOLVED },
  ...Array.from({ length: scrambleCount }, (_, index) => {
    const caseSeed = nextSeed(), text = scramble(caseSeed);
    return { id: `random-${String(index + 1).padStart(2, "0")}`, seed: caseSeed, scramble: text,
      state: applyAlgorithm(SOLVED, text) };
  })];
const cases: typeof generatedCases = replay ? replay.cases : generatedCases;
if (replay) assert(cases.length === 33 && cases.every((item) => replay.results.some((row: any) =>
  row.id === item.id && row.state === item.state && row.variant && row.plan)), "原语料未保存全部 33 个解法和执行方案。");
assert(new Set(cases.map((item) => item.state)).size === cases.length, "语料出现重复局面。");

// Independent quaternion-based permutation: does not use core's quarter-turn
// permutation or moveAffects. Unique labels also detect otherwise invisible
// permutations among equal-colored stickers.
const slotKey = (position: number[], normal: number[]) => `${position.join(",")}/${normal.join(",")}`;
const slotIndex = new Map(SLOTS.map((slot) => [slotKey(slot.position, slot.normal), slot.index]));
const labels = SLOTS.map((_, index) => String.fromCharCode(0x100 + index)).join("");
function geometricMove(state: string, move: Move) {
  const axis = new Vector3(...NORMALS[move.face]), rotation = new Quaternion().setFromAxisAngle(axis, moveAngle(move));
  const result = Array<string>(54), used = new Set<number>();
  for (const slot of SLOTS) {
    const position = new Vector3(...slot.position), normal = new Vector3(...slot.normal);
    if ((move.layers ?? [1]).includes(Math.round(position.dot(axis)) as -1 | 0 | 1)) {
      position.applyQuaternion(rotation); normal.applyQuaternion(rotation);
    }
    const destination = slotIndex.get(slotKey(position.toArray().map(Math.round), normal.toArray().map(Math.round)));
    assert(destination !== undefined && !used.has(destination), `54 格空间置换非双射：${move.notation}`);
    used.add(destination!); result[destination!] = state[slot.index];
  }
  return result.join("");
}
function permutationCheck(initial: string, moves: Move[]) {
  const expected = snapshots(initial, moves), expectedLabels = snapshots(labels, moves);
  let state = initial, identity = labels;
  moves.forEach((move, index) => {
    state = geometricMove(state, move); identity = geometricMove(identity, move);
    assert(state === expected[index + 1], `54 格颜色置换不一致：${index} ${move.notation}`);
    assert(identity === expectedLabels[index + 1], `54 个独立贴片置换不一致：${index} ${move.notation}`);
  });
  return { state, labels: identity, steps: moves.length, checkedColorSlots: 54 * moves.length,
    checkedUniqueSlots: 54 * moves.length };
}
const cube = new CubeModel();
function rendered(state: string, frame?: MotionFrame, move?: Move) {
  cube.update(state, DEFAULT_PALETTE, frame?.orientation ?? new Quaternion(), move, frame?.angle ?? 0);
  cube.root.updateMatrixWorld(true);
  const result: string[] = [];
  cube.root.traverse((node) => {
    if (node instanceof Mesh && node.name.startsWith("sticker-")) {
      const position = node.getWorldPosition(new Vector3()).toArray().map((n) => Math.round(n * 1e5));
      const normal = new Vector3(0, 0, 1).applyQuaternion(node.getWorldQuaternion(new Quaternion())).toArray().map((n) => Math.round(n * 1e5));
      result.push(`${position.join(",")}/${normal.join(",")}:${(node.material as MeshStandardMaterial).color.getHexString()}`);
    }
  });
  assert(result.length === 54, "渲染模型未包含 54 个贴片。");
  return result.sort().join("|");
}
function gap(a: { left: HandPose; right: HandPose }, b: { left: HandPose; right: HandPose }) {
  return {
    positionMM: Math.max(...sides.map((side) => a[side].position.distanceTo(b[side].position))) * 1000,
    wristRadians: Math.max(...sides.map((side) => a[side].quaternion.angleTo(b[side].quaternion))),
    jointRadians: Math.max(0, ...sides.flatMap((side) => {
      const keys = new Set([...Object.keys(a[side].joints ?? {}), ...Object.keys(b[side].joints ?? {})]);
      return [...keys].map((key) => Math.abs((a[side].joints?.[key] ?? NaN) - (b[side].joints?.[key] ?? NaN)));
    })),
  };
}
function publicChecks(initial: string, program: FingerProgram) {
  const moves = program.steps.map((step) => step.move), states = snapshots(initial, moves);
  let maxSeamMM = 0, maxSeamWristRadians = 0, maxSeamJointRadians = 0;
  for (let i = 1; i < program.segments.length; i++) {
    const d = gap(program.segments[i - 1].sample(1), program.segments[i].sample(0));
    maxSeamMM = Math.max(maxSeamMM, d.positionMM);
    maxSeamWristRadians = Math.max(maxSeamWristRadians, d.wristRadians);
    maxSeamJointRadians = Math.max(maxSeamJointRadians, d.jointRadians);
    assert(d.positionMM < 1e-6 && d.wristRadians < 1e-7 && d.jointRadians < 1e-8,
      `姿态接缝断开：segment ${i} ${JSON.stringify(d)}`);
  }
  let commits = 0;
  for (let i = 0; i < program.steps.length; i++) {
    const end = program.steps[i + 1]?.start ?? program.duration;
    const before = program.sample(end - 1e-10), after = program.sample(end);
    assert(before.index === i && after.index === i + 1, `公共采样器提交索引错误：${i} -> ${before.index}/${after.index}`);
    assert(rendered(states[before.index], before, moves[before.index]) === rendered(states[after.index], after, moves[after.index]),
      `54 贴片提交出现跳变：step ${i} ${moves[i].notation}`);
    commits++;
  }
  const final = program.sample(program.duration);
  assert(final.complete && final.index === moves.length && states[final.index] === SOLVED, "公共采样器没有结束于完整还原状态。");
  assert(rendered(states[final.index], final) === rendered(SOLVED), "最后的 54 贴片或中心朝向没有回归原始朝向。");
  return { passed: true, commits, renderedSlotsAtCommits: commits * 54 * 2, finalSlots: 54,
    maxSeamMM, maxSeamWristRadians, maxSeamJointRadians };
}
function measuredPath(program: FingerProgram) {
  let leftM = 0, rightM = 0, maxHandMetricM = 0;
  const handDistance = (a: HandPose, b: HandPose) => a.position.distanceTo(b.position)
    + 0.07 * a.quaternion.angleTo(b.quaternion)
    + 0.025 * Math.max(0, ...Object.keys(a.joints ?? {}).map((key) => Math.abs(a.joints![key] - (b.joints?.[key] ?? 0))));
  for (const segment of program.segments) {
    let previous = segment.sample(0);
    for (let j = 1; j <= divisions; j++) {
      const current = segment.sample(j / divisions);
      leftM += previous.left.position.distanceTo(current.left.position);
      rightM += previous.right.position.distanceTo(current.right.position);
      maxHandMetricM += Math.max(handDistance(previous.left, current.left), handDistance(previous.right, current.right),
        0.045 * Math.abs(current.angle - previous.angle));
      previous = current;
    }
  }
  return { leftM, rightM, totalM: leftM + rightM, maxHandMetricM, segments: program.segments.length, subdivisions: divisions };
}
function cadenceChecks(program: FingerProgram) {
  const turns = program.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment.stage === "TURN");
  const durations = turns.map(({ segment }) => segment.duration);
  assert(program.steps.length ? Math.abs(program.duration - 5) < 1e-10 : program.duration === 0,
    "非空竞速未保持 5 秒，或空解法未立即完成。");
  assert(durations.every((duration) => duration >= floor - 1e-10), "TURN 时长未达到 2.05/60 秒下限。");
  const fingers: Record<string, number> = {}, driveFingers: Record<string, number> = {};
  let wristTurns = 0, rotationTurns = 0;
  for (const { segment, index } of turns) {
    const frame = program.sample(segment.start + segment.duration / 2), move = program.steps[frame.index].move;
    assert(frame.stage === "TURN" && frame.index === segment.index && frame.active === segment.active && frame.activeFinger === segment.finger,
      `TURN 元数据不一致：segment ${index}`);
    const contacts = (frame.contacts ?? []).filter((contact) => contact.role === "drive");
    assert(contacts.length > 0 && contacts.every((contact) => contact.side === frame.active), `驱动手不一致：segment ${index}`);
    for (const contact of contacts) driveFingers[`${contact.side}:${contact.finger}`] = (driveFingers[`${contact.side}:${contact.finger}`] ?? 0) + 1;
    if (frame.activeFinger !== undefined) {
      assert(contacts.every((contact) => contact.finger === frame.activeFinger), `指法标签和驱动触点不一致：segment ${index}`);
      const key = `${frame.active}:${frame.activeFinger}`; fingers[key] = (fingers[key] ?? 0) + 1;
    } else if (move.kind === "rotation") rotationTurns++; else wristTurns++;
  }
  const frames = offsets.map((offset) => {
    const counts = new Map(turns.map(({ index }) => [index, 0]));
    let segmentIndex = 0;
    for (let frameIndex = 0; (frameIndex + offset) / 60 < program.duration; frameIndex++) {
      const time = (frameIndex + offset) / 60;
      while (segmentIndex + 1 < program.segments.length && program.segments[segmentIndex + 1].start <= time) segmentIndex++;
      if (!program.segments.length) break;
      const current = program.sample(time), segment = program.segments[segmentIndex];
      if (current.stage === "TURN" && time > segment.start + 1e-10 && time < segment.start + segment.duration - 1e-10)
        counts.set(segmentIndex, (counts.get(segmentIndex) ?? 0) + 1);
    }
    const values = [...counts.values()];
    assert(values.every((count) => count >= 2), `理想 60 Hz 相位 ${offset} 存在少于两帧的 TURN。`);
    return { offsetFrames: offset, minimum: values.length ? Math.min(...values) : null,
      median: quantile(values, 0.5), zero: values.filter((n) => n === 0).length, one: values.filter((n) => n === 1).length };
  });
  return { duration: program.duration, turns: turns.length, minTurnSeconds: durations.length ? Math.min(...durations) : null,
    medianTurnSeconds: quantile(durations, 0.5), ideal60Hz: frames, fingerTurnsBySide: fingers,
    allDriveContactsBySide: driveFingers, fingers: [...new Set(Object.keys(fingers).map((key) => Number(key.split(":")[1])))].sort(),
    wristTurns, rotationTurns };
}
function quantile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b), at = (sorted.length - 1) * fraction;
  return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at - Math.floor(at));
}
function stats(values: number[]) {
  return { count: values.length, min: values.length ? Math.min(...values) : null, median: quantile(values, 0.5),
    p90: quantile(values, 0.9), max: values.length ? Math.max(...values) : null };
}
const reduction = (before: number, after: number) => before > 0 ? (1 - after / before) * 100 : null;
mkdirSync("evidence", { recursive: true });
const metadata = { startedAt, command: "nice -n 10 npx tsx scripts/competitive-corpus.ts" + (replayPath ? ` --replay '${replayPath}'` : ""), sources,
  replayOf: replayPath ?? null, priorOutcome: replay?.summary,
  changedSourcesSincePrior: replay ? sourceFiles.filter((file) => replay.sources[file] !== sources[file]) : [],
  replayContract: replay ? "Reuses all 33 saved solutions, phase boundaries and actual execution variants; does not run solver or reorientation search. Revalidates persisted variants, compilation, cadence, all public commits/seams, independent 54-sticker permutation and paths. Prior successful path measurements are compared exactly within floating-point tolerance." : null,
  generator: { name: "xorshift32", seed, seedHex: `0x${seed.toString(16)}`, scrambleCount, scrambleLength,
    constraint: "Outer quarter/prime/half turns; no consecutive turns of the same axis. Seeds are adjacent states of the same xorshift sequence, so scrambles can share long subsequences. These are 32 distinct legal states, not independent or uniform random-state sampling." },
  scope: "32 deterministic legal scrambles plus SOLVED; current production competitive solver, actual y plan, persisted variant validator, compiler and 5-second retimer. All 54 positions and unique sticker permutations, actual public sampler commits, ideal 60 Hz offsets. No new STL/FK sweep, browser or hardware evidence.",
  pathMetric: "Sum of left and right wrist translations, 128 subdivisions per original segment. Also records max(left/right translation + 0.07*wrist radians + 0.025*max joint radians, 0.045*cube angle). Same new source solution for old/new fixed comparison; actual y plan additionally includes every rotation and return.",
  cases };
writeFileSync(`${stem}-manifest.json`, JSON.stringify(metadata, null, 2) + "\n");
const results: any[] = [];
for (const item of cases) {
  const start = performance.now(), timings: Record<string, number> = {}, result: any = { ...item, timings, passed: false };
  let stage = "input";
  const timed = <T>(name: string, action: () => T): T => { stage = name; const at = performance.now();
    try { return action(); } finally { timings[name] = performance.now() - at; } };
  try {
    const previous = replay?.results.find((row: any) => row.id === item.id);
    timed("input", () => {
      assert(validateFacelets(item.state).valid, "打乱不是合法局面。");
      const input = permutationCheck(SOLVED, parseAlgorithm(item.scramble));
      assert(input.state === item.state, "独立打乱与输入不一致。"); result.inputCheck = input;
    });
    const solved = previous ? timed("reuseSavedSolve", () => ({ solution: previous.solution,
      phases: previous.phases, search: previous.search })) : timed("solve", () => solveCompetitiveCFOP(item.state,
      { gestureCost: (text) => competitivePhraseCost(parseAlgorithm(text)) }));
    result.solution = solved.solution; result.phases = solved.phases; result.search = solved.search;
    const source = parseAlgorithm(solved.solution);
    const plan = previous ? timed("reuseSavedPlan", () => ({ ...previous.plan,
      moves: parseAlgorithm(previous.plan.moves) })) : timed("plan", () => planCompetitiveExecution(source));
    result.plan = { ...plan, moves: algorithm(plan.moves) };
    const variant = timed("variant", () => {
      const value = competitionVariant(item.state, solved, plan);
      const restored = readCompetitionVariant(item.state, JSON.parse(JSON.stringify(value)));
      assert(JSON.stringify(value) === JSON.stringify(restored), "保存后的竞速方案发生改变。");
      if (previous) assert(JSON.stringify(restored) === JSON.stringify(readCompetitionVariant(item.state, previous.variant)),
        "复验没有沿用原来的完整 variant。");
      return restored;
    });
    result.variant = variant;
    timed("permutations", () => {
      const a = permutationCheck(item.state, source), b = permutationCheck(item.state, plan.moves);
      assert(a.state === SOLVED && b.state === SOLVED && a.labels === b.labels, "新解法和物理换面编排未完全等价还原 54 格。");
      assert(plan.yawAtBoundary.at(-1) === 0, "物理中心朝向未复位。");
      const states = snapshots(item.state, source);
      const phases = solved.phases.map((phase) => ({ name: phase.name, end: phase.end,
        passed: isCFOPPhaseSolved(states[phase.end], phase.name) }));
      assert(phases.every((phase) => phase.passed), "CFOP 阶段边界错误。");
      result.permutations = { passed: true, source: a, execution: b, phases };
    });
    const old = timed("compileOldSameSolution", () => compileFingerSolve(source, 5));
    const fixed = timed("compileNewSameSolution", () => compileCompetitiveExecution(source, 5));
    const planned = timed("compileNewExecution", () => compileCompetitiveExecution(plan.moves, 5));
    assert(algorithm(planned.steps.map((step) => step.move)) === variant.execution.algorithm, "实际编译器未执行持久化方案中的动作。");
    result.compilation = { sourceSteps: source.length, executionSteps: planned.steps.length,
      rotationCount: plan.rotationCount, statistics: planned.statistics, removedSegments: planned.removedSegments,
      cost: { old: old.cost, fixed: fixed.cost, planned: planned.cost } };
    const retimed = timed("retime", () => retimeFingerProgram(planned));
    result.cadence = timed("cadenceValidation", () => cadenceChecks(retimed));
    assert(result.cadence.rotationTurns === plan.rotationCount, "TURN 转体次数与换面规划不一致。");
    result.publicSampler = timed("publicSamplerValidation", () => publicChecks(item.state, retimed));
    result.path = timed("measurePaths", () => {
      const oldPath = measuredPath(old), newFixed = measuredPath(fixed), newPlanned = measuredPath(planned);
      return { oldSameSolution: oldPath, newSameSolution: newFixed, newPlanned,
        compilerReductionPercent: reduction(oldPath.totalM, newFixed.totalM),
        withPhysicalYReductionPercent: reduction(oldPath.totalM, newPlanned.totalM),
        physicalYVsNewFixedReductionPercent: reduction(newFixed.totalM, newPlanned.totalM) };
    });
    if (previous?.path) {
      const metrics = ["leftM", "rightM", "totalM", "maxHandMetricM"];
      const comparisons = ["oldSameSolution", "newSameSolution", "newPlanned"].map((key) => ({ key,
        maxDifferenceM: Math.max(...metrics.map((metric) => Math.abs(result.path[key][metric] - previous.path[key][metric]))),
        sameSegments: result.path[key].segments === previous.path[key].segments }));
      assert(comparisons.every((row) => row.sameSegments && row.maxDifferenceM < 1e-8), "边界修复前后空间路径测量不一致。");
      result.priorPathCheck = { passed: true, comparisons };
    }
    result.passed = true;
  } catch (error) {
    result.error = { stage, message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined };
  }
  timings.total = performance.now() - start;
  results.push(result); appendFileSync(`${stem}.jsonl`, JSON.stringify(result) + "\n");
  console.log(JSON.stringify({ id: item.id, passed: result.passed, totalMS: timings.total,
    steps: result.compilation?.sourceSteps, rotations: result.compilation?.rotationCount,
    minTurnMS: result.cadence?.minTurnSeconds == null ? null : result.cadence.minTurnSeconds * 1000,
    fingers: result.cadence?.fingers, wristReductionPercent: result.path?.withPhysicalYReductionPercent,
    error: result.error }));
}
cube.dispose();
const finalSources = hashes(), sourceDrift = sourceFiles.filter((file) => sources[file] !== finalSources[file]);
const passed = results.filter((result) => result.passed), random = passed.filter((result) => result.id !== "solved");
const totalOldM = random.reduce((sum, result) => sum + result.path.oldSameSolution.totalM, 0);
const totalFixedM = random.reduce((sum, result) => sum + result.path.newSameSolution.totalM, 0);
const totalPlannedM = random.reduce((sum, result) => sum + result.path.newPlanned.totalM, 0);
const summary = { passed: passed.length === cases.length && !sourceDrift.length,
  cases: cases.length, successfulCases: passed.length, failures: results.filter((result) => !result.passed).map(({ id, error }) => ({ id, error })),
  sourceDrift, sourcesStable: !sourceDrift.length,
  reusedCases: replay ? results.length : 0, solverRuns: replay ? 0 : results.length,
  priorPathsCompared: passed.filter((result) => result.priorPathCheck).length,
  maximumPriorPathDifferenceM: Math.max(0, ...passed.flatMap((result) => result.priorPathCheck?.comparisons.map((row: any) => row.maxDifferenceM) ?? [])),
  sourceSteps: stats(random.map((result) => result.compilation.sourceSteps)),
  executionSteps: stats(random.map((result) => result.compilation.executionSteps)),
  rotationCount: stats(random.map((result) => result.compilation.rotationCount)),
  casesWithRotations: random.filter((result) => result.compilation.rotationCount > 0).length,
  minTurnSeconds: stats(random.map((result) => result.cadence.minTurnSeconds)),
  drivenFingers: [...new Set(random.flatMap((result) => result.cadence.fingers))].sort(),
  casesWithAllFiveFingers: random.filter((result) => result.cadence.fingers.length === 5).length,
  ideal60HzMinimum: random.length ? Math.min(...random.flatMap((result) => result.cadence.ideal60Hz.map((row: any) => row.minimum))) : null,
  publicSamplerCommits: passed.reduce((sum, result) => sum + result.publicSampler.commits, 0),
  timingsMS: Object.fromEntries([...new Set(results.flatMap((result) => Object.keys(result.timings)))].map((key) =>
    [key, stats(results.map((result) => result.timings[key]).filter((value) => value !== undefined))])),
  wristPathsM: { oldSameNewSolution: totalOldM, newFixedSameNewSolution: totalFixedM, newPhysicalY: totalPlannedM,
    totalCompilerReductionPercent: reduction(totalOldM, totalFixedM), totalWithPhysicalYReductionPercent: reduction(totalOldM, totalPlannedM),
    compilerReductionPercent: stats(random.map((result) => result.path.compilerReductionPercent)),
    withPhysicalYReductionPercent: stats(random.map((result) => result.path.withPhysicalYReductionPercent)),
    physicalYVsNewFixedReductionPercent: stats(random.map((result) => result.path.physicalYVsNewFixedReductionPercent)),
    worseThanOld: random.filter((result) => result.path.withPhysicalYReductionPercent < -1e-7).map((result) => result.id),
    physicalYWorseThanFixed: random.filter((result) => result.path.physicalYVsNewFixedReductionPercent < -1e-7).map((result) => result.id) } };
const finishedAt = new Date().toISOString();
writeFileSync(`${stem}.json`, JSON.stringify({ ...metadata, finishedAt, finalSources, summary, results }, null, 2) + "\n");
const format = (n: number | null, digits = 2) => n === null ? "n/a" : n.toFixed(digits);
writeFileSync(`${stem}.md`, `# 竞速合法局面语料验收\n\n- 时间：${startedAt} — ${finishedAt}。固定种子 ${metadata.generator.seedHex}；32 个 25 步合法打乱，加已还原局面。单进程串行。\n- 结果：${summary.successfulCases}/${summary.cases}；源文件哈希${summary.sourcesStable ? "稳定" : "发生变化"}。最终通过：${summary.passed}。${replay ? `首次结果 ${replay.summary.successfulCases}/${replay.summary.cases} 的两个失败仍保留；本轮复用 33 个已存 variant，求解/换面搜索运行 0 次。与首次 ${summary.priorPathsCompared} 个已有完整路径记录比较，最大差值 ${summary.maximumPriorPathDifferenceM} m。` : ""}\n- 新解法步骤 ${summary.sourceSteps.min}–${summary.sourceSteps.max}，中位 ${format(summary.sourceSteps.median)}；真实 y/y′ 转体 ${summary.rotationCount.min}–${summary.rotationCount.max} 次，${summary.casesWithRotations}/32 个案例使用转体。\n- 非空播放 5 秒；最短 TURN ${format(summary.minTurnSeconds.min === null ? null : summary.minTurnSeconds.min * 1000, 4)} ms；理想 60 Hz 的四个相位偏移均至少 ${summary.ideal60HzMinimum} 帧。已还原局面立即完成，不伪造 5 秒动作。\n- 指法驱动手指：${summary.drivenFingers.join(", ")}；${summary.casesWithAllFiveFingers}/32 个案例使用全部五指。实际公共采样器核对 ${summary.publicSamplerCommits} 次完整 54 贴片提交，包含中心、位置、法线和颜色。\n- 同一条新解法：旧编译器总双腕路径 ${format(totalOldM)} m，新编译器固定朝向 ${format(totalFixedM)} m（减少 ${format(summary.wristPathsM.totalCompilerReductionPercent)}%），新编译器实际换面 ${format(totalPlannedM)} m（减少 ${format(summary.wristPathsM.totalWithPhysicalYReductionPercent)}%）。每段 128 等分；包括全部进出和转体路径。\n- 逐例失败：${summary.failures.length ? JSON.stringify(summary.failures) : "无"}；源哈希漂移：${sourceDrift.length ? sourceDrift.join(", ") : "无"}。\n\n证据范围：这是确定性合法打乱的有限语料，不是所有合法魔方局面的穷尽证明；种子来自相邻 xorshift 状态，部分打乱有长子串重叠，32 个局面互异但并非独立或均匀随机状态。60 Hz 结果是理想时间采样，不代表浏览器实际帧率或硬件速度。本轮没有重跑 STL、力学、碰撞、真实设备或浏览器验收。腕部路程不是视觉流畅度的充分条件，也不是全局最优解证明。每例的原始解法、阶段、真实 y 编排、variant、时间、路径与失败保存在同名前缀 JSON/JSONL；manifest 保存运行前源哈希与全部输入。\n\n运行：\`${metadata.command}\`\n`);
console.log(JSON.stringify({ evidence: `${stem}.json`, summary }, null, 2));
if (!summary.passed) process.exitCode = 1;
