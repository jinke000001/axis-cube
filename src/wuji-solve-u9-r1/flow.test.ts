import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAlgorithm, DEFAULT_PALETTE, SOLVED } from "../core/cube";
import { newSession } from "../core/session";
import type { SolveRunner } from "../wuji-solve-v1/flow";
import { SOLVE_SESSION_KEY, SolveStore } from "../wuji-solve-v1/storage";
import { PersonalRestoreFlow } from "./flow";

const failure = vi.hoisted(() => ({ compiler: "" }));
vi.mock("../wuji-samples/grip-solve-c114", async (importOriginal) => {
  const original = await importOriginal<typeof import("../wuji-samples/grip-solve-c114")>();
  return {
    ...original,
    compileGripSolveC114: (...args: Parameters<typeof original.compileGripSolveC114>) => {
      if (failure.compiler === "c114") throw Error("test-only C114 failure");
      return original.compileGripSolveC114(...args);
    },
  };
});
vi.mock("../wuji-samples/solve-program-c113", async (importOriginal) => {
  const original = await importOriginal<typeof import("../wuji-samples/solve-program-c113")>();
  return {
    ...original,
    compileRestoreProgram: (...args: Parameters<typeof original.compileRestoreProgram>) => {
      if (failure.compiler === "c113") throw Error("test-only C113 failure");
      return original.compileRestoreProgram(...args);
    },
  };
});

const legacyKey = "axis.cube.session.v1";
const legacy = newSession(applyAlgorithm(SOLVED, "F2"), "F2", DEFAULT_PALETTE, "旧局面", { method: "short" });
const fresh = newSession(applyAlgorithm(SOLVED, "F2 L2"), "L2 F2", {
  ...DEFAULT_PALETTE, U: "F", F: "U",
}, "导入的局面", { method: "short" });
const file = (value: unknown) => new File([JSON.stringify(value)], "state.json", { type: "application/json" });

function setup(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = new SolveStore({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  });
  const solve = vi.fn<SolveRunner["solve"]>().mockResolvedValue({
    method: "short", solution: fresh.solution, phases: [], elapsed: 0,
  });
  const flow = new PersonalRestoreFlow(store, { solve, cancel: vi.fn() });
  return { flow, data, solve };
}

beforeEach(() => {
  failure.compiler = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("personal restore after a motion preparation failure", () => {
  it("retries an existing legal session without rewriting it or solving again", () => {
    failure.compiler = "c114";
    const old = JSON.stringify(legacy);
    const { flow, data, solve } = setup({ [legacyKey]: old, [legacyKey + ".previous"]: "original" });
    expect(flow.snapshot()).toMatchObject({ source: null, recovery: legacy, motionFailed: true });
    flow.retryMotion();
    expect(flow.snapshot()).toMatchObject({ source: null, recovery: legacy, motionFailed: true });
    failure.compiler = "";
    flow.retryMotion();
    expect(flow.snapshot()).toMatchObject({ source: { session: legacy }, motionFailed: false });
    expect(Object.fromEntries(data)).toEqual({ [legacyKey]: old, [legacyKey + ".previous"]: "original" });
    expect(solve).not.toHaveBeenCalled();
  });

  it("keeps a newly imported session available when the initial compiler fails", async () => {
    const before = JSON.stringify({ version: 1, session: legacy, previous: null });
    const { flow, data, solve } = setup({ [SOLVE_SESSION_KEY]: before });
    failure.compiler = "c113";
    await flow.importSession(file(fresh));
    expect(flow.snapshot()).toMatchObject({ source: null, recovery: fresh, motionFailed: true });
    expect(data.get(SOLVE_SESSION_KEY)).toBe(before);
    failure.compiler = "";
    flow.retryMotion();
    expect(flow.snapshot()).toMatchObject({ source: { session: fresh }, motionFailed: false });
    expect(JSON.parse(data.get(SOLVE_SESSION_KEY)!)).toEqual({ version: 1, session: fresh, previous: legacy });
    expect(solve).not.toHaveBeenCalled();
  });

  it("keeps the actual worker solution available after failed motion and uses it on retry", async () => {
    const { flow, data, solve } = setup();
    failure.compiler = "c114";
    await flow.submit(fresh.facelets, fresh.palette);
    expect(flow.snapshot()).toMatchObject({
      source: null, motionFailed: true,
      recovery: { facelets: fresh.facelets, palette: fresh.palette, solution: fresh.solution },
    });
    expect(data.has(SOLVE_SESSION_KEY)).toBe(false);
    failure.compiler = "";
    flow.retryMotion();
    expect(flow.snapshot().source?.states.at(-1)).toBe(SOLVED);
    expect(solve).toHaveBeenCalledTimes(1);
  });

  it("does not present an invalid or unsolved import as a recoverable session", async () => {
    const { flow, data } = setup();
    const message = await flow.importSession(file({ ...fresh, solution: "R" }));
    flow.retryMotion();
    expect(message).toContain("解法与局面不一致");
    expect(flow.snapshot()).toMatchObject({ recovery: null, source: null, motionFailed: false });
    expect(data.size).toBe(0);
  });
});
