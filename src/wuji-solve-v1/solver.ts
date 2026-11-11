import type{SolveResult}from'../core/solver';
export class Solver {
  private worker: Worker | null = null;
  private revision = 0;
  private rejectPending: ((error: Error) => void) | null = null;
  cancel() {
    this.revision++;
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending?.(new Error("已取消"));
    this.rejectPending = null;
  }
  solve(
    state: string,
    onPhase?: (phase: string) => void,
  ): Promise<SolveResult> {
    this.cancel();
    const id = this.revision;
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.rejectPending = null;
        }
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("计算超时，请重试或检查局面。"));
      }, 45000);
      this.rejectPending = (error) => {
        cleanup();
        reject(error);
      };
      worker.onmessage = ({ data }) => {
        if (data.id !== this.revision) return;
        if (data.phase) {
          onPhase?.(data.phase);
          return;
        }
        cleanup();
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = (event) => {
        if (id !== this.revision) return;
        console.error(
          "Solver worker failed",
          event.message,
          event.filename,
          event.lineno,
        );
        cleanup();
        reject(new Error("求解器加载失败，请刷新后重试。"));
      };
      worker.postMessage({ id, state });
    });
  }
}
