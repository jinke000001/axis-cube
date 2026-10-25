/** Bounded, pure R/L/U-only F2L prototype. No application code is changed. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { applyAlgorithm, FACES, SLOTS, SOLVED, parseAlgorithm, validateFacelets, type Face } from "../src/core/cube";
import { solveCFOP, isCFOPPhaseSolved } from "../src/core/cfop";

const definitions = [
  { id: "FR", corner: "DFR", edge: "FR", open: "R", close: "R'" },
  { id: "BR", corner: "DBR", edge: "BR", open: "R'", close: "R" },
  { id: "FL", corner: "DFL", edge: "FL", open: "L'", close: "L" },
  { id: "BL", corner: "DBL", edge: "BL", open: "L", close: "L'" },
] as const;
type PairId = typeof definitions[number]["id"];
const groups = [...new Set(SLOTS.map((s) => s.position.join(",")))].map((key) => SLOTS.filter((s) => s.position.join(",") === key).map((s) => s.index));
const crossIndices = SLOTS.filter((s) => s.position[1] === -1 && Math.abs(s.position[0]) + Math.abs(s.position[2]) === 1).map((s) => s.index);
const sorted = (text: string) => [...text].sort().join("");
function piece(state: string, colors: string) {
  const slots = groups.find((g) => g.length === colors.length && sorted(g.map((i) => state[i]).join("")) === sorted(colors));
  if (!slots) throw new Error(`Missing cubie ${colors}`);
  return [...colors].map((color) => slots.find((i) => state[i] === color)!);
}
const pairTuple = (state: string, index: number) => [...piece(state, definitions[index].corner), ...piece(state, definitions[index].edge)];
const goals = definitions.map((_d, i) => pairTuple(SOLVED, i));
const solvedPair = (state: string, index: number) => goals[index].every((i) => state[i] === SOLVED[i]);
const key = (values: number[]) => values.join(",");
const labels = Array.from({ length: 54 }, (_, i) => String.fromCharCode(33 + i)).join("");
function permutation(algorithm: string) {
  const after = applyAlgorithm(labels, algorithm);
  return [...labels].map((label) => after.indexOf(label));
}
const macros = [
  ...definitions.flatMap((d, slot) => ["U", "U'"].map((middle) => ({ id: `${d.id}:${middle}`, slot, algorithm: `${d.open} ${middle} ${d.close}`, permutation: permutation(`${d.open} ${middle} ${d.close}`) }))),
  ...["U", "U'", "U2"].map((algorithm) => ({ id: algorithm, slot: -1, algorithm, permutation: permutation(algorithm) })),
];
const macroInverse = macros.map((macro) => macros.findIndex((candidate) => macro.permutation.every((to, from) => candidate.permutation[to] === from)));
if (macroInverse.some((i) => i < 0)) throw new Error("Macro set is not inverse closed.");
export const generatorChecks = macros.map((macro) => ({
  id: macro.id, algorithm: macro.algorithm,
  fixesCrossStickerIdentities: crossIndices.every((i) => macro.permutation[i] === i),
  fixesEveryOtherF2LSlot: goals.every((indices, i) => i === macro.slot || indices.every((index) => macro.permutation[index] === index)),
}));
if (generatorChecks.some((c) => !c.fixesCrossStickerIdentities || !c.fixesEveryOtherF2LSlot)) throw new Error("Macro contract failed.");

// A stronger necessary condition than the restricted macros: exhaust the exact
// orbit of each goal edge under every raw R/L/U quarter and half turn.
const rawPermutations = ["R", "R'", "R2", "L", "L'", "L2", "U", "U'", "U2"].map(permutation);
function orbit(start: number[], permutations: number[][]) {
  const states = [start], seen = new Set([key(start)]);
  for (let at = 0; at < states.length; at++) for (const perm of permutations) {
    const next = states[at].map((i) => perm[i]), id = key(next);
    if (!seen.has(id)) { seen.add(id); states.push(next); }
  }
  return { states, keys: seen };
}
const edgeOrbits = definitions.map((d) => orbit(piece(SOLVED, d.edge), rawPermutations));
const ORDERS = [[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0],[0,2,1,3],[1,3,0,2]];
export interface RULOptions { maxMacroDepth?: number; maxNodesPerPair?: number; maxNodesPerCase?: number; pairOrderCount?: number; }
interface PairSegment { target: PairId; lockedBefore: PairId[]; algorithm: string; macros: string[]; before: string; after: string; }
export interface RULResult {
  solved: boolean; algorithm: string; after: string; segments: PairSegment[];
  reason?: string; unreachableEdges?: { edge: string; actualSlots: number[]; goalSlots: number[]; rawRLUOrbitSize: number }[];
  nodes: number; attemptedOrders: number; limits: Required<RULOptions>; failedOrders?: unknown[];
}
function simplify(tokens: string[]) {
  const out: ReturnType<typeof parseAlgorithm> = [];
  for (const move of parseAlgorithm(tokens.join(" "))) {
    const previous = out.at(-1);
    if (previous?.face === move.face) {
      const turns = (previous.turns + move.turns) % 4; out.pop();
      if (turns) out.push({ face: move.face, turns: turns as 1|2|3, notation: move.face + (turns === 2 ? "2" : turns === 3 ? "'" : "") });
    } else out.push(move);
  }
  return out.map((m) => m.notation).join(" ");
}

/** Deterministic bounded prototype: input must have the fixed D cross solved.
 * Guarantees apply at macro/pair boundaries, not after each constituent R/L.
 * No timing, random state or global search cache affects this function's result.
 */
