/** Lossless recorded-path packing. This script never writes calibration sources. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { cpus, platform, arch } from "node:os";
import { createCompetitiveLibrary, assertExact, packCompetitivePrimitives, type PackedCompetitiveLibrary } from "../src/scene/competitive-library";
import type { RecordedFingerFrame, RecordedFingerPrimitive, RecordedFingerSegment } from "../src/scene/recorded-finger-program";
import type { Side } from "../src/scene/motion";

export const sourcePaths = ["evidence/competitive-thumb-primitives.json", "evidence/competitive-rotation-primitives.json", "evidence/competitive-down-primitives.json"];
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const canonicalFrame = (frame: RecordedFingerFrame): RecordedFingerFrame => ({ left: frame.left, right: frame.right, contacts: frame.contacts, cubeAngle: frame.cubeAngle });
function canonicalSegment(segment: RecordedFingerSegment): RecordedFingerSegment {
  return { id: segment.id, ...(segment.phase === undefined ? {} : { phase: segment.phase }), stage: segment.stage, active: segment.active,
    ...(segment.finger === undefined ? {} : { finger: segment.finger }), ...(segment.weight === undefined ? {} : { weight: segment.weight }), frames: segment.frames.map(canonicalFrame) };
}
export function readCompetitiveSources(requireDown = false) {
  const present = sourcePaths.filter((path, i) => {
    if (existsSync(path)) return true;
    if (i < 2 || requireDown) throw new Error(`Missing accepted primitive source: ${path}`);
    return false;
  });
  const primitives: RecordedFingerPrimitive[] = [];
  for (const path of present) {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (path.includes("rotation")) {
      for (const [notation, segments] of Object.entries(data.primitives) as [string, { id: string; frames: (RecordedFingerFrame & { turning: boolean })[] }[]][]) {
        primitives.push({ notation, rotationContactsInEntryFrame: true, segments: segments.map(segment => {
          const turning = segment.frames.some(frame => frame.turning), active: Side = turning ? notation === "y" ? "left" : "right" : segment.id.startsWith("right") ? "right" : "left";
          return { id: segment.id, active, stage: turning ? "TURN" : "PREPARE", phase: turning ? "持握换面 · 对手预备接应" : `${active === "left" ? "左" : "右"}手顺势接握`, frames: segment.frames.map(canonicalFrame) };
        }) });
      }
    } else for (const item of data.variants ?? data.primitives) primitives.push({ notation: item.notation,
      ...(item.rotationContactsInEntryFrame === undefined ? {} : { rotationContactsInEntryFrame: item.rotationContactsInEntryFrame }), segments: item.segments.map(canonicalSegment) });
  }
  return { primitives, sources: present.map(path => ({ path, sha256: sha(path) })) };
}
function quantiles(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return { minimum: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * .9)] };
}
function benchmark() {
  const { primitives } = readCompetitiveSources(true), baseline = JSON.stringify(primitives), packed = readFileSync("src/scene/competitive-library.json", "utf8");
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) throw new Error("Benchmark requires --expose-gc");
  const names = Object.keys(JSON.parse(packed).byNotation), rounds = 21;
  const operations = {
    rawParse: () => JSON.parse(baseline),
    packedParse: () => JSON.parse(packed),
    packedParseAndDecodeAll: () => { const data = JSON.parse(packed), get = createCompetitiveLibrary(data); return { data, get, primitives: names.flatMap(name => [...get(name)]) }; },
  };
  const timings: Record<string, number[]> = {}, heaps: Record<string, number[]> = {};
  for (const name of Object.keys(operations)) { timings[name] = []; heaps[name] = []; }
  for (let round = -3; round < rounds; round++) for (const name of Object.keys(operations).sort((a, b) => (round % 2 ? a.localeCompare(b) : b.localeCompare(a)))) {
    gc(); const before = process.memoryUsage().heapUsed, start = performance.now();
    let result: unknown = operations[name as keyof typeof operations]();
    const elapsed = performance.now() - start; gc(); const retainedBytes = process.memoryUsage().heapUsed - before;
    if (result === undefined) throw new Error("Missing benchmark result");
    if (round >= 0) { timings[name].push(elapsed); heaps[name].push(retainedBytes); }
    result = undefined;
  }
  return { engine: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, rounds, warmupRounds: 3,
    method: "Local Node/V8, sequential alternating cases, explicit GC outside measured parsing interval; all decoded objects retained through post-GC heap measurement. This is not a browser/mobile/RUM measurement.",
    milliseconds: Object.fromEntries(Object.keys(operations).map(name => [name, quantiles(timings[name])])), retainedHeapBytes: Object.fromEntries(Object.keys(operations).map(name => [name, quantiles(heaps[name])])) };
}
function main() {
  if (process.argv.includes("--benchmark-worker")) { console.log(JSON.stringify(benchmark())); return; }
  const { primitives, sources } = readCompetitiveSources(process.argv.includes("--require-down")), data = packCompetitivePrimitives(primitives, sources);
  const rawText = JSON.stringify(primitives), packedText = JSON.stringify(data), roundTrip = JSON.parse(packedText) as PackedCompetitiveLibrary, get = createCompetitiveLibrary(roundTrip);
  for (const notation of Object.keys(data.byNotation)) assertExact(get(notation), primitives.filter(p => p.notation === notation), notation);
  for (const source of sources) if (sha(source.path) !== source.sha256) throw new Error(`Source changed during packing: ${source.path}`);
  writeFileSync("src/scene/competitive-library.json", packedText + "\n");
  const worker = spawnSync(process.execPath, ["--expose-gc", "--import", "tsx", resolve("scripts/pack-competitive-library.ts"), "--benchmark-worker"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (worker.status !== 0) throw new Error(`Benchmark failed: ${worker.stderr || worker.stdout}`);
  const frameCount = primitives.reduce((sum, p) => sum + p.segments.reduce((n, s) => n + s.frames.length, 0), 0);
  const report = { date: new Date().toISOString(), passed: true, sources, scriptSHA256: sha("scripts/pack-competitive-library.ts"), decoderSHA256: sha("src/scene/competitive-library.ts"), packedSHA256: sha("src/scene/competitive-library.json"),
    counts: { primitives: primitives.length, segments: primitives.reduce((sum, p) => sum + p.segments.length, 0), frames: frameCount, rawPoseRecords: frameCount * 2, uniquePoses: data.poses.left.length + data.poses.right.length, uniqueContacts: data.contacts.length, uniqueContactSets: data.contactSets.length },
    bytes: { originalEvidenceFiles: sources.reduce((sum, source) => sum + readFileSync(source.path).byteLength, 0), canonicalRawMinified: Buffer.byteLength(rawText), packedMinified: Buffer.byteLength(packedText), canonicalRawGzip: gzipSync(rawText).byteLength, packedGzip: gzipSync(packedText).byteLength },
    exactVerification: "Every frame's both PoseData values, contacts (including order), cubeAngle, primitive rotation flag and segment id/phase/stage/active/finger/weight compare recursively with Object.is after JSON serialization and actual runtime decoding. No quantization or resampling.", benchmark: JSON.parse(worker.stdout),
    limitations: ["Node/V8 parsing and retained-heap measurements are local synthetic evidence, not browser startup, animation, network, phone or production measurements."] };
  writeFileSync("evidence/competitive-library-report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
