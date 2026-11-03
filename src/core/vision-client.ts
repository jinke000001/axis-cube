import type { Quad } from "./vision";
import type { FaceAnalysis } from "./vision-contract";

/** One local worker per capture dialog; terminating also cancels any pending analysis. */
export class VisionClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: FaceAnalysis) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  analyze(image: ImageData, quad?: Quad): Promise<FaceAnalysis> {
    if (!this.worker) {
      this.worker = new Worker(new URL("./vision.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (
        event: MessageEvent<{
          id: number;
          result?: FaceAnalysis;
          error?: string;
        }>,
      ) => {
        const pending = this.pending.get(event.data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(event.data.id);
        if (event.data.result) pending.resolve(event.data.result);
        else
          pending.reject(
            new Error(event.data.error || "照片分析失败，请重新选择照片。"),
          );
      };
      this.worker.onerror = () =>
        this.dispose(new Error("识别组件未能启动，请重试；原有录入已保留。"));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.dispose(new Error("照片分析耗时过长，已停止；原有录入已保留。")),
        30_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      const data = new Uint8ClampedArray(image.data);
      try {
        this.worker!.postMessage(
          { id, width: image.width, height: image.height, data, quad },
          [data.buffer],
        );
      } catch {
        this.dispose(new Error("无法读取这张照片，请重新打开录入。"));
      }
    });
  }
  dispose(reason: Error = new DOMException("照片处理已取消。", "AbortError")) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
