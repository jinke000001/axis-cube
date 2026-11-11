import { validateFacelets, type Palette } from "../core/cube";
import { newSession, readSession, type Session } from "../core/session";
import type { RestoreFlowState, SolveRunner } from "../wuji-solve-v1/flow";
import { prepareRestore, type RestoreSource } from "../wuji-solve-v1/input";
import type { SolveStore } from "../wuji-solve-v1/storage";
import { compileGripSolveC114 } from "../wuji-samples/grip-solve-c114";

export interface PersonalRestoreState extends RestoreFlowState {
  motionFailed: boolean;
}

function prepareMotion(session: Session): RestoreSource | null {
  try {
    const source = prepareRestore(session);
    const program = compileGripSolveC114(source.steps.map((step) => step.move));
    return { ...source, program };
  } catch (error) {
    console.warn("AXIS restore motion failed", error);
    return null;
  }
}

/** A valid session survives motion preparation and can be exported or retried. */
export class PersonalRestoreFlow {
  private revision = 0;
  private listeners = new Set<() => void>();
  private pendingSave: Session | null = null;
  private current: PersonalRestoreState;

  constructor(private readonly store: SolveStore, private readonly runner: SolveRunner) {
    const saved = store.loadSession();
    const source = saved.value ? prepareMotion(saved.value) : null;
    this.current = {
      source, recovery: saved.value, capturing: false, busy: false,
      phase: source ? "ready" : "idle", error: "", notice: saved.warning,
      motionFailed: !!saved.value && !source,
    };
  }

  snapshot = () => this.current;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private patch(changes: Partial<PersonalRestoreState>) {
    this.current = { ...this.current, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  private invalidate() {
    this.revision++;
    this.runner.cancel();
  }

  openCapture = () => {
    this.invalidate();
    this.patch({ capturing: true, busy: false, error: "", phase: "idle" });
  };

  closeCapture = () => {
    this.invalidate();
    this.patch({ capturing: false, busy: false, error: "", phase: "idle" });
  };

  cancel = () => {
    this.invalidate();
    this.patch({ busy: false, phase: "idle", error: "", notice: "已取消计算，录入资料仍保留。" });
  };

  inputChanged = () => {
    const pending = this.current.busy;
    this.invalidate();
    this.patch({
      busy: false, phase: "idle", error: "",
      ...(pending ? { notice: "录入已改变，上一轮计算已取消。" } : {}),
    });
  };

  async submit(facelets: string, palette: Palette, name = "我的魔方") {
    this.invalidate();
    const token = this.revision;
    const valid = validateFacelets(facelets, palette);
    if (!valid.valid) {
      this.patch({ busy: false, error: valid.message });
      return;
    }
    this.patch({ busy: true, error: "", notice: "", phase: "planning" });
    try {
      const result = await this.runner.solve(facelets, (phase) => {
        if (token === this.revision) this.patch({ phase });
      });
      if (token !== this.revision) return;
      this.patch({ phase: "choreographing" });
      if (result.method !== "cfop" && result.method !== "short") {
        throw Error("求解结果格式不匹配，请重试。");
      }
      this.accept(newSession(facelets, result.solution, palette, name, {
        method: result.method, phases: result.phases,
      }), token);
    } catch (error) {
      if (token === this.revision) {
        this.patch({
          busy: false, phase: "idle",
          error: error instanceof Error ? error.message : "求解失败，录入资料已保留。",
        });
      }
    }
  }

  async importSession(file: File): Promise<string | void> {
    this.invalidate();
    const token = this.revision;
    try {
      if (file.size > 1_000_000) throw Error("局面文件过大，请选择AXIS导出的局面文件。");
      const raw: unknown = JSON.parse(await file.text());
      if (token !== this.revision) return "导入已取消，原资料保留。";
      this.accept(raw, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "局面文件无法读取。";
      if (token === this.revision) this.patch({ error: message, busy: false });
      return message;
    }
  }

  private accept(raw: unknown, token: number) {
    const session = readSession(raw);
    if (token !== this.revision) return;
    this.pendingSave = session;
    this.showMotion(session);
  }

  private showMotion(session: Session) {
    const source = prepareMotion(session);
    let notice = this.pendingSave === session ? "" : this.current.notice;
    if (source && this.pendingSave === session) {
      this.pendingSave = null;
      notice = this.store.saveSession(session)
        ? "已保存在本机，可开始复原。"
        : "演示已生成，但未能写入存档；原资料保留，可下载局面文件。";
    }
    this.patch({
      source, recovery: session, busy: false, capturing: false,
      phase: source ? "ready" : "idle", error: "", notice, motionFailed: !source,
    });
  }

  retryMotion = () => {
    const { recovery, motionFailed, busy } = this.current;
    if (recovery && motionFailed && !busy) this.showMotion(recovery);
  };

  dispose() {
    this.invalidate();
    this.listeners.clear();
  }
}
