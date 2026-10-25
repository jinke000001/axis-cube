import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAlgorithm, SOLVED } from "./cube";
import { readCompetitionVariant, type CompetitionVariant } from "./competition";
import { loadSession, newSession, readSession, saveSession } from "./session";
import { readFollow, saveFollow } from "./follow";

afterEach(() => vi.unstubAllGlobals());
const facelets = applyAlgorithm(SOLVED, "F'");
const phases = [
  { name: "cross" as const, start: 0, end: 1 }, { name: "f2l" as const, start: 1, end: 1 },
  { name: "oll" as const, start: 1, end: 1 }, { name: "pll" as const, start: 1, end: 1 },
];
const variant: CompetitionVariant = { version: 1, solution: "F", phases,
  execution: { algorithm: "y L y'", boundaries: [0, 3] } };
function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value) });
  return data;
}

describe("saved comparison modes", () => {
  it("preserves the accepted original solution and separate physical follow counts", () => {
    const data = storage();
    const base = newSession(facelets, "F", undefined, "original", { method: "cfop", phases });
    saveSession(base); saveFollow(base, { enabled: true, completed: 1 });
    const both = readSession({ ...base, competition: variant });
    expect(both.solution).toBe(base.solution);
    expect(both.phases).toEqual(base.phases);
    expect(readSession(JSON.parse(JSON.stringify(both)))).toEqual(both);
    expect(saveSession(both)).toBe(true);
    expect(JSON.parse(data.get("axis.cube.session.v1.previous")!)).toEqual(base);
    expect(readFollow(loadSession())).toEqual({ enabled: true, completed: 1 });
    expect(saveFollow(both, { enabled: true, completed: 2 }, "competitive")).toBe(true);
    expect(readFollow(loadSession(), "competitive")).toEqual({ enabled: true, completed: 2 });
    expect(readFollow(loadSession())).toEqual({ enabled: true, completed: 1 });
    expect(saveFollow(both, { enabled: false, completed: 4 }, "competitive")).toBe(false);
  });
  it("rejects forged execution ownership and phases even if extra turns cancel", () => {
    expect(readCompetitionVariant(facelets, variant)).toEqual(variant);
    expect(() => readCompetitionVariant(facelets, { ...variant, execution: { algorithm: "y L y' U U'", boundaries: [0, 5] } })).toThrow("转层");
    expect(() => readCompetitionVariant(facelets, { ...variant, execution: { algorithm: "y L y'", boundaries: [0, 1] } })).toThrow("对应关系");
    expect(() => readCompetitionVariant(facelets, { ...variant, execution: { algorithm: "y R y'", boundaries: [0, 3] } })).toThrow("原解法");
    expect(() => readCompetitionVariant(facelets, { ...variant, phases: [{ ...phases[0], end: 0 }, ...phases.slice(1)] })).toThrow("阶段");
    expect(() => readCompetitionVariant(facelets, { ...variant, execution: { algorithm: "y L", boundaries: [0, 2] } })).toThrow("中心朝向");
  });
  it("keeps existing progress when saving a new variant fails", () => {
    const data = storage(), base = newSession(facelets, "F");
    saveSession(base); saveFollow(base, { enabled: true, completed: 1 });
    vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { if (key === "axis.cube.session.v1") throw new Error("quota"); data.set(key, value); } });
    const next = { ...base, competition: variant };
    expect(saveSession(next)).toBe(false);
    expect(saveFollow(next, { enabled: true, completed: 2 }, "competitive")).toBe(false);
    expect(saveFollow(next, { enabled: false, completed: 0 }, "cfop")).toBe(false);
    expect(saveFollow({ ...base, createdAt: "different-session" }, { enabled: false, completed: 0 })).toBe(false);
    expect(readFollow(loadSession())).toEqual({ enabled: true, completed: 1 });
    expect(loadSession()).toEqual(base);
  });
  it("does not reuse competitive progress for a different physical execution", () => {
    storage();
    const before = { ...newSession(facelets, "F"), competition: variant };
    saveSession(before); saveFollow(before, { enabled: true, completed: 2 }, "competitive");
    const after = readSession({ ...before, competition: { ...variant, execution: { algorithm: "F", boundaries: [0, 1] } } });
    saveSession(after);
    expect(readFollow(after, "competitive")).toEqual({ enabled: false, completed: 0 });
    expect(saveFollow(before, { enabled: true, completed: 2 }, "competitive")).toBe(false);
  });
});
