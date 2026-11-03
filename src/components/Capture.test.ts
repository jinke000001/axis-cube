import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import {
  FACES,
  SOLVED,
  applyAlgorithm,
  rotateFace,
  type Face,
} from "../core/cube";
import { REFERENCE } from "../core/vision";
import {
  CAPTURE_DRAFT_KEY,
  LEGACY_DRAFT_KEY,
  captureValidation,
  emptyCapture,
} from "../core/capture-state";
import type { PreparedPhoto } from "../core/photo-input";
import type { FaceAnalysis } from "../core/vision-contract";

// Native file pickers emit a bubbling cancel event; this is different from
// cancelling the enclosing modal (Escape / platform close request).
describe("native picker cancel propagation", () => {
  it("ignores child file cancellation without closing or stopping the active camera", async () => {
    const camera = installCamera();
    await openReadyCamera();
    const before = colors();
    for (const input of document.querySelectorAll('input[type="file"]')) {
      await act(async () => {
        input.dispatchEvent(new window.Event("cancel", { bubbles: true }));
      });
    }
    expect(closed).not.toHaveBeenCalled();
    expect(camera.sessions[0].track.stop).not.toHaveBeenCalled();
    expect(colors()).toBe(before);
    expect(named("拍摄并识别").disabled).toBe(false);
  });
  it("still handles a cancel request targeting the enclosing dialog", async () => {
    await act(async () => {
      document
        .querySelector("dialog")!
        .dispatchEvent(
          new window.Event("cancel", { bubbles: false, cancelable: true }),
        );
    });
    expect(closed).toHaveBeenCalledOnce();
  });
});

const harness = vi.hoisted(() => ({
  decode: null as null | ((file: File) => Promise<PreparedPhoto>),
  failGrid: false,
  failFaces: [] as Face[],
  analysisFailure: null as Error | null,
  analyzedFaces: [] as Face[],
  analysisCalls: 0,
  disposeCalls: 0,
  analysisGate: null as Promise<void> | null,
}));
vi.mock("../core/photo-input", () => ({
  decodePhoto: (file: File) => harness.decode!(file),
}));
vi.mock("../core/vision-client", () => ({
  VisionClient: class {
    async analyze(image: ImageData, quad?: unknown): Promise<FaceAnalysis> {
      harness.analysisCalls++;
      const face = FACES[image.data[0]];
      harness.analyzedFaces.push(face);
      if (harness.analysisGate) await harness.analysisGate;
      if (harness.analysisFailure) throw harness.analysisFailure;
      if ((harness.failGrid || harness.failFaces.includes(face)) && !quad)
        return {
          quad: null,
          cells: [],
          confidence: 0,
          method: "grid",
          warnings: ["没有找到完整九格，请框选。"],
        };
      return {
        quad: [
          [0, 0],
          [89, 0],
          [89, 89],
          [0, 89],
        ],
        cells: Array.from({ length: 9 }, () => ({
          rgb: [...REFERENCE[face]],
          alternatives: [],
          coverage: 1,
          glare: 0,
          spread: 0,
        })),
        confidence: 1,
        method: quad ? "manual" : "grid",
        warnings: [],
      };
    }
    dispose() {
      harness.disposeCalls++;
    }
  },
}));
vi.mock("./CubePreview", () => ({
  CubePreview: ({ state }: { state: string }) =>
    createElement("div", { "data-preview-state": state }),
}));
vi.mock("./CapturePhoto", () => ({
  CapturePhoto: ({ quad }: { quad: unknown }) =>
    createElement("canvas", {
      "aria-label": "四角框选",
      "data-quad": JSON.stringify(quad),
    }),
}));
let createRoot: typeof import("react-dom/client").createRoot;
let Capture: typeof import("./Capture").Capture;
let root: Root;
let pageVisibility = "visible";
let frameId = 0;
const cameraFrames = new Map<
  HTMLVideoElement,
  Map<number, VideoFrameRequestCallback>
>();
const data = new Map<string, string>();
const accepted = vi.fn(),
  closed = vi.fn(),
  restarted = vi.fn();
const file = (face: Face) =>
  new File(["photo"], `${face}.png`, { type: "image/png" });
