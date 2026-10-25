import { describe, expect, it } from "vitest";
import { applyAlgorithm, parseAlgorithm, snapshots, SOLVED } from "./cube";
import { moveAtYaw, planYReorientations } from "./reorientation-plan";

const symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01";
const text = (moves: ReturnType<typeof parseAlgorithm>) => moves.map((move) => move.notation).join(" ");
const yawText = (yaw: number) => Array.from({ length: yaw }, () => "y").join(" ");

describe("competitive physical reorientation", () => {
  it("preserves every sticker permutation, direction and center frame", () => {
    for (const move of parseAlgorithm("U U' U2 U2' R R' R2 R2' F F' F2 F2' D D' D2 D2' L L' L2 L2' B B' B2 B2'"))
      for (let yaw = 0; yaw < 4; yaw++) {
        const mapped = moveAtYaw(move, yaw);
        const inverse = Array.from({ length: yaw }, () => "y'").join(" ");
        expect(applyAlgorithm(symbols, `${yawText(yaw)} ${mapped.notation} ${inverse}`)).toBe(applyAlgorithm(symbols, move.notation));
        expect(mapped.turns).toBe(move.turns);
        expect(mapped.direction).toBe(move.direction);
      }
  });
  it("selects useful rotations including their return, with truthful source boundaries", () => {
    const source = parseAlgorithm("B U B' U B U2' B' R U R' U R U2 R'");
    const result = planYReorientations(source, {
      phraseCost: (moves) => 0.5 + moves.reduce((sum, move) => sum + (move.face === "B" ? 20 : 1), 0),
      rotationCost: () => 2,
    });
    expect(result.rotationCount).toBeGreaterThan(0);
    expect(result.cost).toBeLessThan(result.fixedCost);
    expect(result.boundaries).toHaveLength(source.length + 1);
    expect(result.sourceIndices).toHaveLength(result.moves.length);
    expect(result.yawAtBoundary).toHaveLength(result.moves.length + 1);
    const original = snapshots(symbols, source), actual = snapshots(symbols, result.moves);
    result.boundaries.forEach((boundary, index) => {
      expect(actual[boundary]).toBe(applyAlgorithm(original[index], yawText(result.yawAtBoundary[boundary])));
    });
    expect(actual.at(-1)).toBe(original.at(-1));
    result.sourceIndices.forEach((owner, i) => {
      expect(i).toBeGreaterThanOrEqual(result.boundaries[owner]);
      expect(i).toBeLessThan(result.boundaries[owner + 1]);
    });
  });
  it("keeps the cube front steady when reorientation has no execution benefit", () => {
    const source = parseAlgorithm("R U2 R' U' R U' R'");
    const plan = planYReorientations(source, { phraseCost: (moves) => moves.length + 1, rotationCost: () => 2 });
    expect(text(plan.moves)).toBe(text(source));
    expect(plan.rotationCount).toBe(0);
    expect(plan.cost).toBe(plan.fixedCost);
  });
  it("handles solved and short inputs and rejects invalid cost or extended-turn contracts", () => {
    const options = { phraseCost: (moves: readonly unknown[]) => moves.length, rotationCost: () => 1 };
    const empty = planYReorientations([], options);
    expect(empty.boundaries).toEqual([0]);
    expect(empty.cost).toBe(0);
    expect(applyAlgorithm(SOLVED, text(empty.moves))).toBe(SOLVED);
    expect(planYReorientations(parseAlgorithm("R2'"), options).moves[0].notation).toBe("R2'");
    expect(() => planYReorientations(parseAlgorithm("M"), options)).toThrow("普通六面");
    expect(() => planYReorientations(parseAlgorithm("R"), { ...options, rotationCost: () => 0 })).toThrow("正数");
    expect(() => planYReorientations(parseAlgorithm("R"), { ...options, phraseCost: () => NaN })).toThrow("非负数");
  });
});
