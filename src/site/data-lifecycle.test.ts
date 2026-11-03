import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { applyAlgorithm, DEFAULT_PALETTE, SOLVED } from "../core/cube";
import { loadSession, newSession } from "../core/session";
import { readNativePreference, writeNativePreference } from "../platform/preferences";
import { emptyProgress, parseProgress, PROGRESS_KEY } from "./progress";
import { useLearning } from "./useLearning";

const bridge = vi.hoisted(() => ({
  capture: null as null | { onImport: (file: File) => Promise<string | void> },
  failRenderer: false,
}));
vi.mock("../platform/runtime", () => ({ isNativeApp: () => true }));
vi.mock("../platform/preferences", () => ({
  readNativePreference: vi.fn(), writeNativePreference: vi.fn(),
}));
// Keep the actual App lifecycle, import guards, session validation and storage.
// Rendering/robot computation are outside these data-lifecycle regressions.
vi.mock("../scene/studio", () => ({
  Studio: class {
    duration = 0;
    time = 0;
    constructor(_host: HTMLElement, _frame: unknown, ready: (ok: boolean) => void) { if (bridge.failRenderer) throw new Error("WebGL unavailable"); ready(true); }
    configure(_state: string, program: { duration: number }) { this.duration = program.duration; }
    dispose() {}
    seek(time: number) { this.time = time; }
    ghost() {}
    showTrace() {}
    view() {}
  },
}));
vi.mock("../core/solver", () => ({
  Solver: class {
    cancel() {}
    solve() { throw new Error("Existing-session import must not invoke a solver"); }
  },
}));
vi.mock("../scene/finger-solve-program", () => ({
  compileFingerSolve: (moves: { notation: string }[]) => ({
    steps: moves.map((move, index) => ({ move, start: index, active: "right" })),
    duration: moves.length, segments: [], statistics: {}, cost: 0, sample: () => ({}),
  }),
}));
vi.mock("../scene/finger-cadence", () => ({ retimeFingerProgram: (program: unknown) => program }));
vi.mock("../scene/competitive-program", () => ({ compileCompetitiveExecution: () => { throw new Error("Unexpected competitive compilation"); } }));
vi.mock("../components/CubeNet", () => ({ CubeNet: () => null }));
vi.mock("../components/FingerStudies", () => ({ FingerStudies: () => null }));
vi.mock("../components/Capture", () => ({
  Capture: (props: NonNullable<typeof bridge.capture>) => { bridge.capture = props; return null; },
}));
vi.mock("../core/finger-studies", () => ({ ALL_FINGER_STUDIES: [], studySession: () => null }));

const data = new Map<string, string>();
const oldBackup = JSON.stringify({
  ...emptyProgress(),
  lastLesson: "white-cross",
  lessons: { "white-cross": { caseId: "cross-aligned", step: 1, checks: [], completed: true, updatedAt: "2026-10-01T00:00:00.000Z" } },
});
const protectedKeys = ["axis.cube.session.v1", "axis.cube.session.v1.previous", "axis.capture.v2", "axis.capture.draft", "axis.follow.v1"];
const protectedData = () => Object.fromEntries(protectedKeys.map((key) => [key, data.get(key)]));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let root: Root | null;
let createRoot: typeof import("react-dom/client").createRoot;
type AppProps = NonNullable<Parameters<typeof import("../App").default>[0]>;
let App: ComponentType<AppProps>;
let learning: ReturnType<typeof useLearning>;
function LearningHarness() { learning = useLearning(); return null; }
async function mountLearning() {
  root = createRoot(document.getElementById("root")!);
  await act(async () => root!.render(createElement(LearningHarness)));
}
async function unmount() {
  if (root) await act(async () => root!.unmount());
  root = null;
}