function prepared(face: Face): PreparedPhoto {
  const pixels = {
    width: 90,
    height: 90,
    data: new Uint8ClampedArray(90 * 90 * 4),
  } as ImageData;
  pixels.data[0] = FACES.indexOf(face);
  return {
    pixels,
    originalWidth: 90,
    originalHeight: 90,
    decoder: "bitmap",
    thumbnail: "data:image/png;base64,AA==",
    fingerprint: `photo-${face}`,
  };
}
beforeAll(async () => {
  const { window, document } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("navigator", { userAgent: "capture-unit-test" });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => pageVisibility,
  });
  Object.defineProperties(window.HTMLElement.prototype, {
    play: {
      configurable: true,
      value: function (this: HTMLVideoElement) {
        Object.defineProperty(this, "paused", {
          value: false,
          writable: true,
          configurable: true,
        });
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      value: function (this: HTMLVideoElement) {
        Object.defineProperty(this, "paused", {
          value: true,
          writable: true,
          configurable: true,
        });
      },
    },
    requestVideoFrameCallback: {
      configurable: true,
      value: function (
        this: HTMLVideoElement,
        callback: VideoFrameRequestCallback,
      ) {
        const callbacks = cameraFrames.get(this) ?? new Map();
        const id = ++frameId;
        callbacks.set(id, callback);
        cameraFrames.set(this, callbacks);
        return id;
      },
    },
    cancelVideoFrameCallback: {
      configurable: true,
      value: function (this: HTMLVideoElement, id: number) {
        cameraFrames.get(this)?.delete(id);
      },
    },
  });
  (
    window.HTMLElement.prototype as unknown as { showModal: () => void }
  ).showModal = function (this: HTMLElement) {
    this.setAttribute("open", "");
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ Capture } = await import("./Capture"));
});
beforeEach(async () => {
  pageVisibility = "visible";
  cameraFrames.clear();
  data.clear();
  accepted.mockClear();
  closed.mockClear();
  restarted.mockClear();
  window.confirm = vi.fn(() => true);
  harness.failGrid = false;
  harness.failFaces = [];
  harness.analysisFailure = null;
  harness.analyzedFaces = [];
  harness.analysisCalls = 0;
  harness.analysisGate = null;
  harness.decode = async (input) => prepared(input.name[0] as Face);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  await act(async () =>
    root.render(
      createElement(Capture, {
        onClose: closed,
        onAccept: accepted,
        onImport: async () => {},
        onRestart: restarted,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

// No real camera is used below: lifecycle events, presented-frame callbacks,
// stream state and canvas encoding are all simulated explicitly.
function installCamera() {
  const sessions: {
    track: MediaStreamTrack & { muted: boolean; readyState: string };
    media: MediaStream;
  }[] = [];
  const getUserMedia = vi.fn(async () => {
    const target = document.createElement("div");
    const track = Object.assign(target, {
      readyState: "live",
      muted: false,
      enabled: true,
      stop: vi.fn(() => {
        track.readyState = "ended";
      }),
    });
    const media = {
      get active() {
        return track.readyState === "live";
      },
      getTracks: () => [track],
      getVideoTracks: () => [track],
    };
    sessions.push({
      track: track as unknown as MediaStreamTrack & {
        muted: boolean;
        readyState: string;
      },
      media: media as unknown as MediaStream,
    });
    return media as unknown as MediaStream;
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return { sessions, getUserMedia };
}
function videoElement() {
  return document.querySelector("video") as HTMLVideoElement;
}
function setVideo(
  video: HTMLVideoElement,
  values: Record<string, unknown> = {},
) {
  for (const [key, value] of Object.entries({
    videoWidth: 1920,
    videoHeight: 1440,
    readyState: 4,
    ended: false,
    error: null,
    paused: false,
    ...values,
  }))
    Object.defineProperty(video, key, {
      value,
      writable: true,
      configurable: true,
    });
}
async function emit(target: EventTarget, event: string) {
  await act(async () => {
    target.dispatchEvent(new window.Event(event));
  });
}
async function presentFrame(video: HTMLVideoElement) {
  await act(async () => {
    const callbacks = [...(cameraFrames.get(video)?.values() ?? [])];
    cameraFrames.get(video)?.clear();
    callbacks.forEach((callback) =>
      callback(1, { presentedFrames: 1 } as VideoFrameCallbackMetadata),
    );
  });
}
async function openReadyCamera() {
  await click(named("打开相机"));
  const video = videoElement();
  setVideo(video);
  await emit(video, "loadeddata");
  await presentFrame(video);
  return video;
}
describe("live camera lifecycle (simulated DOM/stream events)", () => {
  it("waits for a presented frame and keeps the guide square when video dimensions change", async () => {
    installCamera();
    await click(named("打开相机"));
    const video = videoElement();
    setVideo(video, { videoWidth: 1080, videoHeight: 1920 });
    await emit(video, "loadeddata");
    expect(named("拍摄并识别").disabled).toBe(true);
    await presentFrame(video);
    expect(named("拍摄并识别").disabled).toBe(false);
    const stage = document.querySelector(".live-photo") as HTMLElement;
    expect(stage.style.aspectRatio).toBe("1080 / 1920");
    const checkGuide = (width: number, height: number) => {
      const grid = document.querySelector(".camera-grid") as HTMLElement;
      const [top, left] = grid.style.inset.split(" ").map(parseFloat);
      expect(width * (1 - (2 * left) / 100)).toBeCloseTo(
        height * (1 - (2 * top) / 100),
      );
    };
    checkGuide(1080, 1920);
    setVideo(video, { videoWidth: 1920, videoHeight: 1080 });
    await emit(video, "resize");
    expect(stage.style.aspectRatio).toBe("1920 / 1080");
    checkGuide(1920, 1080);
  });
  it("disables capture on mute or waiting and requires a fresh frame after unmute or playing", async () => {
    const camera = installCamera(),
      video = await openReadyCamera(),
      track = camera.sessions[0].track;
    track.muted = true;
    await emit(track, "mute");
    expect(named("拍摄并识别").disabled).toBe(true);
    track.muted = false;
    await emit(track, "unmute");
    expect(named("拍摄并识别").disabled).toBe(true);
    await presentFrame(video);
    expect(named("拍摄并识别").disabled).toBe(false);
    await emit(video, "waiting");
    expect(named("拍摄并识别").disabled).toBe(true);
    await emit(video, "playing");
    expect(named("拍摄并识别").disabled).toBe(true);
    await presentFrame(video);
    expect(named("拍摄并识别").disabled).toBe(false);
    video.pause();
    await emit(video, "pause");
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it("retains the pending batch when a track ends and reopens only after an explicit click", async () => {
    harness.failGrid = true;
    await select([file("F"), file("R")]);
    const before = colors(),
      camera = installCamera();
    await openReadyCamera();
    const removeOldListener = vi.spyOn(
      camera.sessions[0].track,
      "removeEventListener",
    );
    camera.sessions[0].track.readyState = "ended";
    await emit(camera.sessions[0].track, "ended");
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(named("重新打开相机").disabled).toBe(false);
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(colors()).toBe(before);
    expect(meter()).toContain("已拍 2 张");
    await click(named("重新打开相机"));
    expect(camera.getUserMedia).toHaveBeenCalledTimes(2);
    const video = videoElement();
    setVideo(video);
    await emit(video, "playing");
    await presentFrame(video);
    expect(video.srcObject).toBe(camera.sessions[1].media);
    expect(named("拍摄并识别").disabled).toBe(false);
    for (const event of ["mute", "unmute", "ended"])
      expect(removeOldListener).toHaveBeenCalledWith(
        event,
        expect.any(Function),
      );
    await emit(camera.sessions[0].track, "mute");
    expect(named("拍摄并识别").disabled).toBe(false);
    await menu("关闭相机");
    harness.failGrid = false;
    await showReview();
    await click(named("调整前面照片"));
    await click(named("识别框选九格"));
    await click(named("调整右面照片"));
    await click(named("识别框选九格"));
    expect(colors().slice(18, 27)).toBe("F".repeat(9));
    expect(colors().slice(9, 18)).toBe("R".repeat(9));
  });
  it("keeps capture paused across visibility/pagehide returns without reopening permissions", async () => {
    const camera = installCamera(),
      video = await openReadyCamera();
    const before = colors();
    pageVisibility = "hidden";
    await emit(document, "visibilitychange");
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(video.paused).toBe(true);
    pageVisibility = "visible";
    await emit(document, "visibilitychange");
    await emit(video, "playing");
    await presentFrame(video);
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(colors()).toBe(before);
    await click(named("重新打开相机"));
    const reopened = videoElement();
    setVideo(reopened);
    await emit(reopened, "playing");
    await presentFrame(reopened);
    expect(named("拍摄并识别").disabled).toBe(false);
    await emit(window, "pagehide");
    await emit(window, "pageshow");
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(camera.getUserMedia).toHaveBeenCalledTimes(2);
  });
  it("rejects a stale ready button when the actual track ended without an event", async () => {
    const camera = installCamera();
    await openReadyCamera();
    const before = colors();
    camera.sessions[0].track.readyState = "ended";
    await click(named("拍摄并识别"));
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(document.querySelector(".capture-error")?.textContent).toContain(
      "没有可用画面",
    );
    expect(harness.analysisCalls).toBe(0);
    expect(colors()).toBe(before);
  });
  it("captures the whole portrait frame and automatically commits nine cells without using the guide as a crop", async () => {
    const camera = installCamera(),
      video = await openReadyCamera();
    setVideo(video, { videoWidth: 2160, videoHeight: 3840 });
    await emit(video, "resize");
    harness.decode = async () => prepared("F");
    const create = document.createElement.bind(document),
      draw = vi.fn();
    let snapshot!: HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === "canvas") {
        snapshot = element as HTMLCanvasElement;
        Object.assign(element, {
          getContext: () => ({ drawImage: draw }),
          toBlob: (callback: BlobCallback) =>
            callback(new Blob(["snapshot"], { type: "image/jpeg" })),
        });
      }
      return element;
    });
    await click(named("拍摄并识别"));
    expect(draw).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 1152, 2048);
    expect([snapshot.width, snapshot.height]).toEqual([1, 1]);
    expect(colors().slice(18, 27)).toBe("F".repeat(9));
    expect(harness.analysisCalls).toBe(1);
    expect(camera.sessions[0].track.stop).not.toHaveBeenCalled();
  });
  it("does not publish a frame if the camera is interrupted while encoding the snapshot", async () => {
    const camera = installCamera();
    await openReadyCamera();
    const before = colors();
    let finish!: BlobCallback;
    const create = document.createElement.bind(document),
      draw = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === "canvas")
        Object.assign(element, {
          getContext: () => ({ drawImage: draw }),
          toBlob: (callback: BlobCallback) => {
            finish = callback;
          },
        });
      return element;
    });
    await click(named("拍摄并识别"));
    expect(draw).toHaveBeenCalledOnce();
    camera.sessions[0].track.muted = true;
    await emit(camera.sessions[0].track, "mute");
    await act(async () => {
      finish(new Blob(["snapshot"], { type: "image/jpeg" }));
    });
    expect(harness.analysisCalls).toBe(0);
    expect(colors()).toBe(before);
    expect(document.querySelector(".capture-error")?.textContent).toContain(
      "拍摄期间相机已暂停或中断",
    );
  });
  it("retains the encoded camera file for local saving when its grid is not found", async () => {
    installCamera();
    await openReadyCamera();
    harness.failGrid = true;
    harness.decode = async () => prepared("F");
    const create = document.createElement.bind(document),
      encoded = new Blob([new Uint8Array([255, 216, 13, 27, 255, 217])], {
        type: "image/jpeg",
      }),
      before = colors();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === "canvas")
        Object.assign(element, {
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: BlobCallback) => callback(encoded),
        });
      return element;
    });
    await click(named("拍摄并识别"));
    await showReview();
    await click(named("查看前面"));
    const link = document.querySelector("a[download]")!;
    expect(link.getAttribute("download")).toBe("AXIS-F-相机照片.jpg");
    const downloaded = await fetch(link.getAttribute("href")!);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(
      new Uint8Array(await encoded.arrayBuffer()),
    );
    expect(colors()).toBe(before);
    expect(document.querySelector(".capture-warning")?.textContent).toContain(
      "没有找到完整九格",
    );
  });
  it("offers recovery after a video error without erasing the draft", async () => {
    installCamera();
    const video = await openReadyCamera(),
      before = colors();
    await emit(video, "error");
    expect(named("拍摄并识别").disabled).toBe(true);
    expect(named("重新打开相机").disabled).toBe(false);
    expect(colors()).toBe(before);
  });
  it("ignores playback rejection from the old stream after reopening the camera", async () => {
    installCamera();
    let rejectOld!: (error: Error) => void;
    vi.spyOn(
      HTMLElement.prototype as unknown as HTMLMediaElement,
      "play",
    ).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    await click(named("打开相机"));
    await click(named("重新打开相机"));
    const video = videoElement();
    setVideo(video);
    await emit(video, "playing");
    await presentFrame(video);
    expect(named("拍摄并识别").disabled).toBe(false);
    await act(async () => {
      rejectOld(new Error("old stream stopped"));
    });
    expect(document.querySelector(".capture-error")).toBeNull();
    expect(named("拍摄并识别").disabled).toBe(false);
  });
});
const buttons = () => [...document.querySelectorAll("button")];
function named(text: string) {
  const value = buttons().find(
    (button) =>
      button.getAttribute("aria-label") === text ||
      button.textContent?.trim() === text,
  );
  if (!value) throw new Error(`Missing button: ${text}`);
  return value;
}
async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
async function select(files: File[], label = "选择魔方照片") {
  const input = document.querySelector(
    `input[aria-label="${label}"]`,
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}
const colors = () => JSON.parse(data.get(CAPTURE_DRAFT_KEY)!).colors as string;
let reopenId = 0;
async function reopenCapture() {
  await act(async () =>
    root.render(
      createElement(Capture, {
        key: `reopened-${++reopenId}`,
        onClose: closed,
        onAccept: accepted,
        onImport: async () => {},
        onRestart: restarted,
      }),
    ),
  );
}

const order: Face[] = ["F", "R", "B", "L", "U", "D"];
const names: Record<Face, string> = {
  F: "前",
  R: "右",
  B: "后",
  L: "左",
  U: "上",
  D: "下",
};
const phase = () =>
  document.querySelector("dialog")?.getAttribute("data-phase");
const meter = () =>
  document.querySelector(".capture-meter")?.getAttribute("aria-label");
const faceColors = (face: Face) =>
  colors().slice(FACES.indexOf(face) * 9, FACES.indexOf(face) * 9 + 9);
const status = (face: Face) =>
  document
    .querySelector(`.capture-steps button[aria-label^="${names[face]}面，"]`)
    ?.getAttribute("data-status");
async function menu(action: string) {
  await click(named("更多录入操作"));
  await click(named(action));
}
async function showReview() {
  if (phase() !== "review") await menu("查看六面进度");
}
async function replaceFace(face: Face, input: File, label = "选择魔方照片") {
  await showReview();
  await click(named(`查看${names[face]}面`));
  await click(named("重拍这一面"));
  await select([input], label);
}
function noAcceptance() {
  expect(
    buttons().find((button) => button.textContent?.trim() === "生成机器人演示")
      ?.disabled ?? true,
  ).toBe(true);
  expect(document.querySelector(".validation.valid")).toBeNull();
  expect(accepted).not.toHaveBeenCalled();
}
function installSnapshot(encode?: (callback: BlobCallback) => void) {
  const create = document.createElement.bind(document),
    draw = vi.fn();
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const element = create(tag);
    if (tag === "canvas")
      Object.assign(element, {
        getContext: () => ({ drawImage: draw }),
        toBlob:
          encode ??
          ((callback: BlobCallback) =>
            callback(new Blob(["snapshot"], { type: "image/jpeg" }))),
      });
    return element;
  });
  return draw;
}

