import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Download,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  ScanLine,
  Trash2,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  COLOR_NAMES,
  COLORS,
  DEFAULT_PALETTE,
  FACES,
  FACE_NAMES,
  type Face,
  type Palette,
} from "../core/cube";
import {
  CAPTURE_ORDER,
  applyCaptureOrientation,
  captureValidation,
  commitFace,
  emptyCapture,
  isCompleteFace,
  paintCaptureCell,
  rotateCaptureFace,
  type CaptureState,
} from "../core/capture-state";
import { proposeCaptureOrientation } from "../core/capture-orientation";
import { decodePhoto, type PreparedPhoto } from "../core/photo-input";
import { cameraFrameIsReady, cameraGuideInsets } from "../core/camera-frame";
import { VisionClient } from "./vision-client";
import type { FaceAnalysis } from "../core/vision-contract";
import type { Quad } from "../core/vision";
import { CapturePhoto } from "../components/CapturePhoto";
import { CubeNet } from "../components/CubeNet";

const TOP: Record<Face, Face> = {
  F: "U",
  R: "U",
  B: "U",
  L: "U",
  U: "B",
  D: "F",
};
const BOTTOM: Record<Face, Face> = {
  F: "D",
  R: "D",
  B: "D",
  L: "D",
  U: "F",
  D: "B",
};
const LEFT: Record<Face, Face> = {
  F: "L",
  R: "F",
  B: "R",
  L: "B",
  U: "L",
  D: "L",
};
const TURN_GUIDE: Record<Face, { arrow: string; hint: string }> = {
  F: { arrow: "◉", hint: "选定前面与顶面，保持顶面朝上" },
  R: { arrow: "↶ 左转90°", hint: "整颗魔方向左横转 90°，把原右面转向镜头" },
  B: { arrow: "↶ 再左转90°", hint: "继续向左横转 90°，顶面颜色保持不变" },
  L: { arrow: "↶ 再左转90°", hint: "继续向左横转 90°，拍完四周侧面" },
  U: { arrow: "↷ 回前面·下翻90°", hint: "先回前面朝向，再把顶面朝镜头翻出" },
  D: { arrow: "⇅ 上下翻转180°", hint: "右面不动，把魔方上下翻转半圈拍底面" },
};
type Job = { face: Face; file: File; revision?: number };
type PendingPhoto = {
  face: Face;
  file: File;
  image: PreparedPhoto;
  quad: Quad;
  message: string;
};
type PhotoStatus = "queued" | "analyzing" | "adjust" | "done" | "error";
type PhotoRecord = {
  previous?: PhotoRecord;
  file: File;
  revision: number;
  status: PhotoStatus;
  thumbnail?: string;
  quad?: Quad;
  message?: string;
};
type Phase = "entry" | "collect" | "adjust" | "review";
const RIGHT: Record<Face, Face> = {
  F: "R",
  R: "B",
  B: "L",
  L: "F",
  U: "R",
  D: "R",
};
import "../components/Capture.css";
import{localSolveStore}from"./storage";
function SavePhotoLink({ file, face }: Job) {
  const [source, setSource] = useState<{ file: File; url: string } | null>(
    null,
  );
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // A replacement must never briefly offer the previous photograph.
  if (source?.file !== file) return null;
  return (
    <a
      className="subtle-button"
      href={source.url}
      download={`AXIS-${face}-${file.name}`}
      title="保存这次用于识别的照片，方便之后重新导入；只保存到本机"
    >
      <Download size={14} />
      保存当前照片
    </a>
  );
}
function defaultQuad(image: PreparedPhoto): Quad {
  const { width, height } = image.pixels,
    size = Math.min(width, height) * 0.72;
  return [
    [(width - size) / 2, (height - size) / 2],
    [(width + size) / 2, (height - size) / 2],
    [(width + size) / 2, (height + size) / 2],
    [(width - size) / 2, (height + size) / 2],
  ];
}
function photoFromVideo(
  video: HTMLVideoElement,
  media: MediaStream,
): Promise<File> {
  if (!cameraFrameIsReady(video, media, document.visibilityState !== "hidden"))
    return Promise.reject(new Error("相机尚未就绪，请等画面清晰后拍摄。"));
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    2048 / Math.max(video.videoWidth, video.videoHeight),
  );
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx)
    return Promise.reject(
      new Error("无法读取相机画面，请使用系统相机拍摄后导入。"),
    );
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        canvas.width = canvas.height = 1;
        if (blob)
          resolve(new File([blob], "相机照片.jpg", { type: "image/jpeg" }));
        else reject(new Error("相机照片没有保存成功，请重新拍摄。"));
      },
      "image/jpeg",
      0.96,
    ),
  );
}