beforeAll(async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("navigator", { userAgent: "data-lifecycle-test" });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ default: App } = await import("../App"));
});
beforeEach(() => {
  data.clear();
  for (const key of protectedKeys) data.set(key, `preserved:${key}`);
  document.body.innerHTML = '<div id="root"></div>';
  bridge.capture = null;
  bridge.failRenderer = false;
  vi.mocked(readNativePreference).mockReset().mockResolvedValue(oldBackup);
  vi.mocked(writeNativePreference).mockReset().mockResolvedValue(true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T02:00:00.000Z"));
});
afterEach(async () => { await unmount(); vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

describe("course and workbench data lifecycle regressions", () => {
  it("keeps the workbench and manual steps usable when WebGL cannot start", async () => {
    bridge.failRenderer = true;
    const initial = newSession(applyAlgorithm(SOLVED, "R"), "R'", DEFAULT_PALETTE, "offline-fallback");
    data.set("axis.cube.session.v1", JSON.stringify(initial));
    const original = protectedData();
    root = createRoot(document.getElementById("root")!);
    await act(async () => root!.render(createElement(App, { entry: "studio" })));
    expect(document.body.textContent).toContain("六面展开图、逐步查看、颜色录入和局面保存仍可使用");
    expect(document.querySelector('nav[aria-label="工作台工具"]')).not.toBeNull();
    const next = document.querySelector('button[aria-label="下一步"]') as HTMLElement;
    await act(async () => next.click());
    expect(document.body.textContent).toContain("还原完成");
    expect(loadSession()?.name).toBe("offline-fallback");
    for (const key of ["axis.capture.v2", "axis.capture.draft"]) expect(data.get(key)).toBe(original[key]);
  });
  it("does not resurrect cleared lessons when a native read finishes after reset", async () => {
    const read = deferred<string | null>();
    vi.mocked(readNativePreference).mockReturnValue(read.promise);
    const original = protectedData();
    await mountLearning();
    expect(learning.ready).toBe(false);
    await act(async () => learning.resetLearning());
    const resetAt = learning.progress.resetAt;
    expect(resetAt).not.toBe("");
    await act(async () => read.resolve(oldBackup));
    expect(learning.ready).toBe(true);
    expect(learning.progress.lessons).toEqual({});
    expect(learning.progress.lastLesson).toBe("");
    expect(parseProgress(data.get(PROGRESS_KEY) ?? null).resetAt).toBe(resetAt);
    const saved = vi.mocked(writeNativePreference).mock.calls.at(-1)!;
    expect(parseProgress(saved[1]).lessons).toEqual({});
    expect(parseProgress(saved[1]).resetAt).toBe(resetAt);
    expect(protectedData()).toEqual(original);
  });

  it("keeps a successful local reset after native writing fails and the next launch reads the old backup", async () => {
    data.set(PROGRESS_KEY, oldBackup);
    vi.mocked(writeNativePreference).mockRejectedValue(new Error("Native disk is unavailable"));
    const original = protectedData();
    await mountLearning();
    expect(learning.progress.lessons["white-cross"].completed).toBe(true);
    await act(async () => learning.resetLearning());
    const localReset = parseProgress(data.get(PROGRESS_KEY) ?? null);
    expect(localReset.lessons).toEqual({});
    expect(localReset.resetAt).not.toBe("");
    expect(learning.saveError).toContain("手机备份暂时未能保存");
    await unmount();
    vi.mocked(writeNativePreference).mockResolvedValue(true);
    await mountLearning();
    expect(learning.ready).toBe(true);
    expect(learning.progress.lessons).toEqual({});
    expect(learning.progress.resetAt).toBe(localReset.resetAt);
    expect(learning.progress.lastLesson).toBe("");
    expect(protectedData()).toEqual(original);
  });

  it("retains an unread native backup instead of replacing it after local learning changes", async () => {
    vi.mocked(readNativePreference).mockRejectedValue(new Error("Native read is unavailable"));
    const original = protectedData();
    await mountLearning();
    expect(learning.ready).toBe(true);
    await act(async () => learning.updateLesson("white-cross", { caseId: "cross-aligned", step: 1 }));
    expect(parseProgress(data.get(PROGRESS_KEY) ?? null).lessons["white-cross"].step).toBe(1);
    expect(writeNativePreference).not.toHaveBeenCalled();
    expect(learning.saveError).toContain("无法读取手机中的学习备份");
    expect(protectedData()).toEqual(original);
  });

  it("ignores an old File.text result after a route unmount and a new App instance accepts another cube", async () => {
    data.set("axis.cube.session.v1", JSON.stringify(newSession(SOLVED, "", DEFAULT_PALETTE, "initial")));
    root = createRoot(document.getElementById("root")!);
    await act(async () => root!.render(createElement(App, { entry: "capture" })));
    const staleRead = deferred<string>();
    let oldImport!: Promise<string | void>;
    await act(async () => {
      oldImport = bridge.capture!.onImport({ size: 500, text: () => staleRead.promise } as File);
    });
    await unmount();
    root = createRoot(document.getElementById("root")!);
    await act(async () => root!.render(createElement(App, { entry: "capture" })));
    const newer = newSession(applyAlgorithm(SOLVED, "F"), "F'", DEFAULT_PALETTE, "newer-session");
    await act(async () => {
      await bridge.capture!.onImport({ size: 500, text: async () => JSON.stringify(newer) } as File);
    });
    expect(loadSession()?.name).toBe("newer-session");
    const saved = data.get("axis.cube.session.v1");
    const previous = data.get("axis.cube.session.v1.previous");
    const stale = newSession(applyAlgorithm(SOLVED, "R"), "R'", DEFAULT_PALETTE, "stale-import-from-previous-route");
    await act(async () => { staleRead.resolve(JSON.stringify(stale)); await oldImport; });
    expect(data.get("axis.cube.session.v1")).toBe(saved);
    expect(data.get("axis.cube.session.v1.previous")).toBe(previous);
    expect(loadSession()?.name).toBe("newer-session");
    for (const key of ["axis.capture.v2", "axis.capture.draft"]) expect(data.get(key)).toBe(`preserved:${key}`);
  });
});