// These tests use simulated streams/frames only. Face pixels, decoding and worker
// results are controlled; real capture-state classification and persistence run.
describe("continuous six-shutter collection", () => {
  it("keeps one stream through the first five shots and moves through all six faces before review", async () => {
    const camera = installCamera();
    await openReadyCamera();
    installSnapshot();
    let decoded = 0;
    harness.decode = async () => prepared(order[decoded++]);
    for (let index = 0; index < 6; index++) {
      expect(document.querySelector("h2")?.textContent).toBe(
        `拍摄${names[order[index]]}面`,
      );
      await click(named("拍摄并识别"));
      expect(meter()).toBe(
        `已拍 ${index + 1} 张，颜色已保存 ${index + 1} 面，共六面`,
      );
      if (index < 5) {
        expect(phase()).toBe("collect");
        expect(camera.sessions[0].track.stop).not.toHaveBeenCalled();
        expect(named("拍摄并识别").disabled).toBe(false);
      }
    }
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(camera.sessions[0].track.stop).toHaveBeenCalledOnce();
    expect(phase()).toBe("review");
    expect(harness.analyzedFaces).toEqual(order);
    expect(colors()).toBe(SOLVED);
    expect(named("生成机器人演示").disabled).toBe(false);
  });
  it("accepts all six photos while the first analysis waits, then processes them in order", async () => {
    const camera = installCamera();
    await openReadyCamera();
    installSnapshot();
    let finish!: () => void,
      decoded = 0;
    harness.analysisGate = new Promise((resolve) => {
      finish = resolve;
    });
    harness.decode = async () => prepared(order[decoded++]);
    for (let index = 0; index < 6; index++) {
      await click(named("拍摄并识别"));
      expect(meter()).toBe(`已拍 ${index + 1} 张，颜色已保存 0 面，共六面`);
      expect(harness.analysisCalls).toBe(1);
      if (index < 5) {
        expect(named("拍摄并识别").disabled).toBe(false);
        expect(camera.sessions[0].track.stop).not.toHaveBeenCalled();
      }
    }
    expect(phase()).toBe("review");
    expect(named("正在处理照片").disabled).toBe(true);
    noAcceptance();
    await act(async () => {
      finish();
    });
    expect(harness.analyzedFaces).toEqual(order);
    expect(colors()).toBe(SOLVED);
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it.each(["F", "B"] as Face[])(
    "continues after %s localization fails and adjusts only that retained photo",
    async (failed) => {
      const camera = installCamera();
      await openReadyCamera();
      installSnapshot();
      harness.failFaces = [failed];
      let decoded = 0;
      harness.decode = async () => prepared(order[decoded++]);
      for (let index = 0; index < 6; index++) {
        expect(document.querySelector("h2")?.textContent).toBe(
          `拍摄${names[order[index]]}面`,
        );
        await click(named("拍摄并识别"));
        if (index < 5)
          expect(camera.sessions[0].track.stop).not.toHaveBeenCalled();
      }
      expect(meter()).toBe("已拍 6 张，颜色已保存 5 面，共六面");
      expect(status(failed)).toBe("adjust");
      for (const face of order.filter((face) => face !== failed))
        expect(status(face)).toBe("done");
      const saved = colors();
      noAcceptance();
      harness.decode = async () => prepared(failed);
      await click(named(`调整${names[failed]}面照片`));
      expect(phase()).toBe("adjust");
      expect(document.querySelector('[aria-label="四角框选"]')).not.toBeNull();
      await click(named("返回核对"));
      expect(colors()).toBe(saved);
      expect(status(failed)).toBe("adjust");
      await click(named(`调整${names[failed]}面照片`));
      await click(named("识别框选九格"));
      expect(colors()).toBe(SOLVED);
      expect(phase()).toBe("review");
      expect(harness.analysisCalls).toBe(7);
      expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    },
  );
});

describe("clear previous capture and start again", () => {
  it("keeps the complete draft and current operation when confirmation is cancelled", async () => {
    await select(order.map(file));
    const before = new Map(data),
      disposed = harness.disposeCalls;
    window.confirm = vi.fn(() => false);
    await menu("清空重录");
    expect(data).toEqual(before);
    expect(harness.disposeCalls).toBe(disposed);
    expect(restarted).not.toHaveBeenCalled();
    await click(named("知道了 / 返回"));
    expect(named("生成机器人演示").disabled).toBe(false);
  });
  it("clears restored colors and metadata, preserves saved demos, survives reopening and accepts a fresh capture", async () => {
    await select(order.map(file));
    await click(named("查看前面"));
    await click(named("旋转记录 90°"));
    data.set("axis.saved-demo-test", "keep accepted demonstration");
    await reopenCapture();
    expect(phase()).toBe("entry");
    expect(document.querySelector(".capture-entry")?.textContent).toContain(
      "已保存 6/6 面颜色草稿",
    );
    await click(named("新录一颗 / 清空重录"));
    expect(JSON.parse(data.get(CAPTURE_DRAFT_KEY)!)).toMatchObject(
      emptyCapture(),
    );
    expect(data.get(LEGACY_DRAFT_KEY)).toBe(emptyCapture().colors);
    expect(data.get("axis.saved-demo-test")).toBe(
      "keep accepted demonstration",
    );
    expect(restarted).toHaveBeenCalledOnce();
    expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
    expect(document.querySelector("h2")?.textContent).toBe("拍摄前面");
    await reopenCapture();
    expect(phase()).toBe("entry");
    expect(colors()).toBe(emptyCapture().colors);
    await select(order.map(file));
    await click(named("生成机器人演示"));
    expect(accepted).toHaveBeenCalledWith(SOLVED, expect.any(Object));
  });
  it("discards retained photos and releases their URL on clear", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    harness.failGrid = true;
    await select([file("F"), file("R")]);
    await showReview();
    await click(named("查看前面"));
    const url = document.querySelector<HTMLAnchorElement>("a[download]")!.href;
    await menu("清空重录");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).toHaveBeenCalledWith(url);
    await expect(fetch(url)).rejects.toThrow();
    expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
    harness.failGrid = false;
    await select([file("F")]);
    expect(faceColors("F")).toBe("F".repeat(9));
    expect(faceColors("R")).toContain("?");
  });
  it("stops the active camera when clearing and leaves a fresh front-face step", async () => {
    const camera = installCamera();
    await openReadyCamera();
    await menu("清空重录");
    expect(camera.sessions[0].track.stop).toHaveBeenCalledOnce();
    expect(document.querySelector("video")).toBeNull();
    expect(colors()).toBe(emptyCapture().colors);
    expect(document.querySelector("h2")?.textContent).toBe("拍摄前面");
  });
  it("stops a permission response arriving after clear instead of resurrecting its stream", async () => {
    const camera = installCamera();
    const media = await camera.getUserMedia();
    camera.getUserMedia.mockClear();
    let finish!: (media: MediaStream) => void;
    camera.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click(named("打开相机"));
    expect(
      document.querySelector(".capture-view-empty")?.textContent,
    ).toContain("等待相机授权");
    await menu("清空重录");
    await act(async () => {
      finish(media);
    });
    expect(camera.sessions[0].track.stop).toHaveBeenCalledOnce();
    expect(document.querySelector("video")).toBeNull();
    expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
  });
  it("ignores an encoded frame finishing after clear", async () => {
    installCamera();
    await openReadyCamera();
    let finish!: BlobCallback;
    installSnapshot((callback) => {
      finish = callback;
    });
    await click(named("拍摄并识别"));
    await menu("清空重录");
    await act(async () => {
      finish(new Blob(["late"], { type: "image/jpeg" }));
    });
    expect(colors()).toBe(emptyCapture().colors);
    expect(harness.analysisCalls).toBe(0);
    expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
  });
  it("ignores a pre-clear decode after a new round starts", async () => {
    let finish!: (photo: PreparedPhoto) => void;
    harness.decode = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await select([file("F"), file("R")]);
    await menu("清空重录");
    harness.decode = async () => prepared("B");
    await select([file("B")]);
    const fresh = data.get(CAPTURE_DRAFT_KEY);
    await act(async () => {
      finish(prepared("F"));
    });
    expect(data.get(CAPTURE_DRAFT_KEY)).toBe(fresh);
    expect(harness.analysisCalls).toBe(1);
    expect(meter()).toBe("已拍 1 张，颜色已保存 1 面，共六面");
  });
  it("ignores a pre-clear worker response even when disposal cannot stop it", async () => {
    let finish!: () => void;
    harness.analysisGate = new Promise((resolve) => {
      finish = resolve;
    });
    await select([file("F"), file("R")]);
    expect(harness.analysisCalls).toBe(1);
    await menu("清空重录");
    harness.analysisGate = null;
    await select([file("B")]);
    const fresh = data.get(CAPTURE_DRAFT_KEY);
    await act(async () => {
      finish();
    });
    expect(data.get(CAPTURE_DRAFT_KEY)).toBe(fresh);
    expect(harness.analysisCalls).toBe(2);
    expect(meter()).toBe("已拍 1 张，颜色已保存 1 面，共六面");
  });
  it.each(["decode", "analyze"])(
    "ignores a manual editor %s completing after clear",
    async (waiting) => {
      harness.failGrid = true;
      await select([file("F")]);
      await showReview();
      let finish!: () => void;
      if (waiting === "decode")
        harness.decode = () =>
          new Promise((resolve) => {
            finish = () => resolve(prepared("F"));
          });
      await click(named("调整前面照片"));
      if (waiting === "analyze") {
        harness.analysisGate = new Promise((resolve) => {
          finish = resolve;
        });
        await click(named("识别框选九格"));
      }
      await menu("清空重录");
      await act(async () => {
        finish();
      });
      expect(colors()).toBe(emptyCapture().colors);
      expect(phase()).toBe("collect");
      expect(document.querySelector('[aria-label="四角框选"]')).toBeNull();
      expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
    },
  );
  it("warns when storage prevents persisting a clear while clearing the live state", async () => {
    await select([file("F")]);
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await menu("清空重录");
    expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
    expect(
      document.querySelector(".capture-draft-warning")?.textContent,
    ).toContain("可能恢复之前的颜色");
  });
});

