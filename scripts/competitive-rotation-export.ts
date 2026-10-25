/** Export only the accepted y/y-prime poses, preserving object-frame contacts. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = "evidence/competitive-rotation-y-handoff-grip-full-0.04-64-arc.json";
const outputPath = "evidence/competitive-rotation-primitives.json";
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!source.passed || source.mode !== "full" || source.retreatMetres !== .04)
  throw new Error("仅可导出完整通过的 40 mm 侧退交接路径。");
for (const input of source.sources)
  if (sha(input.path) !== input.sha256) throw new Error(`验收后源文件已变更：${input.path}`);

const cases = [], primitives: Record<string, unknown[]> = {};
for (const notation of ["y", "y'"]) {
  const data = source.primitives[notation];
  if (!data?.passed || !data.canonicalLow || data.segments.length !== 7)
    throw new Error(`未完整通过：${notation}`);
  primitives[notation] = data.segments.map((segment: any) => {
    if (!segment.validation.passed || segment.frames.length !== 65 || segment.validation.checkedFrames !== 129)
      throw new Error(`节点或中点验收不足：${notation}/${segment.id}`);
    return { id: segment.id, frames: segment.frames.map((frame: any) => ({
      left: frame.left, right: frame.right, contacts: frame.contacts,
      cubeAngle: frame.cubeAngle, turning: frame.turning,
    })) };
  });
  const maximum = Object.fromEntries(Object.keys(data.finalCheck.maximum).map(key => [key,
    Math.max(data.finalCheck.maximum[key], ...data.segments.map((s: any) => s.validation.maximum[key]))]));
  cases.push({ notation, passed: true, active: data.active, receiver: data.receiver,
    segments: data.segments.length, storedFrames: data.segments.reduce((sum: number, s: any) => sum + s.frames.length, 0),
    geometryChecks: data.segments.reduce((sum: number, s: any) => sum + s.validation.checkedFrames, 0) + 1,
    totalPathMM: data.totalPathMM, pathMM: data.pathMM, maximum,
    minimumSupportAreaM2: Math.min(data.finalCheck.supportAreaM2, ...data.segments.map((s: any) => s.validation.minimumSupportAreaM2)),
    final: data.final,
  });
}
const result = {
  sourceSHA256: sha(sourcePath), sourcePath, assetSHA256: source.assetSHA256, exportSHA256: sha("scripts/competitive-rotation-export.ts"),
  primitives, cases, sources: source.sources, stateChecks: source.stateChecks,
  axis: [0, 1, 0],
  contract: {
    poses: "World-space PoseData; metres/radians; [x,y,z,w] quaternions. Both ends are canonical low.",
    contacts: "Every frame stores points and normals in the ORIGINAL primitive-entry object material coordinates. They are not pre-rotated to the world-aligned exit box.",
    physicalOrientation: "QY(cubeAngle), including all non-TURN recovery frames. y=-pi/2; y-prime=+pi/2. cubeAngle stays at the completed turn throughout recovery.",
    turnAdapter: "TURN: pass rotation Move(y/y-prime), angle=cubeAngle, orientation=identity to contact measurement. Five holder contacts are drive; the clear receiving hand has no contact claims.",
    staticAdapter: "For non-TURN support measurement choose EITHER (A) original contacts + no move + angle=0 + orientation=QY(cubeAngle), OR (B) transform each point/normal exactly once by QY(cubeAngle), then no move + angle=0 + identity orientation. Do not combine A and B.",
    renderAdapter: "Keep the original facelets with actual QY(cubeAngle), or an equivalent identity orientation plus held y move angle; during recovery do not reverse the object when the released hand returns.",
    logicalCommit: "At completed primitive only, apply y/y-prime to logical facelets and atomically reset physical render orientation. Rebase contacts to canonical low. Independent 54-slot permutation and 54 rendered colored stickers match this exact commit.",
    endpointConvention: "Every segment includes its exact start/end pose; linearly interpolate positions/joints and slerp wrists. 65 nodes and all 64 interpolation midpoints were checked. Preserve group order.",
  },
  limitations: source.limitations,
};
writeFileSync(outputPath, JSON.stringify(result) + "\n");
console.log(JSON.stringify({ outputPath, sourcePath, cases, sourcesVerified: source.sources.length }));
