/** The small typed boundary used by the detector; no DOM-based OpenCV helpers. */
export interface CvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32S: Int32Array;
  delete(): void;
}
interface CvVector {
  size(): number;
  get(index: number): CvMat;
  delete(): void;
}
export interface OpenCV {
  Mat: new (rows?: number, cols?: number, type?: number) => CvMat;
  MatVector: new () => CvVector;
  Size: new (width: number, height: number) => unknown;
  CV_8UC4: number;
  COLOR_RGBA2GRAY: number;
  INTER_AREA: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  THRESH_BINARY: number;
  resize(
    src: CvMat,
    dst: CvMat,
    size: unknown,
    fx: number,
    fy: number,
    method: number,
  ): void;
  cvtColor(src: CvMat, dst: CvMat, code: number): void;
  GaussianBlur(src: CvMat, dst: CvMat, size: unknown, sigma: number): void;
  Canny(src: CvMat, dst: CvMat, low: number, high: number): void;
  threshold(
    src: CvMat,
    dst: CvMat,
    value: number,
    max: number,
    type: number,
  ): void;
  findContours(
    src: CvMat,
    contours: CvVector,
    hierarchy: CvMat,
    mode: number,
    method: number,
  ): void;
  contourArea(contour: CvMat): number;
  arcLength(contour: CvMat, closed: boolean): number;
  approxPolyDP(src: CvMat, dst: CvMat, epsilon: number, closed: boolean): void;
  isContourConvex(contour: CvMat): boolean;
}

type Runtime = OpenCV & {
  calledRun?: boolean;
  then?: (ready: () => void) => void;
};
let pending: Promise<OpenCV> | undefined;

/** Fixed, same-origin asset. It is loaded only when automatic photo detection is used. */
export function loadOpenCV(): Promise<OpenCV> {
  if (!pending) {
    pending = (async () => {
      const scope = globalThis as typeof globalThis & { cv?: Runtime };
      if (!scope.cv) {
        // Use a fully qualified same-origin URL. Vite's dev import helper
        // appends ?import to root-relative variables, which public assets reject.
        const url = new URL(
          `${import.meta.env.BASE_URL}vendor/opencv/opencv-4.13.0.js`,
          globalThis.location.origin,
        ).href;
        await import(/* @vite-ignore */ url);
      }
      const runtime = scope.cv;
      if (!runtime) throw new Error("照片识别组件未能加载，请重试。");
      if (!runtime.calledRun || !runtime.Mat) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("照片识别组件加载超时，请重试。")),
            20_000,
          );
          if (!runtime.then) {
            clearTimeout(timeout);
            reject(new Error("照片识别组件尚未就绪。"));
            return;
          }
          runtime.then(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      // The older Emscripten ready callback is a self-resolving thenable, not a
      // Promise. Remove it after initialization before returning through async.
      delete runtime.then;
      return runtime as OpenCV;
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}