describe("six-photo workflow with real state and classification", () => {
  it("explains the restored screenshot's direction conflict beside the action and corrects it without repainting", async () => {
    const original = "BFLUBDUULFRDBRBRLBBLDUULDFFLDRBFDUFDRRUULBFRBLFFRDLRDU";
    data.set(LEGACY_DRAFT_KEY, original);
    data.delete(CAPTURE_DRAFT_KEY);
    await reopenCapture();
    await showReview();
    expect(meter()).toBe("已拍 0 张，颜色已保存 6 面，共六面");
    const controls = document.querySelector(".capture-controls")!;
    expect(controls.textContent).toContain("上面顺时针 90°、下面逆时针 90°");
    expect(named("校正面方向").disabled).toBe(false);
    await click(named("校正面方向"));
    const corrected = colors();
    expect(captureValidation(corrected).valid).toBe(true);
    for (let face = 0; face < 6; face++)
      expect([...corrected.slice(face * 9, face * 9 + 9)].sort()).toEqual(
        [...original.slice(face * 9, face * 9 + 9)].sort(),
      );
    expect(
      document.querySelector(".capture-status-line")?.textContent,
    ).toContain("颜色未改");
    expect(controls.textContent).toContain("请先勾选核对确认");
    expect(named("生成机器人演示").disabled).toBe(true);
    const verified = controls.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(verified).not.toBeNull();
    verified.checked = true;
    await click(verified);
    expect(named("生成机器人演示").disabled).toBe(false);
    await click(named("生成机器人演示"));
    expect(accepted).toHaveBeenCalledWith(
      captureValidation(corrected).normalized!.facelets,
      expect.any(Object),
    );
  });
  it("keeps restored legal review confirmation next to generation and clears it after a new edit", async () => {
    const state = {
      ...emptyCapture(),
      colors: SOLVED,
      status: "review" as const,
      uncertain: [0],
    };
    for (const face of FACES) {
      state.samples[face] = Array.from({ length: 9 }, () => [
        ...REFERENCE[face],
      ]);
      state.evidence[face] = state.samples[face]!.map((rgb, index) => ({
        rgb,
        alternatives: [],
        coverage: face === "U" && index === 0 ? 0.2 : 1,
        glare: 0,
        spread: 0,
      }));
    }
    data.set(CAPTURE_DRAFT_KEY, JSON.stringify(state));
    data.set(LEGACY_DRAFT_KEY, SOLVED);
    await reopenCapture();
    await showReview();
    expect(named("生成机器人演示").disabled).toBe(true);
    const verified = document.querySelector<HTMLInputElement>(
      '.capture-controls input[type="checkbox"]',
    )!;
    verified.checked = true;
    await click(verified);
    expect(named("生成机器人演示").disabled).toBe(false);
    await click(named("需要时手动修正颜色"));
    await click(named("选择白色"));
    await click(named("上面第2格"));
    expect(
      document.querySelector<HTMLInputElement>(
        '.capture-controls input[type="checkbox"]',
      )?.checked ?? false,
    ).toBe(false);
    expect(named("生成机器人演示").disabled).toBe(true);
    await reopenCapture();
    await showReview();
    expect(meter()).toBe("已拍 0 张，颜色已保存 6 面，共六面");
    expect(named("生成机器人演示").disabled).toBe(true);
  });
  it("offers direct checking instead of a dead generate button when directions are ambiguous or impossible", async () => {
    const flipped = [...SOLVED];
    [flipped[5], flipped[10]] = [flipped[10], flipped[5]];
    for (const [value, reason, action] of [
      [
        rotateFace(applyAlgorithm(SOLVED, "R"), "U"),
        "多种可能的面方向",
        "检查高亮格子",
      ],
      [flipped.join(""), "棱块方向不合法", "检查颜色和面顺序"],
    ]) {
      data.set(LEGACY_DRAFT_KEY, value);
      data.delete(CAPTURE_DRAFT_KEY);
      await reopenCapture();
      await showReview();
      expect(
        document.querySelector(".capture-controls")?.textContent,
      ).toContain(reason);
      expect(
        buttons().some((button) => button.textContent === "校正面方向"),
      ).toBe(false);
      await click(named(action));
      expect(named("收起手动修正")).toBeDefined();
      expect(colors()).toBe(value);
      expect(accepted).not.toHaveBeenCalled();
    }
  });
  it("imports six photos once, shows six recognized face cards and accepts the legal state", async () => {
    await select(order.map(file));
    expect(harness.analyzedFaces).toEqual(order);
    expect(colors()).toBe(SOLVED);
    expect(phase()).toBe("review");
    expect(document.querySelectorAll(".capture-face-card")).toHaveLength(6);
    for (const face of order) expect(status(face)).toBe("done");
    await click(named("生成机器人演示"));
    expect(accepted).toHaveBeenCalledWith(SOLVED, expect.any(Object));
  });
  it("continues all other photos after two localization failures and fixes each later", async () => {
    harness.failFaces = ["F", "B"];
    await select(order.map(file));
    expect(harness.analysisCalls).toBe(6);
    expect(meter()).toBe("已拍 6 张，颜色已保存 4 面，共六面");
    noAcceptance();
    for (const face of ["F", "B"] as Face[]) {
      await click(named(`调整${names[face]}面照片`));
      expect(phase()).toBe("adjust");
      await click(named("识别框选九格"));
      expect(status(face)).toBe("done");
    }
    expect(colors()).toBe(SOLVED);
    expect(named("生成机器人演示").disabled).toBe(false);
  });
  it("preserves original file bytes for download without affecting the draft or processing", async () => {
    harness.failFaces = ["F"];
    const original = new File(
      [new Uint8Array([255, 216, 0, 17, 29, 255, 217])],
      "F-camera.jpg",
      { type: "image/jpeg" },
    );
    await select([original, file("R")]);
    await showReview();
    await click(named("查看前面"));
    const link = document.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(link.textContent).toContain("保存当前照片");
    expect(link.download).toBe("AXIS-F-F-camera.jpg");
    expect(
      new Uint8Array(await (await fetch(link.href)).arrayBuffer()),
    ).toEqual(new Uint8Array(await original.arrayBuffer()));
    const saved = data.get(CAPTURE_DRAFT_KEY),
      calls = harness.analysisCalls;
    await click(link);
    expect(data.get(CAPTURE_DRAFT_KEY)).toBe(saved);
    expect(harness.analysisCalls).toBe(calls);
    noAcceptance();
  });
  it("releases old download URLs when replacing a photo and on unmount", async () => {
    harness.failGrid = true;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await select([file("F")]);
    await showReview();
    await click(named("查看前面"));
    const first =
      document.querySelector<HTMLAnchorElement>("a[download]")!.href;
    const replacement = new File(["replacement bytes"], "F-replacement.jpg", {
      type: "image/jpeg",
    });
    await replaceFace("F", replacement);
    await click(named("查看前面"));
    const link = document.querySelector<HTMLAnchorElement>("a[download]")!;
    const second = link.href;
    expect(second).not.toBe(first);
    expect(link.download).toBe("AXIS-F-F-replacement.jpg");
    expect(await (await fetch(second)).text()).toBe("replacement bytes");
    expect(revoke).toHaveBeenCalledWith(first);
    await expect(fetch(first)).rejects.toThrow();
    await act(async () => {
      root.render(null);
    });
    expect(revoke).toHaveBeenCalledWith(second);
    await expect(fetch(second)).rejects.toThrow();
  });
  it.each(["grid", "decode", "analyze"])(
    "does not let a legal saved draft hide a replacement with %s failure",
    async (failure) => {
      await select(order.map(file));
      const saved = data.get(CAPTURE_DRAFT_KEY);
      if (failure === "grid") harness.failGrid = true;
      else if (failure === "decode")
        harness.decode = async () => {
          throw new Error("照片解码失败");
        };
      else harness.analysisFailure = new Error("识别服务不可用");
      await replaceFace("F", file("F"));
      expect(data.get(CAPTURE_DRAFT_KEY)).toBe(saved);
      expect(faceColors("F")).toBe("F".repeat(9));
      expect(status("F")).toBe(failure === "grid" ? "adjust" : "error");
      expect(
        document.querySelector(".capture-status-line")?.textContent,
      ).toContain("此前已保存颜色");
      noAcceptance();
      harness.failGrid = false;
      harness.analysisFailure = null;
      harness.decode = async (input) => prepared(input.name[0] as Face);
      if (failure === "grid") {
        await click(named("调整前面照片"));
        await click(named("识别框选九格"));
      } else await click(named("重试处理照片"));
      expect(named("生成机器人演示").disabled).toBe(false);
    },
  );
  it("blocks an old legal draft while its replacement analysis is pending", async () => {
    await select(order.map(file));
    let finish!: () => void;
    harness.analysisGate = new Promise((resolve) => {
      finish = resolve;
    });
    await replaceFace("B", file("B"));
    expect(colors()).toBe(SOLVED);
    expect(status("B")).toBe("analyzing");
    expect(named("正在处理照片").disabled).toBe(true);
    noAcceptance();
    await act(async () => {
      finish();
    });
    expect(named("生成机器人演示").disabled).toBe(false);
  });
  it("continues the other files after one decode failure and can replace the failed face using the system camera input", async () => {
    harness.decode = async (input) => {
      if (input.name === "F.png") throw new Error("无法解码");
      return prepared(input.name[0] as Face);
    };
    await select(order.map(file));
    expect(status("F")).toBe("error");
    expect(harness.analysisCalls).toBe(5);
    for (const face of order.filter((face) => face !== "F"))
      expect(status(face)).toBe("done");
    await click(named("查看前面"));
    expect(document.querySelector(".capture-warning")?.textContent).toBe(
      "无法解码",
    );
    harness.decode = async (input) => prepared(input.name[0] as Face);
    await replaceFace("F", file("F"), "系统相机照片");
    expect(colors()).toBe(SOLVED);
  });
  it("pauses a broken analysis service with all queued photos retained and resumes them on retry", async () => {
    harness.analysisFailure = new Error("worker unavailable");
    await select(order.map(file));
    expect(harness.analysisCalls).toBe(1);
    expect(status("F")).toBe("error");
    for (const face of order.slice(1)) expect(status(face)).toBe("queued");
    expect(document.querySelector(".capture-error")?.textContent).toContain(
      "识别已暂停",
    );
    noAcceptance();
    harness.analysisFailure = null;
    await click(named("重试处理照片"));
    expect(harness.analysisCalls).toBe(7);
    expect(colors()).toBe(SOLVED);
  });
  it("ignores a decoder finishing after close even if it ignores AbortSignal", async () => {
    let finish!: (photo: PreparedPhoto) => void;
    harness.decode = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await select([file("F")]);
    const before = data.get(LEGACY_DRAFT_KEY);
    await click(named("关闭录入"));
    await act(async () => {
      finish(prepared("F"));
    });
    expect(closed).toHaveBeenCalledOnce();
    expect(data.get(LEGACY_DRAFT_KEY)).toBe(before);
    expect(harness.analysisCalls).toBe(0);
  });
  it("disables changing colors while a replacement decode is pending", async () => {
    await select(order.map(file));
    await click(named("需要时手动修正颜色"));
    let finish!: (photo: PreparedPhoto) => void;
    harness.decode = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await replaceFace("F", file("F"));
    expect(named("收起手动修正").disabled).toBe(true);
    expect(document.querySelectorAll(".cube-net button")).toHaveLength(0);
    await act(async () => {
      finish(prepared("F"));
    });
    expect(named("收起手动修正").disabled).toBe(false);
  });
  it("preserves photos, colors and active camera when the album picker is cancelled", async () => {
    await select([file("F")]);
    const camera = installCamera();
    await openReadyCamera();
    const saved = data.get(CAPTURE_DRAFT_KEY),
      calls = harness.analysisCalls;
    await click(named("导入照片"));
    await select([]);
    expect(data.get(CAPTURE_DRAFT_KEY)).toBe(saved);
    expect(harness.analysisCalls).toBe(calls);
    expect(status("F")).toBe("done");
    expect(document.querySelector("h2")?.textContent).toBe("拍摄右面");
    expect(named("拍摄并识别").disabled).toBe(false);
    expect(camera.sessions[0].track.stop).not.toHaveBeenCalled();
  });
  it("leaves the original face untouched when a replacement album selection is cancelled", async () => {
    await select(order.map(file));
    const saved = data.get(CAPTURE_DRAFT_KEY);
    await click(named("查看前面"));
    await click(named("重拍这一面"));
    await select([]);
    await showReview();
    expect(data.get(CAPTURE_DRAFT_KEY)).toBe(saved);
    expect(status("F")).toBe("done");
    expect(named("生成机器人演示").disabled).toBe(false);
  });
});

