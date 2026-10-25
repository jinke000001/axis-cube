import { afterEach, expect, it, vi } from "vitest";
import { Solver } from "./solver";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage?: ({ data }: { data: unknown }) => void;
  onerror?: (event: unknown) => void;
  message: { id: number; state: string } | null = null;
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(data: { id: number; state: string }) {
    this.message = data;
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.all = [];
});
it("cancels superseded work and ignores its late result/error without breaking the current job", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", globalThis);
  const solver = new Solver(),
    first = solver.solve("old");
  const firstResult = expect(first).rejects.toThrow("已取消");
  const second = solver.solve("new"),
    [old, current] = FakeWorker.all;
  old.onmessage?.({ data: { id: old.message!.id, solution: "stale" } });
  old.onerror?.({ message: "stale error" });
  current.onmessage?.({
    data: { id: current.message!.id, solution: "R", elapsed: 10 },
  });
  await firstResult;
  expect(await second).toMatchObject({ solution: "R" });
  expect(old.terminated).toBe(true);
  expect(current.terminated).toBe(true);
});
it("terminates timed out calculation and remains cancellable afterward", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", globalThis);
  const solver = new Solver(),
    pending = solver.solve("slow"),
    check = expect(pending).rejects.toThrow("超时");
  await vi.advanceTimersByTimeAsync(45000);
  await check;
  expect(FakeWorker.all[0].terminated).toBe(true);
  const next = solver.solve("new"),
    cancelled = expect(next).rejects.toThrow("已取消");
  solver.cancel();
  await cancelled;
});