export function solveF2LRUL(state: string, options: RULOptions = {}): RULResult {
  const bound = (value: number|undefined, ceiling: number, minimum = 0) => Number.isFinite(value) ? Math.max(minimum, Math.min(ceiling, Math.floor(value!))) : ceiling;
  const limits: Required<RULOptions> = { maxMacroDepth: bound(options.maxMacroDepth,12), maxNodesPerPair: bound(options.maxNodesPerPair,512), maxNodesPerCase: bound(options.maxNodesPerCase,6000), pairOrderCount: bound(options.pairOrderCount,6,1) };
  const result = (reason: string): RULResult => ({ solved: false, reason, algorithm: "", after: state, segments: [], nodes: 0, attemptedOrders: 0, limits });
  if (!validateFacelets(state).valid) return result("invalid-state");
  if (!isCFOPPhaseSolved(state, "cross")) return result("D-cross-not-solved");
  const unreachableEdges = definitions.flatMap((d, i) => {
    const actualSlots = piece(state, d.edge);
    return edgeOrbits[i].keys.has(key(actualSlots)) ? [] : [{ edge: d.edge, actualSlots, goalSlots: piece(SOLVED, d.edge), rawRLUOrbitSize: edgeOrbits[i].states.length }];
  });
  if (unreachableEdges.length) return { ...result("edge-outside-exhaustive-raw-RLU-orbit"), unreachableEdges };
  type Node = { state: number[]; depth: number; next?: string; towardGoal?: number };
  const tables = new Map<string, { nodes: Map<string, Node>; truncated: boolean }>();
  let totalNodes = 0;
  function table(target: number, locked: Set<number>) {
    const tableKey = `${target}/${[...locked].sort().join("")}`;
    if (tables.has(tableKey)) return tables.get(tableKey)!;
    if (totalNodes >= limits.maxNodesPerCase || limits.maxNodesPerPair === 0) {
      const output = { nodes: new Map<string,Node>(), truncated: true }; tables.set(tableKey, output); return output;
    }
    const start: Node = { state: goals[target], depth: 0 }, nodes = new Map([[key(start.state), start]]), queue = [start];
    const allowed = macros.map((m, i) => ({ ...m, index: i })).filter((m) => !locked.has(m.slot));
    let truncated = false; totalNodes++;
    for (let at = 0; at < queue.length; at++) {
      const node = queue[at];
      if (node.depth >= limits.maxMacroDepth) { truncated = true; continue; }
      for (const macro of allowed) {
        const nextState = node.state.map((i) => macro.permutation[i]), nextKey = key(nextState);
        if (nodes.has(nextKey)) continue;
        if (nodes.size >= limits.maxNodesPerPair || totalNodes >= limits.maxNodesPerCase) { truncated = true; break; }
        const next = { state: nextState, depth: node.depth + 1, next: key(node.state), towardGoal: macroInverse[macro.index] };
        nodes.set(nextKey, next); queue.push(next); totalNodes++;
      }
    }
    const output = { nodes, truncated }; tables.set(tableKey, output); return output;
  }
  const candidates: RULResult[] = [], failedOrders: unknown[] = [];
  for (const order of ORDERS.slice(0, limits.pairOrderCount)) {
    let current = state;
    const locked = new Set(definitions.flatMap((_d, i) => solvedPair(current, i) ? [i] : []));
    const segments: PairSegment[] = []; let failure = "";
    for (const target of order) {
      if (locked.has(target)) continue;
      const graph = table(target, locked), path: number[] = [];
      let currentKey = key(pairTuple(current, target)), node = graph.nodes.get(currentKey);
      if (!node) { failure = graph.truncated ? "bounded-pair-search-exhausted" : "pair-outside-exhaustive-macro-orbit"; break; }
      while (node.next !== undefined) { path.push(node.towardGoal!); currentKey = node.next; node = graph.nodes.get(currentKey)!; }
      const before = current, lockedBefore = [...locked].map((i) => definitions[i].id);
      for (const id of path) {
        if (locked.has(macros[id].slot)) throw new Error("Locked slot eject used.");
        current = applyAlgorithm(current, macros[id].algorithm);
        if (!isCFOPPhaseSolved(current, "cross") || [...locked].some((i) => !solvedPair(current, i))) throw new Error("Macro violated locked geometry.");
      }
      const algorithm = simplify(path.map((i) => macros[i].algorithm));
      if (!solvedPair(current, target) || applyAlgorithm(before, algorithm) !== current) throw new Error("Projected search did not match full cube replay.");
      segments.push({ target: definitions[target].id, lockedBefore, algorithm, macros: path.map((i) => macros[i].id), before, after: current });
      definitions.forEach((_d, i) => { if (solvedPair(current, i)) locked.add(i); });
    }
    if (failure) failedOrders.push({ order: order.map((i) => definitions[i].id), reason: failure, segments });
    else if (isCFOPPhaseSolved(current, "f2l")) candidates.push({ solved: true, algorithm: segments.map((s) => s.algorithm).filter(Boolean).join(" "), after: current, segments, nodes: totalNodes, attemptedOrders: limits.pairOrderCount, limits });
    else throw new Error("Completed pair order failed independent F2L predicate.");
  }
  candidates.sort((a, b) => parseAlgorithm(a.algorithm).length - parseAlgorithm(b.algorithm).length);
  return candidates.length ? { ...candidates[0], nodes: totalNodes, failedOrders } : { ...result("all-bounded-pair-orders-failed"), nodes: totalNodes, attemptedOrders: limits.pairOrderCount, failedOrders };
}