describe("replacement races and recovery", () => {
  it("disables alternate inputs while encoding and ignores a late picker event", async () => {
    installCamera();
    await openReadyCamera();
    let finish!: BlobCallback;
    installSnapshot((callback) => {
      finish = callback;
    });
    harness.decode = async () => prepared("F");
    await click(named("拍摄并识别"));
    await click(named("更多录入操作"));
    const menuButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(".capture-sheet button"),
    ];
    for (const label of ["导入照片", "使用系统相机"])
      expect(
        menuButtons.find((button) => button.textContent?.trim() === label)
          ?.disabled,
      ).toBe(true);
    await select(order.map(file));
    expect(meter()).toBe("已拍 0 张，颜色已保存 0 面，共六面");
    expect(harness.analysisCalls).toBe(0);
    await act(async () => {
      finish(new Blob(["snapshot"], { type: "image/jpeg" }));
    });
    expect(meter()).toBe("已拍 1 张，颜色已保存 1 面，共六面");
    expect(status("F")).toBe("done");
    expect(status("R")).toBe("empty");
  });
  it.each(["decode", "analyze"])(
    "does not let an obsolete %s rejection stop newer photos",
    async (waiting) => {
      let rejectOld!: (error: Error) => void;
      if (waiting === "decode") {
        let first = true;
        harness.decode = async (input) => {
          if (!first) return prepared(input.name[0] as Face);
          first = false;
          return new Promise((_resolve, reject) => {
            rejectOld = reject;
          });
        };
      } else
        harness.analysisGate = new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      await select([file("F")]);
      harness.analysisGate = null;
      await select(order.map(file));
      await act(async () => {
        rejectOld(new Error("obsolete job failed"));
      });
      expect(colors()).toBe(SOLVED);
      for (const face of order) expect(status(face)).toBe("done");
      expect(document.querySelector(".capture-error")).toBeNull();
      expect(named("生成机器人演示").disabled).toBe(false);
      expect(harness.analysisCalls).toBe(waiting === "decode" ? 6 : 7);
    },
  );
  it("allows a new shutter after a service failure and successfully processes its replacement", async () => {
    harness.analysisFailure = new Error("service unavailable");
    await select([file("F")]);
    expect(status("F")).toBe("error");
    await click(named("查看前面"));
    await click(named("重拍这一面"));
    const camera = installCamera();
    await openReadyCamera();
    expect(named("拍摄并识别").disabled).toBe(false);
    harness.analysisFailure = null;
    harness.decode = async () => prepared("F");
    installSnapshot();
    await click(named("拍摄并识别"));
    expect(status("F")).toBe("done");
    expect(faceColors("F")).toBe("F".repeat(9));
    expect(camera.getUserMedia).toHaveBeenCalledOnce();
  });
  it.each(["grid", "decode", "analyze"])(
    "can undo a replacement with %s failure to recover the original file, quad and legal draft",
    async (failure) => {
      const original = new File(["original bytes"], "F-original.jpg", {
        type: "image/jpeg",
      });
      await select([original, ...order.slice(1).map(file)]);
      await click(named("查看前面"));
      await click(named("调整照片边界"));
      const originalQuad = document
        .querySelector('[aria-label="四角框选"]')
        ?.getAttribute("data-quad");
      expect(originalQuad).toBeTruthy();
      await click(named("返回核对"));
      const saved = data.get(CAPTURE_DRAFT_KEY);
      if (failure === "grid") harness.failGrid = true;
      else if (failure === "decode")
        harness.decode = async () => {
          throw new Error("bad replacement");
        };
      else harness.analysisFailure = new Error("bad service");
      const replacement = new File(
        ["failed replacement bytes"],
        "F-replacement.jpg",
        { type: "image/jpeg" },
      );
      await replaceFace("F", replacement);
      await click(named("查看前面"));
      expect(data.get(CAPTURE_DRAFT_KEY)).toBe(saved);
      noAcceptance();
      await click(named("撤销本次替换"));
      const link = document.querySelector<HTMLAnchorElement>("a[download]")!;
      expect(link.download).toBe("AXIS-F-F-original.jpg");
      expect(await (await fetch(link.href)).text()).toBe("original bytes");
      expect(status("F")).toBe("done");
      expect(named("生成机器人演示").disabled).toBe(false);
      expect(
        buttons().find(
          (button) => button.textContent?.trim() === "撤销本次替换",
        ),
      ).toBeUndefined();
      harness.decode = async () => prepared("F");
      await click(named("调整照片边界"));
      expect(
        document
          .querySelector('[aria-label="四角框选"]')
          ?.getAttribute("data-quad"),
      ).toBe(originalQuad);
    },
  );
  it("keeps the original recovery photo across repeated failed replacements and releases it after success", async () => {
    const original = new File(["original"], "F-original.jpg", {
      type: "image/jpeg",
    });
    await select([original, ...order.slice(1).map(file)]);
    harness.failGrid = true;
    await replaceFace(
      "F",
      new File(["failure one"], "F-bad-one.jpg", { type: "image/jpeg" }),
    );
    await replaceFace(
      "F",
      new File(["failure two"], "F-bad-two.jpg", { type: "image/jpeg" }),
    );
    await click(named("查看前面"));
    await click(named("撤销本次替换"));
    expect(
      document.querySelector<HTMLAnchorElement>("a[download]")!.download,
    ).toBe("AXIS-F-F-original.jpg");
    harness.failGrid = false;
    await replaceFace(
      "F",
      new File(["success"], "F-success.jpg", { type: "image/jpeg" }),
    );
    await click(named("查看前面"));
    expect(
      document.querySelector<HTMLAnchorElement>("a[download]")!.download,
    ).toBe("AXIS-F-F-success.jpg");
    expect(
      buttons().find((button) => button.textContent?.trim() === "撤销本次替换"),
    ).toBeUndefined();
  });
});