export function SolveCapture({
  onClose,
  onAccept,
  onImport,
  onRestart,
  busy=false,externalError="",onCancelSolve,onChange,
}: {
  onClose: () => void;
  onAccept: (state: string, palette: Palette) => void;
  onImport: (file: File) => Promise<string | void>;
  onRestart: () => void;
  busy?:boolean;externalError?:string;onCancelSolve?:()=>void;onChange?:()=>void;
}) {
  const[recordStore]=useState(localSolveStore);
  const dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const photoInput = useRef<HTMLInputElement>(null),
    nativeCamera = useRef<HTMLInputElement>(null),
    savedFile = useRef<HTMLInputElement>(null);
  const view = useRef<HTMLDivElement>(null),
    detailPanel = useRef<HTMLElement>(null);
  const reviewNet = useRef<HTMLDivElement>(null);
  const sheetPanel = useRef<HTMLElement>(null);
  const stream = useRef<MediaStream | null>(null),
    cameraRequest = useRef(0),
    cameraFrameVersion = useRef(0),
    cameraMessage = useRef("");
  const request = useRef(0),
    editorRequest = useRef(0),
    sequence = useRef(0),
    snapshotBusy = useRef(false),
    manualBusy = useRef(false);
  const abort = useRef<AbortController | null>(null),
    editorAbort = useRef<AbortController | null>(null),
    client = useRef(new VisionClient());
  const queue = useRef<Job[]>([]),
    activeJob = useRef<Job | null>(null),
    working = useRef(false),
    queuePaused = useRef(false);
  const records = useRef<Partial<Record<Face, PhotoRecord>>>({});
  const [photos, setPhotos] = useState(records.current);
  const [capture, setCapture] = useState(() => recordStore.loadDraft().value??emptyCapture());
  const current = useRef(capture);
  const [face, setFace] = useState<Face>(
    () => CAPTURE_ORDER.find((f) => !isCompleteFace(capture.colors, f)) ?? "F",
  );
  const target = useRef(face);
  const [phase, setPhase] = useState<Phase>("entry");
  const phaseRef = useRef<Phase>("entry");
  const [camera, setCamera] = useState(false),
    [cameraOpening, setCameraOpening] = useState(false),
    [cameraSession, setCameraSession] = useState(0),
    [cameraReady, setCameraReady] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 4, height: 3 }),
    [viewSize, setViewSize] = useState({ width: 320, height: 320 });
  const [processing, setProcessing] = useState(false),
    [progress, setProgress] = useState("");
  const [taking, setTaking] = useState(false),
    [editorBusy, setEditorBusy] = useState(false);
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(()=>recordStore.loadDraft().warning),
    [savingWarning, setSavingWarning] = useState(false);
  const [paint, setPaint] = useState<Face>("U"),
    [editingColors, setEditingColors] = useState(false),
    [verified, setVerified] = useState(false);
  const [liveHint, setLiveHint] = useState<{
    status: "ready" | "motion" | "glare";
    label: string;
  }>({ status: "ready", label: "✓ 画面稳定 · 可拍摄" });
  const [sheet, setSheet] = useState<"menu" | "help" | "import" | null>(null),
    [detail, setDetail] = useState<Face | null>(null);
  const iOSPhotoLibrary =
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  const replacing = useRef(false);
  function changePhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }
  function chooseFace(next: Face) {
    target.current = next;
    setFace(next);
  }
  function publish(next: CaptureState) {
    onChange?.();
    setSavingWarning(!recordStore.saveDraft(next));
    current.current = next;
    setCapture(next);
    setVerified(false);
  }
  function updatePhotos(next: Partial<Record<Face, PhotoRecord>>) {
    records.current = next;
    setPhotos(next);
  }
  function updatePhoto(job: Job, patch: Partial<PhotoRecord>) {
    const item = records.current[job.face];
    if (!item || item.revision !== job.revision) return false;
    updatePhotos({ ...records.current, [job.face]: { ...item, ...patch } });
    return true;
  }
  function stopCamera() {
    cameraRequest.current++;
    cameraFrameVersion.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCamera(false);
    setCameraReady(false);
    setCameraOpening(false);
  }
  function cancelWork() {
    request.current++;
    editorRequest.current++;
    abort.current?.abort();
    editorAbort.current?.abort();
    client.current.dispose();
    queue.current = [];
    activeJob.current = null;
    working.current = false;
    queuePaused.current = false;
    snapshotBusy.current = false;
    manualBusy.current = false;
    setProcessing(false);
    setEditorBusy(false);
    setTaking(false);
    setProgress("");
  }
  function leaveEditor() {
    if (manualBusy.current) client.current.dispose();
    manualBusy.current = false;
    editorRequest.current++;
    editorAbort.current?.abort();
    setEditorBusy(false);
    setPending(null);
  }
  function review() {
    stopCamera();
    leaveEditor();
    setSheet(null);
    changePhase("review");
  }
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      request.current++;
      editorRequest.current++;
      cameraRequest.current++;
      abort.current?.abort();
      editorAbort.current?.abort();
      client.current.dispose();
      stream.current?.getTracks().forEach((track) => track.stop());
      records.current = {};
      queue.current = [];
    };
  }, []);
  useEffect(() => {
    if (phase === "review" && detail)
      detailPanel.current?.scrollIntoView?.({ block: "start" });
  }, [phase, detail]);
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement | null;
    sheetPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [sheet]);
  useEffect(() => {
    const node = view.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const resize = () =>
      setViewSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => observer.disconnect();
  }, [phase, camera]);
  useEffect(() => {
    if (!camera || !video.current || !stream.current) return;
    const element = video.current,
      media = stream.current,
      id = cameraRequest.current;
    let active = true,
      pageSuspended = false;
    let frameRequest: number | undefined;
    const isCurrent = () =>
      active &&
      id === cameraRequest.current &&
      stream.current === media &&
      video.current === element;
    const cancelFrame = () => {
      if (frameRequest !== undefined)
        element.cancelVideoFrameCallback?.(frameRequest);
      frameRequest = undefined;
    };
    const unavailable = (message: string) => {
      if (!isCurrent()) return;
      cancelFrame();
      cameraFrameVersion.current++;
      setCameraReady(false);
      cameraMessage.current = message;
      setError(message);
    };
    const resize = () => {
      if (isCurrent() && element.videoWidth > 0 && element.videoHeight > 0)
        setVideoSize({
          width: element.videoWidth,
          height: element.videoHeight,
        });
    };
    const confirmFrame = () => {
      frameRequest = undefined;
      if (
        !isCurrent() ||
        pageSuspended ||
        !cameraFrameIsReady(
          element,
          media,
          document.visibilityState !== "hidden",
        )
      )
        return;
      resize();
      setCameraReady(true);
      const message = cameraMessage.current;
      cameraMessage.current = "";
      setError((old) => (old === message ? "" : old));
    };
    const ready = () => {
      if (!isCurrent() || pageSuspended) return;
      resize();
      cancelFrame();
      if (
        !cameraFrameIsReady(
          element,
          media,
          document.visibilityState !== "hidden",
        )
      )
        return;
      // Confirm one newly presented frame after a pause where the API is available.
      if (typeof element.requestVideoFrameCallback === "function")
        frameRequest = element.requestVideoFrameCallback(confirmFrame);
      else confirmFrame();
    };
    const waiting = () =>
      unavailable(
        "相机画面暂时暂停，恢复后可继续拍摄，也可点击“重新打开相机”。",
      );
    const paused = () => {
      if (!pageSuspended)
        unavailable("相机预览已暂停，请点击“重新打开相机”继续拍摄。");
    };
    const muted = () =>
      unavailable(
        "相机暂时没有画面，恢复后可继续拍摄，也可点击“重新打开相机”。",
      );
    const ended = () =>
      unavailable("相机连接已中断。已录入的面已保留，请点击“重新打开相机”。");
    const failed = () =>
      unavailable("相机画面无法播放，请点击“重新打开相机”，或使用系统相机。");
    const suspend = () => {
      if (!isCurrent()) return;
      pageSuspended = true;
      unavailable(
        "离开页面后相机已暂停。已录入的面已保留，回来后请点击“重新打开相机”。",
      );
      element.pause();
      media.getTracks().forEach((track) => track.stop());
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") suspend();
      else if (pageSuspended)
        unavailable(
          "已回到页面，请点击“重新打开相机”继续拍摄；已录入的面和待处理照片已保留。",
        );
    };
    const listeners: [string, EventListener][] = [
      ["loadedmetadata", resize],
      ["resize", resize],
      ["loadeddata", ready],
      ["canplay", ready],
      ["playing", ready],
      ["waiting", waiting],
      ["emptied", waiting],
      ["pause", paused],
      ["error", failed],
    ];
    listeners.forEach(([name, handler]) =>
      element.addEventListener(name, handler),
    );
    const tracks = media.getVideoTracks();
    tracks.forEach((track) => {
      track.addEventListener("mute", muted);
      track.addEventListener("unmute", ready);
      track.addEventListener("ended", ended);
    });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", visibility);
    element.srcObject = media;
    if (document.visibilityState === "hidden") suspend();
    else void element.play().then(ready).catch(failed);
    const probeCanvas = document.createElement("canvas");
    probeCanvas.width = 24;
    probeCanvas.height = 24;
    const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
    let prevLuma: Float32Array | null = null;
    const probeTimer = window.setInterval(() => {
      if (!isCurrent() || pageSuspended || element.paused || !probeCtx) return;
      try {
        probeCtx.drawImage(element, 0, 0, 24, 24);
        const data = probeCtx.getImageData(4, 4, 16, 16).data;
        const currLuma = new Float32Array(256);
        let glarePixels = 0;
        let diffSum = 0;
        for (let i = 0; i < 256; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          const y = 0.299 * r + 0.587 * g + 0.114 * b;
          currLuma[i] = y;
          if (r > 245 && g > 245 && b > 245) glarePixels++;
          if (prevLuma) diffSum += Math.abs(y - prevLuma[i]);
        }
        prevLuma = currLuma;
        const glareRatio = glarePixels / 256;
        const meanDiff = diffSum / 256;
        if (glareRatio > 0.16) {
          setLiveHint({ status: "glare", label: "⚠ 注意反光 · 请微调倾角" });
        } else if (meanDiff > 16) {
          setLiveHint({ status: "motion", label: "请拿稳魔方…" });
        } else {
          setLiveHint({ status: "ready", label: "✓ 画面稳定 · 可拍摄" });
        }
      } catch {
        // Ignore in synthetic test environments without pixel readback
      }
    }, 280);
    return () => {
      active = false;
      window.clearInterval(probeTimer);
      cancelFrame();
      listeners.forEach(([name, handler]) =>
        element.removeEventListener(name, handler),
      );
      tracks.forEach((track) => {
        track.removeEventListener("mute", muted);
        track.removeEventListener("unmute", ready);
        track.removeEventListener("ended", ended);
      });
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", visibility);
    };
  }, [camera, cameraSession]);

  async function startCamera() {
    leaveEditor();
    stopCamera();
    setSheet(null);
    changePhase("collect");
    cameraMessage.current = "";
    setError("");
    setNotice("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不能打开实时相机，请使用系统相机或导入照片。");
      return;
    }
    const id = ++cameraRequest.current;
    setCameraOpening(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      if (id !== cameraRequest.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      setCameraSession((old) => old + 1);
      setCamera(true);
    } catch (cause) {
      if (id === cameraRequest.current)
        setError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "相机权限未开启。可在浏览器设置中允许相机，或使用系统相机 / 导入照片。"
            : "实时相机暂不可用，请重试或使用系统相机 / 导入照片。",
        );
    } finally {
      if (id === cameraRequest.current) setCameraOpening(false);
    }
  }
  function record(job: Job, image: PreparedPhoto, analysis: FaceAnalysis) {
    if (records.current[job.face]?.revision !== job.revision) return;
    const next = commitFace(
      current.current,
      job.face,
      analysis,
      image.fingerprint,
    );
    if (!analysis.quad) throw new Error("尚未识别到完整九格。");
    updatePhoto(job, {
      status: "done",
      thumbnail: image.thumbnail,
      quad: analysis.quad,
      message: undefined,
      previous: undefined,
    });
    publish(next);
  }
  async function pump() {
    if (working.current || queuePaused.current || !queue.current.length) return;
    working.current = true;
    setProcessing(true);
    const id = request.current,
      controller = new AbortController();
    abort.current = controller;
    try {
      while (queue.current.length) {
        const job = queue.current.shift()!;
        if (records.current[job.face]?.revision !== job.revision) continue;
        activeJob.current = job;
        updatePhoto(job, { status: "analyzing" });
        setProgress(`正在读取${FACE_NAMES[job.face]}面照片`);
        let image: PreparedPhoto;
        try {
          image = await decodePhoto(job.file, controller.signal);
        } catch (cause) {
          if (id !== request.current) return;
          if (records.current[job.face]?.revision !== job.revision) continue;
          updatePhoto(job, {
            status: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "照片读取失败，请重新选择。",
          });
          setError(
            `${FACE_NAMES[job.face]}面照片无法读取，其他已录入的面已保留。`,
          );
          stopCamera();
          changePhase("review");
          continue;
        }
        if (id !== request.current) return;
        if (!updatePhoto(job, { thumbnail: image.thumbnail })) continue;
        setProgress(`正在识别${FACE_NAMES[job.face]}面的九格`);
        let analysis: FaceAnalysis;
        try {
          analysis = await client.current.analyze(image.pixels);
        } catch (cause) {
          if (id !== request.current) return;
          if (records.current[job.face]?.revision !== job.revision) continue;
          updatePhoto(job, {
            status: "error",
            message:
              cause instanceof Error ? cause.message : "识别暂不可用，请重试。",
          });
          queuePaused.current = true;
          stopCamera();
          changePhase("review");
          setError("识别已暂停，照片和已保存颜色都已保留。请重试处理。");
          break;
        }
        if (id !== request.current) return;
        if (records.current[job.face]?.revision !== job.revision) continue;
        if (!analysis.quad || analysis.cells.length !== 9) {
          updatePhoto(job, {
            status: "adjust",
            quad: analysis.quad ?? defaultQuad(image),
            message:
              analysis.warnings[0] || "没有找到完整九格，请调整照片边界。",
          });
          continue;
        }
        try {
          record(job, image, analysis);
        } catch (cause) {
          updatePhoto(job, {
            status: "adjust",
            quad: analysis.quad,
            message:
              cause instanceof Error
                ? cause.message
                : "这一面未录入，请核对照片。",
          });
        }
      }
    } finally {
      if (id === request.current) {
        activeJob.current = null;
        working.current = false;
        setProcessing(false);
        setProgress("");
      }
    }
  }
  function nextUnphotographed(after: Face) {
    for (let i = 1; i <= 6; i++) {
      const f = CAPTURE_ORDER[(CAPTURE_ORDER.indexOf(after) + i) % 6];
      if (!records.current[f] && !isCompleteFace(current.current.colors, f))
        return f;
    }
    return null;
  }
  function enqueue(input: Job[]) {
    const jobs = input.map((job) => ({ ...job, revision: ++sequence.current }));
    const next = { ...records.current };
    for (const job of jobs)
      next[job.face] = {
        previous:
          records.current[job.face]?.status === "done"
            ? records.current[job.face]
            : records.current[job.face]?.previous,
        file: job.file,
        revision: job.revision!,
        status: "queued",
      };
    updatePhotos(next);
    queuePaused.current = false;
    setVerified(false);
    setError("");
    queue.current = [
      ...queue.current.filter(
        (job) => !jobs.some((next) => next.face === job.face),
      ),
      ...jobs,
    ];
    const nextFace = nextUnphotographed(jobs[jobs.length - 1].face);
    if (replacing.current || !nextFace) {
      replacing.current = false;
      review();
    } else {
      chooseFace(nextFace);
      changePhase("collect");
    }
    setNotice(
      `已拍${jobs.map((job) => FACE_NAMES[job.face] + "面").join("、")}${nextFace ? `，接下来拍${FACE_NAMES[nextFace]}面。` : "，请核对六面。"}`,
    );
    void pump();
  }
  function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    if (snapshotBusy.current || manualBusy.current) {
      setError("正在保存当前照片，请完成后再导入。");
      return;
    }
    const selected = Array.from(files);
    if (selected.length > 6 || (replacing.current && selected.length > 1)) {
      setError(
        replacing.current
          ? "更换当前面时请选择一张照片。"
          : "一颗魔方最多选择六张照片。",
      );
      return;
    }
    leaveEditor();
    setSheet(null);
    const start =
      selected.length === 6 ? 0 : CAPTURE_ORDER.indexOf(target.current);
    enqueue(
      selected.map((file, index) => ({
        file,
        face: CAPTURE_ORDER[(start + index) % 6],
      })),
    );
  }
  async function takePhoto() {
    if (snapshotBusy.current || !video.current || !cameraReady) return;
    const element = video.current,
      media = stream.current;
    if (
      !cameraFrameIsReady(element, media, document.visibilityState !== "hidden")
    ) {
      setCameraReady(false);
      setError("相机当前没有可用画面，请点击“重新打开相机”后再拍摄。");
      return;
    }
    const selectedFace = target.current,
      id = request.current,
      frameVersion = cameraFrameVersion.current,
      photoRevision = records.current[selectedFace]?.revision;
    snapshotBusy.current = true;
    setTaking(true);
    setError("");
    try {
      const file = await photoFromVideo(element, media!);
      if (id !== request.current) return;
      if (records.current[selectedFace]?.revision !== photoRevision) return;
      if (
        frameVersion !== cameraFrameVersion.current ||
        !cameraFrameIsReady(
          element,
          media,
          document.visibilityState !== "hidden",
        )
      )
        throw new Error(
          "拍摄期间相机已暂停或中断，原有记录已保留，请恢复画面后重新拍摄。",
        );
      enqueue([{ face: selectedFace, file }]);
    } catch (cause) {
      if (id === request.current)
        setError(cause instanceof Error ? cause.message : "拍摄失败，请重试。");
    } finally {
      if (id === request.current) {
        snapshotBusy.current = false;
        setTaking(false);
      }
    }
  }
  async function openEditor(selected: Face) {
    const item = records.current[selected];
    if (!item || processing || editorBusy) return;
    stopCamera();
    leaveEditor();
    chooseFace(selected);
    setError("");
    setNotice("");
    changePhase("adjust");
    setEditorBusy(true);
    const id = ++editorRequest.current,
      generation = request.current,
      controller = new AbortController();
    editorAbort.current = controller;
    try {
      const image = await decodePhoto(item.file, controller.signal);
      if (id !== editorRequest.current || generation !== request.current)
        return;
      setPending({
        face: selected,
        file: item.file,
        image,
        quad: item.quad ?? defaultQuad(image),
        message: item.message || "拖动四个角点，对齐这一面的外角。",
      });
    } catch (cause) {
      if (id === editorRequest.current && generation === request.current) {
        setError(
          cause instanceof Error ? cause.message : "照片读取失败，请重新导入。",
        );
        changePhase("review");
      }
    } finally {
      if (id === editorRequest.current && generation === request.current)
        setEditorBusy(false);
    }
  }
  async function collectManual() {
    if (!pending || editorBusy || working.current || manualBusy.current) return;
    const item = pending,
      saved = records.current[item.face];
    if (!saved) return;
    const job = { face: item.face, file: item.file, revision: saved.revision },
      id = editorRequest.current,
      generation = request.current;
    manualBusy.current = true;
    setEditorBusy(true);
    setError("");
    try {
      const analysis = await client.current.analyze(
        item.image.pixels,
        item.quad,
      );
      if (id !== editorRequest.current || generation !== request.current)
        return;
      manualBusy.current = false;
      record(job, item.image, analysis);
      setDetail(item.face);
      review();
      setNotice(`${FACE_NAMES[item.face]}面已更新，其他面已保留。`);
    } catch (cause) {
      if (id === editorRequest.current && generation === request.current)
        setError(
          cause instanceof Error ? cause.message : "取样失败，请调整角点。",
        );
    } finally {
      if (id === editorRequest.current && generation === request.current) {
        manualBusy.current = false;
        setEditorBusy(false);
      }
    }
  }
  function retryProcessing() {
    queuePaused.current = false;
    setError("");
    const failed = CAPTURE_ORDER.filter(
      (f) => records.current[f]?.status === "error",
    ).map((f) => ({
      face: f,
      file: records.current[f]!.file,
      revision: records.current[f]!.revision,
    }));
    for (const job of failed)
      updatePhoto(job, { status: "queued", message: undefined });
    queue.current.push(...failed);
    void pump();
  }
  function continueCapture() {
    replacing.current = false;
    const missing = CAPTURE_ORDER.find(
      (f) => !records.current[f] && !isCompleteFace(current.current.colors, f),
    );
    if (!missing) {
      review();
      return;
    }
    chooseFace(missing);
    changePhase("collect");
  }
  function retake(selected: Face) {
    leaveEditor();
    chooseFace(selected);
    replacing.current = true;
    setDetail(null);
    setError("");
    setNotice(
      `重新拍摄${FACE_NAMES[selected]}面；新照片识别成功前保留旧颜色。`,
    );
    changePhase("collect");
  }
  function close() {
    cancelWork();
    stopCamera();
    onClose();
  }
  function restartCapture() {
    if (
      !window.confirm(
        "清空这次录入并重新拍摄？\n六面颜色、手动修正和本轮照片将被清除，从前面重新开始。已生成的机器人演示会保留。",
      )
    )
      return;
    onRestart();
    cancelWork();
    stopCamera();
    updatePhotos({});
    setPending(null);
    setDetail(null);
    setSheet(null);
    setEditingColors(false);
    setPaint("U");
    setVerified(false);
    setError("");
    replacing.current = false;
    cameraMessage.current = "";
    chooseFace("F");
    changePhase("collect");
    for (const input of [
      photoInput.current,
      nativeCamera.current,
      savedFile.current,
    ])
      if (input) input.value = "";
    publish(emptyCapture());
    setNotice("已清空上次录入，请从前面开始拍摄。");
  }
  const colorCounts = useMemo(
    () =>
      Object.fromEntries(
        FACES.map((f) => [
          f,
          [...capture.colors].filter((c) => c === f).length,
        ]),
      ) as Record<Face, number>,
    [capture.colors],
  );
  function openColorEditor() {
    const deficit = FACES.find((f) => colorCounts[f] < 9);
    if (deficit) setPaint(deficit);
    setEditingColors(true);
  }
  function startManualFill() {
    stopCamera();
    leaveEditor();
    setSheet(null);
    const base = current.current;
    const filledColors = FACES.map((f, fi) => {
      const slice = base.colors.slice(fi * 9, fi * 9 + 9);
      return [...slice].map((c) => (c === "?" ? f : c)).join("");
    }).join("");
    const next: CaptureState = {
      ...base,
      colors: filledColors,
      locked: Array.from({ length: 54 }, (_, i) => i),
      uncertain: [],
      status: "review",
      message: "手动填色模式：先选下方颜色，再点选展开图格子填色。",
    };
    publish(next);
    setEditingColors(true);
    setPaint("U");
    changePhase("review");
    setNotice("已开启手动填色，对照实物点选格子即可修改。");
  }
  const validation = captureValidation(capture.colors, capture);
  const count = CAPTURE_ORDER.filter((f) =>
    isCompleteFace(capture.colors, f),
  ).length;
  const photoCount = CAPTURE_ORDER.filter(
    (f) => photos[f] && (photos[f]!.status !== "error" || photos[f]!.thumbnail),
  ).length;
  const adjustments = CAPTURE_ORDER.filter(
    (f) => photos[f]?.status === "adjust",
  );
  const failures = CAPTURE_ORDER.filter((f) => photos[f]?.status === "error");
  const unfinished = CAPTURE_ORDER.some(
    (f) => photos[f] && photos[f]!.status !== "done",
  );
  const finalNeedsReview = count === 6 && capture.status === "review";
  const canAccept =
    validation.valid &&
    !unfinished &&
    !processing &&
    !editorBusy &&
    !taking &&
    (!finalNeedsReview || verified);
  const orientation = useMemo(
    () =>
      phase === "review" && !unfinished && count === 6 && !validation.valid
        ? proposeCaptureOrientation(capture.colors)
        : null,
    [capture.colors, count, phase, unfinished, validation.valid],
  );
  const directionSummary =
    orientation?.status === "unique"
      ? FACES.flatMap((f) => {
          const turns = orientation.rotations[f];
          return turns
            ? [
                `${FACE_NAMES[f]}面${turns === 3 ? "逆时针 90°" : turns === 2 ? "旋转 180°" : "顺时针 90°"}`,
              ]
            : [];
        }).join("、")
      : "";
  const hasHighlightedCells =
    validation.indices.length > 0 || capture.uncertain.length > 0;
  const checkAction = hasHighlightedCells ? "检查高亮格子" : "检查颜色和面顺序";
  const actionReason = processing
    ? progress || "正在处理照片，请稍候。"
    : adjustments.length
      ? `需要调整 ${adjustments.length} 面，其余照片已保留。`
      : failures.length
        ? "部分照片未处理完成，请重试。已保存的颜色不会清空。"
        : count < 6
          ? `已保存 ${count}/6 面颜色，请继续录入。`
          : unfinished
            ? "照片尚未全部处理，请先完成待调整 / 重试项。"
            : !validation.valid
              ? orientation?.status === "unique"
                ? `可校正记录方向：${directionSummary}。颜色不会改变。`
                : orientation?.status === "ambiguous"
                  ? "存在多种可能的面方向，请对照实物检查高亮格子和六面的顺序。"
                  : `${validation.message}请检查${hasHighlightedCells ? "高亮格子和六面的顺序" : "六面的颜色和顺序"}。`
              : finalNeedsReview && !verified
                ? "请先勾选核对确认，再生成演示。"
                : "六面颜色与方向已通过检查，可以生成演示。";
  const hasDraft = capture.colors !== emptyCapture().colors;
  const currentPhoto = detail ? photos[detail] : undefined;
  const ratio = videoSize.width / videoSize.height;
  const frameWidth = Math.max(
    1,
    Math.min(viewSize.width, viewSize.height * ratio),
  );
  const miniGrid = (f: Face) => (
    <span
      className="capture-mini-grid"
      role="img"
      aria-label={`${FACE_NAMES[f]}面九格颜色`}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const index = FACES.indexOf(f) * 9 + i,
          color = capture.colors[index] as Face;
        return (
          <i
            key={i}
            style={{ background: COLORS[color] || "#39483e" }}
            className={
              capture.uncertain.includes(index) ||
              validation.indices.includes(index)
                ? "cell-error"
                : ""
            }
          />
        );
      })}
    </span>
  );
  const faceStatus = (f: Face) =>
    photos[f]
      ? {
          queued: "等待识别",
          analyzing: "正在识别",
          adjust: "需要调整",
          done: "已识别",
          error: "需要重试",
        }[photos[f]!.status]
      : isCompleteFace(capture.colors, f)
        ? "颜色已保存"
        : "尚未拍摄";
  const feedback = (
    <div className="capture-feedback" aria-live="polite" aria-atomic="true">
      {error ? (
        <p className="capture-error" role="alert">
          {error}
        </p>
      ) : (
        <p className={processing ? "processing-message" : "capture-success"}>
          {processing && <LoaderCircle className="spin" size={15} />}
          {processing
            ? progress
            : notice ||
              (phase === "adjust"
                ? pending?.message
                : "照片仅在此设备处理，拍齐后一起核对。")}
        </p>
      )}
    </div>
  );

  return (
    <dialog
      className="capture-workspace solve-capture"
      data-phase={phase}
      ref={dialog}
      onCancel={(event) => {
        // A native file picker also dispatches a bubbling cancel event.
        // Only a cancellation of this modal itself may close the capture flow.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (sheet) setSheet(null);
        else close();
      }}
      aria-labelledby="capture-title"
    >
      {(busy||externalError)&&<div className="solve-capture-feedback" role={externalError?'alert':'status'}>{busy?<><LoaderCircle className="spin" size={16}/> 正在计算复原动作… <button onClick={onCancelSolve}>取消计算</button></>:externalError}</div>}
      <header className="capture-top" inert={!!sheet}>
        <button
          aria-label={phase === "adjust" ? "返回核对" : "关闭录入"}
          onClick={phase === "adjust" ? review : close}
        >
          {phase === "adjust" ? <ArrowLeft size={22} /> : <X size={22} />}
        </button>
        <h2 id="capture-title">
          {phase === "entry"
            ? "录入你的魔方"
            : phase === "collect"
              ? `拍摄${FACE_NAMES[face]}面`
              : phase === "adjust"
                ? `调整${FACE_NAMES[face]}面`
                : "核对六面"}
        </h2>
        <button aria-label="更多录入操作" onClick={() => setSheet("menu")}>
          <MoreHorizontal size={24} />
        </button>
      </header>
      {phase !== "entry" && (
        <div
          className="capture-meter"
          inert={!!sheet}
          aria-label={`已拍 ${photoCount} 张，颜色已保存 ${count} 面，共六面`}
        >
          <div className="capture-meter-line">
            <strong>
              已拍 {photoCount}/6 · 颜色 {count}/6
            </strong>
            <span>
              {adjustments.length
                ? `${adjustments.length} 面待调整`
                : processing
                  ? "照片处理中"
                  : "前 → 右 → 后 → 左 → 上 → 下"}
            </span>
          </div>
          <div className="capture-steps">
            {CAPTURE_ORDER.map((f) => (
              <button
                key={f}
                aria-current={f === face ? "step" : undefined}
                data-status={
                  photos[f]?.status ??
                  (isCompleteFace(capture.colors, f) ? "done" : "empty")
                }
                aria-label={`${FACE_NAMES[f]}面，${faceStatus(f)}`}
                disabled={taking || editorBusy}
                onClick={() => {
                  review();
                  chooseFace(f);
                  setDetail(f);
                }}
              >
                {FACE_NAMES[f]}
                {photos[f]?.status === "adjust" || photos[f]?.status === "error"
                  ? " · !"
                  : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      {phase === "entry" ? (
        <main inert={!!sheet} className="capture-page capture-entry">
          <ScanLine size={44} className="capture-entry-icon" />
          <div>
            <h3>
              {hasDraft ? "继续上次，还是新录一颗？" : "拍下六面，让魔方登场"}
            </h3>
            <p>
              {hasDraft
                ? `已保存 ${count}/6 面颜色草稿。原照片不会跨刷新保存。`
                : "一手持手机，一手翻魔方。打开一次相机，按顺序拍下完整六面。"}
            </p>
          </div>
          <div className="capture-entry-actions">
            {hasDraft ? (
              <>
                <button className="primary-button" onClick={continueCapture}>
                  继续上次录入 <ArrowRight size={18} />
                </button>
                <button className="secondary-button" onClick={restartCapture}>
                  <Trash2 size={17} />
                  新录一颗 / 清空重录
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                onClick={() => void startCamera()}
              >
                <Camera size={18} />
                打开相机
              </button>
            )}
            <button
              className="secondary-button"
              onClick={() => photoInput.current?.click()}
            >
              <ImagePlus size={18} />
              导入照片
            </button>
          </div>
          {feedback}
          <p>
            相册选六张时，顺序为前、右、后、左、上、下；不确定顺序可逐张导入。
          </p>
          <div className="capture-entry-links">
            {iOSPhotoLibrary && (
              <button
                className="capture-import-help"
                onClick={() => setSheet("import")}
              >
                相册导入慢？查看提速方法 <ArrowRight size={15} />
              </button>
            )}
            <button
              className="capture-import-help"
              onClick={startManualFill}
            >
              不拍照，直接手动填色 <ArrowRight size={15} />
            </button>
          </div>
        </main>
      ) : phase === "collect" ? (
        <main inert={!!sheet} className="capture-page capture-page-focus">
          <div className="capture-direction">
            <p>
              <strong>
                {FACE_NAMES[face]}面朝向镜头
                <span className="capture-turn-badge">
                  {TURN_GUIDE[face].arrow}
                </span>
              </strong>
              <small>
                {TURN_GUIDE[face].hint} · 顶邻
                <i
                  className="capture-neighbor-dot"
                  style={{
                    background:
                      COLORS[
                        capture.colors[FACES.indexOf(TOP[face]) * 9 + 4] as Face
                      ] ?? COLORS[TOP[face]],
                  }}
                />
                {FACE_NAMES[TOP[face]]}面 · 左邻
                <i
                  className="capture-neighbor-dot"
                  style={{
                    background:
                      COLORS[
                        capture.colors[
                          FACES.indexOf(LEFT[face]) * 9 + 4
                        ] as Face
                      ] ?? COLORS[LEFT[face]],
                  }}
                />
                {FACE_NAMES[LEFT[face]]}面
              </small>
            </p>
            <button onClick={() => setSheet("help")}>翻面图示</button>
          </div>
          <div className="capture-view" ref={view}>
            {camera ? (
              <div
                className="live-photo"
                style={{
                  aspectRatio: `${videoSize.width} / ${videoSize.height}`,
                  width: frameWidth,
                  height: frameWidth / ratio,
                }}
              >
                <video ref={video} playsInline muted autoPlay />
                <div
                  className="camera-grid"
                  style={{
                    inset: cameraGuideInsets(videoSize.width, videoSize.height),
                  }}
                  aria-hidden="true"
                />
                {cameraReady && (
                  <span
                    className={`camera-live-pill is-${liveHint.status}`}
                    aria-live="polite"
                  >
                    {liveHint.label}
                  </span>
                )}
              </div>
            ) : (
              <div className="capture-view-empty">
                {cameraOpening ? (
                  <LoaderCircle size={38} className="spin" />
                ) : (
                  <ScanLine size={54} />
                )}
                <strong>
                  {cameraOpening
                    ? "等待相机授权 / 启动"
                    : `准备拍摄${FACE_NAMES[face]}面`}
                </strong>
                <p>
                  {cameraOpening
                    ? "请在浏览器提示中选择是否允许相机"
                    : "让完整一面进入框内，避开手指遮挡"}
                </p>
              </div>
            )}
          </div>
          {feedback}
        </main>
      ) : phase === "adjust" ? (
        <main inert={!!sheet} className="capture-page capture-page-focus">
          <div className="capture-direction">
            <p>
              对齐这一面的四个外角<small>其他面和已保存颜色会保留</small>
            </p>
          </div>
          <div className="capture-view photo-editor" ref={view}>
            {pending ? (
              <CapturePhoto
                image={pending.image.pixels}
                quad={pending.quad}
                disabled={editorBusy}
                onChange={(quad) =>
                  setPending((old) => (old ? { ...old, quad } : old))
                }
              />
            ) : (
              <div className="capture-view-empty">
                <LoaderCircle size={30} className="spin" />
                <p>正在打开照片</p>
              </div>
            )}
          </div>
          {editorBusy ? (
            <div className="capture-feedback" role="status">
              <p>正在{pending ? "识别框选九格" : "读取照片"}…</p>
            </div>
          ) : (
            feedback
          )}
        </main>
      ) : (
        <main inert={!!sheet} className="capture-page capture-review-page">
          <h3>
            {unfinished
              ? "照片已保留，继续完成核对"
              : count === 6
                ? "六面齐全"
                : "继续拍齐六面"}
          </h3>
          {feedback}
          <div className="capture-face-cards">
            {CAPTURE_ORDER.map((f) => (
              <button
                className="capture-face-card"
                key={f}
                aria-label={`查看${FACE_NAMES[f]}面`}
                aria-pressed={detail === f}
                onClick={() => {
                  setDetail(f);
                  chooseFace(f);
                  setError("");
                }}
              >
                {FACE_NAMES[f]}面{miniGrid(f)}
                <small
                  className={
                    photos[f]?.status === "adjust" ||
                    photos[f]?.status === "error"
                      ? "needs-attention"
                      : ""
                  }
                >
                  {faceStatus(f)}
                </small>
              </button>
            ))}
          </div>
          {detail && (
            <section
              ref={detailPanel}
              className="capture-face-detail"
              aria-label={`${FACE_NAMES[detail]}面详情`}
            >
              <h4>
                {FACE_NAMES[detail]}面 · {faceStatus(detail)}
              </h4>
              <p className="capture-face-neighbors">
                方位锚点：上邻{FACE_NAMES[TOP[detail]]}面 · 右邻
                {FACE_NAMES[RIGHT[detail]]}面 · 下邻{FACE_NAMES[BOTTOM[detail]]}
                面 · 左邻{FACE_NAMES[LEFT[detail]]}面
              </p>
              <div className="capture-comparison">
                {currentPhoto?.thumbnail && (
                  <img
                    src={currentPhoto.thumbnail}
                    alt={`${FACE_NAMES[detail]}面原照片`}
                  />
                )}
                {miniGrid(detail)}
              </div>
              {currentPhoto?.message && (
                <p className="capture-warning">{currentPhoto.message}</p>
              )}
              {currentPhoto?.previous && (
                <p>上次成功录入的照片已保留；可撤销这次替换。</p>
              )}
              <div className="capture-detail-actions">
                {currentPhoto?.previous && (
                  <button
                    className="secondary-button"
                    disabled={processing || editorBusy}
                    onClick={() => {
                      const previous = records.current[detail]?.previous;
                      if (!previous) return;
                      queue.current = queue.current.filter(
                        (job) => job.face !== detail,
                      );
                      updatePhotos({ ...records.current, [detail]: previous });
                      setError("");
                      setNotice("已恢复上次成功录入的照片和边界。");
                    }}
                  >
                    撤销本次替换
                  </button>
                )}
                {currentPhoto && (
                  <button
                    className="secondary-button"
                    disabled={processing || editorBusy}
                    onClick={() => void openEditor(detail)}
                  >
                    调整照片边界
                  </button>
                )}
                <button
                  className="secondary-button"
                  disabled={processing || editorBusy}
                  onClick={() => retake(detail)}
                >
                  <Camera size={16} />
                  {isCompleteFace(capture.colors, detail) || currentPhoto
                    ? "重拍这一面"
                    : "拍摄这一面"}
                </button>
                <button
                  className="secondary-button"
                  disabled={
                    processing ||
                    unfinished ||
                    !isCompleteFace(capture.colors, detail)
                  }
                  onClick={() =>
                    publish(rotateCaptureFace(current.current, detail))
                  }
                >
                  <RotateCw size={15} />
                  旋转记录 90°
                </button>
                {currentPhoto && (
                  <SavePhotoLink face={detail} file={currentPhoto.file} />
                )}
              </div>
              {!currentPhoto && (
                <p>这里只保存了颜色草稿，原照片仅在当前录入会话保留。</p>
              )}
            </section>
          )}
          {(failures.length > 0 || queuePaused.current) && (
            <button
              className="secondary-button"
              disabled={processing}
              onClick={retryProcessing}
            >
              重试处理照片
            </button>
          )}
          {count > 0 && (
            <>
              <p className="capture-status-line">
                {unfinished
                  ? "新照片尚未全部录入。以下仍保留此前已保存颜色，完成后才能生成演示。"
                  : capture.message}
              </p>
              <div ref={reviewNet} className="capture-review-net" tabIndex={-1}>
                <CubeNet
                  state={capture.colors}
                  palette={DEFAULT_PALETTE}
                  active={face}
                  errors={
                    validation.indices.length
                      ? validation.indices
                      : capture.uncertain
                  }
                  onSticker={
                    editingColors && !unfinished && !processing
                      ? (index) => {
                          const nextState = paintCaptureCell(
                            current.current,
                            index,
                            paint,
                          );
                          publish(nextState);
                          const nextPaintCount = [...nextState.colors].filter(
                            (c) => c === paint,
                          ).length;
                          if (nextPaintCount >= 9) {
                            const nextDeficit = FACES.find(
                              (f) =>
                                [...nextState.colors].filter((c) => c === f)
                                  .length < 9,
                            );
                            if (nextDeficit) setPaint(nextDeficit);
                          }
                        }
                      : undefined
                  }
                />
              </div>
              <button
                className="subtle-button"
                disabled={processing || unfinished}
                aria-expanded={editingColors}
                onClick={() => {
                  if (editingColors) setEditingColors(false);
                  else openColorEditor();
                }}
              >
                {editingColors ? "收起手动修正" : "需要时手动修正颜色"}
              </button>
              {editingColors && (
                <>
                  <div className="color-palette" aria-label="选择填色">
                    {FACES.map((f) => {
                      const cCount = colorCounts[f];
                      const countState =
                        cCount < 9
                          ? "is-deficit"
                          : cCount > 9
                            ? "is-excess"
                            : "is-exact";
                      return (
                        <button
                          key={f}
                          aria-label={`选择${COLOR_NAMES[f]}色`}
                          aria-pressed={paint === f}
                          style={{ background: COLORS[f] }}
                          onClick={() => setPaint(f)}
                        >
                          {paint === f && <Check size={16} />}
                          <span className={`palette-count ${countState}`}>
                            {cCount}/9
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="capture-hint">
                    已自动选中缺少的颜色（块下显示当前格数/9）；点击高亮格即可修正。
                  </p>
                </>
              )}
              {count === 6 && (
                <div
                  className={`validation ${canAccept ? "valid" : ""}`}
                  role="status"
                >
                  <span className="validation-dot" />
                  <p>
                    {unfinished
                      ? "照片尚未全部处理，请先完成待调整 / 重试项。"
                      : finalNeedsReview && validation.valid
                        ? "请对照实物检查高亮格子。"
                        : validation.message}
                  </p>
                </div>
              )}
            </>
          )}
          <p>颜色草稿自动保存；原照片仅在本次录入保留。</p>
        </main>
      )}
      {savingWarning && (
        <div className="capture-draft-warning" role="alert">
          浏览器暂时无法更新录入记录，关闭或刷新后可能恢复之前的颜色；请保留本次照片。
        </div>
      )}
      <footer className="capture-controls" inert={!!sheet}>
        {phase === "collect" ? (
          <>
            <div className="capture-shutter-row">
              <button
                className="subtle-button"
                disabled={taking}
                onClick={() => photoInput.current?.click()}
              >
                <ImagePlus size={20} />
                导入照片
              </button>
              {camera ? (
                <button
                  className="capture-shutter"
                  aria-label="拍摄并识别"
                  disabled={!cameraReady || taking}
                  onClick={() => void takePhoto()}
                >
                  {taking ? (
                    <LoaderCircle size={22} className="spin" />
                  ) : (
                    <Camera size={23} />
                  )}
                  拍摄
                </button>
              ) : (
                <button
                  className="capture-shutter"
                  aria-label="打开相机"
                  disabled={cameraOpening || taking}
                  onClick={() => void startCamera()}
                >
                  <Camera size={23} />
                  打开
                </button>
              )}
              {camera && !cameraReady ? (
                <button
                  className="subtle-button"
                  disabled={cameraOpening}
                  onClick={() => void startCamera()}
                >
                  重新打开相机
                </button>
              ) : (
                <button className="subtle-button" onClick={review}>
                  <Check size={20} />
                  查看进度
                </button>
              )}
            </div>
            <p>
              {taking
                ? "正在保存照片"
                : camera && !cameraReady
                  ? "等待有效画面后才能拍摄"
                  : `第 ${CAPTURE_ORDER.indexOf(face) + 1} 面 · ${FACE_NAMES[face]}面`}
            </p>
          </>
        ) : phase === "adjust" ? (
          <>
            <div className="capture-actions-pair">
              <button
                className="secondary-button"
                disabled={editorBusy && !!pending}
                onClick={review}
              >
                返回核对
              </button>
              <button
                className="primary-button"
                disabled={!pending || editorBusy || processing}
                onClick={() => void collectManual()}
              >
                识别框选九格 <ArrowRight size={18} />
              </button>
            </div>
            <p>只调整当前照片，不清空其他面</p>
          </>
        ) : phase === "review" ? (
          <>
            <p
              id="capture-action-reason"
              className="capture-action-reason"
              role="status"
            >
              {actionReason}
            </p>
            {!unfinished && finalNeedsReview && validation.valid && (
              <label className="capture-verified">
                <input
                  type="checkbox"
                  checked={verified}
                  disabled={processing || editorBusy || taking}
                  onChange={(event) => setVerified(event.target.checked)}
                />
                我已核对，54 格颜色与实物一致
              </label>
            )}
            <button
              className="primary-button capture-main-action"
              aria-describedby="capture-action-reason"
              disabled={
                busy || processing ||
                editorBusy ||
                taking ||
                (count === 6 &&
                  !adjustments.length &&
                  !failures.length &&
                  (unfinished || (validation.valid && !canAccept)))
              }
              onClick={() => {
                if (adjustments.length) void openEditor(adjustments[0]);
                else if (failures.length) retryProcessing();
                else if (count === 6 && !validation.valid) {
                  if (orientation?.status === "unique") {
                    const next = applyCaptureOrientation(
                      current.current,
                      orientation,
                    );
                    if (next !== current.current) {
                      publish(next);
                      setNotice(
                        "已校正记录的面方向，颜色未改。请对照实物核对。",
                      );
                    }
                  } else {
                    openColorEditor();
                    reviewNet.current?.focus({ preventScroll: true });
                    reviewNet.current?.scrollIntoView?.({
                      block: "start",
                      behavior: "smooth",
                    });
                  }
                } else if (canAccept && validation.normalized) {
                  stopCamera();
                  if(busy)return;
                  onAccept(
                    validation.normalized.facelets,
                    validation.normalized.palette,
                  );
                } else continueCapture();
              }}
            >
              {processing ? (
                <>
                  <LoaderCircle className="spin" size={18} />
                  正在处理照片
                </>
              ) : adjustments.length ? (
                `调整${FACE_NAMES[adjustments[0]]}面照片`
              ) : failures.length ? (
                "重试处理"
              ) : count < 6 ? (
                "继续拍摄"
              ) : !validation.valid ? (
                orientation?.status === "unique" ? (
                  "校正面方向"
                ) : (
                  checkAction
                )
              ) : (
                <>
                  生成机器人演示 <ArrowRight size={18} />
                </>
              )}
            </button>
          </>
        ) : (
          <p>照片只在本机处理 · 颜色草稿自动保存</p>
        )}
      </footer>
      <input
        hidden
        type="file"
        accept="image/*"
        aria-label="选择魔方照片"
        multiple={!replacing.current}
        ref={photoInput}
        onChange={(event) => {
          selectFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="系统相机照片"
        ref={nativeCamera}
        onChange={(event) => {
          selectFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        accept=".json,application/json"
        ref={savedFile}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            const generation = request.current;
            const message = await onImport(file);
            if (message && generation === request.current) setError(message);
          }
        }}
      />
      {sheet && (
        <div
          className="capture-sheet-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSheet(null);
          }}
        >
          <section
            className="capture-sheet"
            ref={sheetPanel}
            role="dialog"
            aria-modal="true"
            aria-label={
              sheet === "help"
                ? "翻面提示"
                : sheet === "import"
                  ? "iPhone 相册导入提速"
                  : "更多录入操作"
            }
          >
            {sheet === "import" ? (
              <>
                <h3>iPhone 相册导入提速</h3>
                <p>
                  按原格式交付照片，减少系统转换图片格式的等待。仍可一次选六张。
                </p>
                <ol>
                  <li>打开照片图库，选好六张照片。</li>
                  <li>
                    点左下角「⋯」→「选项」，将格式选为「当前」，大小保留「全尺寸」。
                  </li>
                  <li>返回后点一次「添加」或「完成」，等待回到网页。</li>
                </ol>
                <p>
                  照片仅在此设备处理。若原图只在 iCloud 中，仍需等待系统下载。
                  选项名称可能随系统版本不同；没有此选项也可正常导入。
                </p>
                <button
                  className="secondary-button"
                  disabled={taking || editorBusy}
                  onClick={() => {
                    setSheet(null);
                    photoInput.current?.click();
                  }}
                >
                  打开照片选择
                </button>
              </>
            ) : sheet === "help" ? (
              <>
                <h3>{FACE_NAMES[face]}面朝向镜头</h3>
                <svg
                  className="capture-orientation"
                  viewBox="0 0 140 120"
                  role="img"
                  aria-label={`当前${FACE_NAMES[face]}面朝前，上侧${FACE_NAMES[TOP[face]]}面，右侧${FACE_NAMES[RIGHT[face]]}面`}
                >
                  <path
                    d="M20 40 70 15 120 40 70 65Z"
                    fill="#566346"
                    stroke="#b1bd94"
                  />
                  <path
                    d="M20 40 70 65 70 115 20 90Z"
                    fill="#344d35"
                    stroke="#b1bd94"
                  />
                  <path
                    d="M70 65 120 40 120 90 70 115Z"
                    fill="#253f2c"
                    stroke="#b1bd94"
                  />
                  <text x="70" y="43" textAnchor="middle">
                    {FACE_NAMES[TOP[face]]} {TOP[face]}
                  </text>
                  <text x="45" y="82" textAnchor="middle">
                    {FACE_NAMES[face]} {face}
                  </text>
                  <text x="96" y="82" textAnchor="middle">
                    {FACE_NAMES[RIGHT[face]]} {RIGHT[face]}
                  </text>
                </svg>
                <ol>
                  {face === "U" ? (
                    <>
                      <li>先回到前面朝镜头、上面朝上。</li>
                      <li>把上面朝镜头翻出，右面仍在右侧。</li>
                      <li>此时屏幕顶边邻接后面。</li>
                    </>
                  ) : face === "D" ? (
                    <>
                      <li>保持原右面在屏幕右侧。</li>
                      <li>从上面的姿态把整颗魔方上下翻转半圈。</li>
                      <li>下面朝镜头，屏幕顶边邻接前面。</li>
                    </>
                  ) : (
                    <>
                      <li>
                        {face === "F"
                          ? "选定最初的前面和上面，记住这两个方向。"
                          : "保持最初的上面朝上，把上一面的右侧转向镜头。"}
                      </li>
                      <li>只转整颗魔方，不拧动任何一层。</li>
                    </>
                  )}
                </ol>
                <p>方向按最初的面命名，不要求白色朝上。</p>
              </>
            ) : (
              <>
                <h3>本轮录入</h3>
                <button
                  className="secondary-button"
                  disabled={taking || editorBusy}
                  onClick={() => {
                    setSheet(null);
                    nativeCamera.current?.click();
                  }}
                >
                  使用系统相机
                </button>
                <button
                  className="secondary-button"
                  disabled={taking || editorBusy}
                  onClick={() => {
                    setSheet(null);
                    photoInput.current?.click();
                  }}
                >
                  导入照片
                </button>
                {iOSPhotoLibrary && (
                  <button
                    className="secondary-button"
                    onClick={() => setSheet("import")}
                  >
                    相册导入提速
                  </button>
                )}
                {camera && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      stopCamera();
                      setSheet(null);
                    }}
                  >
                    关闭相机
                  </button>
                )}
                <button className="secondary-button" onClick={review}>
                  查看六面进度
                </button>
                <button
                  className="secondary-button"
                  disabled={processing || editorBusy}
                  onClick={startManualFill}
                >
                  直接手动填色
                </button>
                {pending && (
                  <SavePhotoLink file={pending.file} face={pending.face} />
                )}
                <button className="secondary-button" onClick={restartCapture}>
                  <Trash2 size={16} />
                  清空重录
                </button>
                <button
                  className="subtle-button"
                  disabled={processing || editorBusy}
                  onClick={() => {
                    setSheet(null);
                    savedFile.current?.click();
                  }}
                >
                  <FolderOpen size={15} />
                  导入已保存的局面
                </button>
                <p>
                  离开本次录入后只保留颜色草稿，原照片不会保存。已生成的演示不受清空影响。
                </p>
              </>
            )}
            <button className="primary-button" onClick={() => setSheet(null)}>
              知道了 / 返回
            </button>
          </section>
        </div>
      )}
    </dialog>
  );
}