function counts(algorithm: string) {
  const moves = parseAlgorithm(algorithm), faceCounts: Partial<Record<Face, number>> = {};
  moves.forEach((m) => { faceCounts[m.face] = (faceCounts[m.face] ?? 0) + 1; });
  return { htm: moves.length, qtm: moves.reduce((sum, m) => sum + (m.turns === 2 ? 2 : 1), 0), distinctFaces: Object.keys(faceCounts).length, faceCounts, frontBackDownTurns: moves.filter((m) => !["R", "L", "U"].includes(m.face)).length };
}
function runProbe() {
  const count = process.argv.includes("--cases") ? Number(process.argv[process.argv.indexOf("--cases") + 1]) : 32;
  let seed = 0xc0ffee;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
  const cases: any[] = [];
  for (let index = 0; index < count; index++) {
    let previous = -1;
    const scramble = Array.from({ length: 25 }, () => { let face: number; do { face = Math.floor(random() * 6); } while (face === previous); previous = face; return FACES[face] + ["", "'", "2"][Math.floor(random() * 3)]; }).join(" ");
    const initial = applyAlgorithm(SOLVED, scramble), baselineStart = performance.now(), cfop = solveCFOP(initial), baselineMs = performance.now() - baselineStart;
    const cross = cfop.phases.find((p) => p.name === "cross")!, f2l = cfop.phases.find((p) => p.name === "f2l")!;
    const afterCross = applyAlgorithm(initial, cross.algorithm), start = performance.now(), candidate = solveF2LRUL(afterCross), elapsedMs = performance.now() - start;
    const verified = candidate.solved && isCFOPPhaseSolved(applyAlgorithm(afterCross, candidate.algorithm), "f2l");
    cases.push({ index, scramble, initial, crossAlgorithm: cross.algorithm, afterCross, baseline: { algorithm: f2l.algorithm, ...counts(f2l.algorithm), fullCFOPMs: baselineMs }, candidate: { ...candidate, elapsedMs, counts: candidate.solved ? counts(candidate.algorithm) : undefined }, verified });
  }
  const controls = ["R U R'", "L' U' L", "R U R' U2 L U' L' U R' U R L' U L"].map((algorithm) => {
    const state = applyAlgorithm(SOLVED, algorithm), start = performance.now(), result = solveF2LRUL(state);
    return { algorithm, state, result, elapsedMs: performance.now() - start, verified: result.solved && isCFOPPhaseSolved(applyAlgorithm(state, result.algorithm), "f2l") };
  });
  const successful = cases.filter((c) => c.verified), average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const output = { date: new Date().toISOString(), scriptSHA256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"), seed: "0xc0ffee", count, generatorChecks, exhaustiveRawRLUEdgeOrbits: definitions.map((d, i) => ({ edge: d.edge, goal: piece(SOLVED, d.edge), states: edgeOrbits[i].states })),
    summary: { solved: successful.length, attempted: count, invariantFailures: cases.filter((c) => c.candidate.reason === "edge-outside-exhaustive-raw-RLU-orbit").length, boundedSearchFailures: cases.filter((c) => !c.verified && c.candidate.reason !== "edge-outside-exhaustive-raw-RLU-orbit").length, allControlsPassed: controls.every((c) => c.verified), candidateMeanMs: average(cases.map((c) => c.candidate.elapsedMs)), candidateMaxMs: Math.max(...cases.map((c) => c.candidate.elapsedMs)), successfulMeanHTM: average(successful.map((c) => c.candidate.counts.htm)), sameSuccessfulBaselineMeanHTM: average(successful.map((c) => c.baseline.htm)), baselineAllMeanHTM: average(cases.map((c) => c.baseline.htm)), baselineAllMeanFrontBackDown: average(cases.map((c) => c.baseline.frontBackDownTurns)), baselineFullCFOPMeanMs: average(cases.map((c) => c.baseline.fullCFOPMs)), maxExpandedNodes: Math.max(...cases.map((c) => c.candidate.nodes)), firstFailureIndex: cases.find((c) => !c.verified)?.index },
    cases, controls,
    limitations: ["Only F2L after the existing selected D-cross is evaluated; OLL/PLL and animation are unchanged.", "The prototype is bounded by macro depth 12, 512 projected nodes per pair, 6000 nodes per case, and six pair orders.", "The macro BFS optimizes macro count per target, then compares six complete orders by HTM; it is not globally move-optimal or professional fingering.", "Baseline timing includes all four CFOP stages and four frame candidates; candidate timing is F2L-only and is not a like-for-like speedup comparison.", "Locked pair/cross preservation is asserted at every macro boundary, not after each constituent face turn."] };
  writeFileSync("evidence/f2l-rul-results.json", JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output.summary, null, 2));
  console.log(JSON.stringify({ firstFailure: cases.find((c) => !c.verified), controls: controls.map((c) => ({ algorithm: c.algorithm, verified: c.verified, candidate: c.result.algorithm, nodes: c.result.nodes })) }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runProbe();
