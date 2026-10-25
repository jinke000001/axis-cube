import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FolderOpen,
  ImagePlus,
  RotateCw,
  Upload,
  X,
} from "lucide-react";
import {
  COLOR_NAMES,
  COLORS,
  DEFAULT_PALETTE,
  FACES,
  FACE_NAMES,
  normalizeColors,
  rotateFace,
  validateFacelets,
  type Face,
  type Palette,
} from "../core/cube";
import {
  classifyCapture,
  homography,
  sampleFace,
  type Quad,
  type RGB,
} from "../core/vision";
import { CubeNet } from "./CubeNet";
import { CubePreview } from "./CubePreview";
const ORDER: Face[] = ["F", "R", "B", "L", "U", "D"];
const TOP: Record<Face, Face> = {
  F: "U",
  R: "U",
  B: "U",
  L: "U",
  U: "B",
  D: "F",
};
const blank = FACES.map((f) => "????" + f + "????").join("");
function draft() {
  try {
    const value = localStorage.getItem("axis.capture.draft");
    return value && /^[URFDLB?]{54}$/.test(value) ? value : blank;
  } catch {
    return blank;
  }
}
export function Capture({
  onClose,
  onAccept,
  onImport,
}: {
  onClose: () => void;
  onAccept: (state: string, palette: Palette) => void;
  onImport: (file: File) => Promise<string | void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    video = useRef<HTMLVideoElement>(null),
    file = useRef<HTMLInputElement>(null),
    nativeCamera = useRef<HTMLInputElement>(null),
    source = useRef<ImageData | null>(null),
    stream = useRef<MediaStream | null>(null),
    drag = useRef(-1),
    savedFile = useRef<HTMLInputElement>(null);
  const [face, setFace] = useState<Face>("F"),
    [colors, setColors] = useState(draft),
    [paint, setPaint] = useState<Face>("U"),
    [quad, setQuad] = useState<Quad>([
      [100, 100],
      [500, 100],
      [500, 500],
      [100, 500],
    ]),
    [hasImage, setHasImage] = useState(false),
    [camera, setCamera] = useState(false),
    [error, setError] = useState(""),
    [samples, setSamples] = useState<Partial<Record<Face, RGB[]>>>({}),
    [locked, setLocked] = useState(new Set<number>()),
    [uncertain, setUncertain] = useState<number[]>([]),
    [queue, setQueue] = useState<File[]>([]);
  const [savingWarning, setSavingWarning] = useState(false);
  const [processing, setProcessing] = useState(false),
    [filename, setFilename] = useState("");
  const cameraRequest = useRef(0),
    photoRequest = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      cameraRequest.current++;
      photoRequest.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current
        .play()
        .catch(() => setError("相机画面无法播放，请重新打开相机或导入照片。"));
    }
  }, [camera]);
  useEffect(() => {
    try {
      localStorage.setItem("axis.capture.draft", colors);
      setSavingWarning(false);
    } catch {
      setSavingWarning(true);
    }
  }, [colors]);
  useEffect(() => {
    if (!hasImage || !canvas.current || !source.current) return;
    const c = canvas.current.getContext("2d")!;
    c.putImageData(source.current, 0, 0);
    c.fillStyle = "rgba(7,13,15,.48)";
    c.beginPath();
    c.rect(0, 0, 600, 600);
    c.moveTo(...quad[0]);
    [quad[3], quad[2], quad[1]].forEach((p) => c.lineTo(...p));
    c.closePath();
    c.fill("evenodd");
    c.strokeStyle = "#e0c79b";
    c.lineWidth = 2;
    try {
      const map = homography(quad);
      for (let i = 0; i <= 3; i++) {
        c.beginPath();
        c.moveTo(...map(i / 3, 0));
        c.lineTo(...map(i / 3, 1));
        c.stroke();
        c.beginPath();
        c.moveTo(...map(0, i / 3));
        c.lineTo(...map(1, i / 3));
        c.stroke();
      }
    } catch {}
    quad.forEach(([x, y], i) => {
      c.beginPath();
      c.arc(x, y, 9, 0, Math.PI * 2);
      c.fillStyle = "#ede5d3";
      c.fill();
      c.fillStyle = "#25302d";
      c.font = "12px sans-serif";
      c.textAlign = "center";
      c.fillText(String(i + 1), x, y + 4);
    });
  }, [quad, hasImage]);
  function stopCamera() {
    cameraRequest.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  async function startCamera() {
    stopCamera();
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      nativeCamera.current?.click();
      return;
    }
    const id = ++cameraRequest.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (id !== cameraRequest.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setCamera(true);
    } catch (e) {
      if (id === cameraRequest.current)
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "相机权限未开启。可以在浏览器设置中允许，或直接导入照片。"
            : "无法启动相机，请使用照片导入。",
        );
    }
  }
  function setSource(image: CanvasImageSource, width: number, height: number) {
    const scratch = document.createElement("canvas");
    scratch.width = scratch.height = 600;
    const c = scratch.getContext("2d", { willReadFrequently: true })!;
    c.fillStyle = "#171e20";
    c.fillRect(0, 0, 600, 600);
    const scale = Math.min(600 / width, 600 / height),
      w = width * scale,
      h = height * scale;
    c.drawImage(image, (600 - w) / 2, (600 - h) / 2, w, h);
    source.current = c.getImageData(0, 0, 600, 600);
    const size = Math.min(w, h) * 0.75;
    setQuad([
      [300 - size / 2, 300 - size / 2],
      [300 + size / 2, 300 - size / 2],
      [300 + size / 2, 300 + size / 2],
      [300 - size / 2, 300 + size / 2],
    ]);
    setHasImage(true);
  }
  async function loadPhoto(photo: File) {
    const id = ++photoRequest.current;
    setProcessing(true);
    setHasImage(false);
    setError("");
    try {
      if (photo.size > 24 * 1024 * 1024)
        throw new Error("照片超过 24 MB，请使用压缩后的照片。");
      if (!photo.type.startsWith("image/")) throw new Error("请选择图片文件。");
      const image = await createImageBitmap(photo, {
        imageOrientation: "from-image",
      });
      if (id !== photoRequest.current) {
        image.close();
        return;
      }
      if (image.width < 90 || image.height < 90) {
        image.close();
        throw new Error("照片太小，无法可靠采色。");
      }
      setSource(image, image.width, image.height);
      setFilename(photo.name);
      image.close();
      stopCamera();
    } catch (e) {
      if (id === photoRequest.current)
        setError(
          e instanceof Error && !(e instanceof DOMException)
            ? e.message
            : "无法读取照片，请尝试 JPEG、PNG 或 WebP 格式。",
        );
    } finally {
      if (id === photoRequest.current) setProcessing(false);
    }
  }
  function filesSelected(list: FileList | null) {
    if (!list?.length) return;
    const selected = Array.from(list).slice(0, 6);
    if (selected.length > 1) setFace("F");
    setQueue(selected.slice(1));
    void loadPhoto(selected[0]);
  }
  function takePhoto() {
    if (!video.current?.videoWidth) {
      setError("相机尚未就绪，请稍后重试。");
      return;
    }
    setSource(
      video.current,
      video.current.videoWidth,
      video.current.videoHeight,
    );
    setFilename("相机拍摄");
    stopCamera();
  }
  function collect() {
    if (!source.current || processing) return;
    try {
      const captured = sampleFace(source.current, quad),
        nextSamples = { ...samples, [face]: captured };
      setSamples(nextSamples);
      const newLocked = new Set(locked);
      for (let i = 0; i < 9; i++) newLocked.delete(FACES.indexOf(face) * 9 + i);
      setLocked(newLocked);
      const recognized = classifyCapture(nextSamples, colors, newLocked);
      setUncertain(recognized.uncertain);
      setColors(recognized.colors);
      setError("");
      if (queue.length) {
        const nextFace = ORDER[Math.min(ORDER.indexOf(face) + 1, 5)];
        setFace(nextFace);
        const [photo, ...rest] = queue;
        setQueue(rest);
        void loadPhoto(photo);
      } else {
        setHasImage(false);
        setFilename("");
        setFace(ORDER[Math.min(ORDER.indexOf(face) + 1, 5)]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "采色失败，请调整四个角点。");
    }
  }
  function paintCell(index: number) {
    const chars = colors.split("");
    chars[index] = paint;
    const nextLocked = new Set([...locked, index]);
    const recognized = classifyCapture(samples, chars.join(""), nextLocked);
    setColors(recognized.colors);
    setLocked(nextLocked);
    setUncertain(recognized.uncertain);
  }
  function turnFace() {
    setColors((old) => rotateFace(old, face));
    setSamples((old) => {
      const v = old[face];
      return v
        ? { ...old, [face]: [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => v[i]) }
        : old;
    });
    const start = FACES.indexOf(face) * 9;
    setLocked(
      (old) =>
        new Set([...old, ...Array.from({ length: 9 }, (_, i) => start + i)]),
    );
    setUncertain((old) =>
      old.map((i) =>
        i >= start && i < start + 9
          ? start + [2, 5, 8, 1, 4, 7, 0, 3, 6][i - start]
          : i,
      ),
    );
  }
  let validation = {
      valid: false,
      message: "拍摄六个面，或使用下方色板手动填色。",
      indices: [] as number[],
    },
    normalized: { facelets: string; palette: Palette } | null = null;
  try {
    normalized = normalizeColors(colors);
    validation = validateFacelets(normalized.facelets, normalized.palette);
  } catch (e) {
    if (!colors.includes("?"))
      validation.message = e instanceof Error ? e.message : "请检查中心颜色。";
  }
  const count = ORDER.filter(
    (f) =>
      !colors
        .slice(FACES.indexOf(f) * 9, FACES.indexOf(f) * 9 + 9)
        .includes("?"),
  ).length;
  return (
    <dialog
      className="capture-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="capture-title"
    >
      <header className="dialog-header">
        <div>
          <div className="eyebrow">YOUR CUBE / CAPTURE</div>
          <h2 id="capture-title">让你的魔方登场</h2>
        </div>
        <button className="icon-button" aria-label="关闭录入" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      <div className="capture-layout">
        <section className="capture-main">
          <div className="face-tabs">
            {ORDER.map((f) => (
              <button
                key={f}
                className={f === face ? "active" : ""}
                onClick={() => {
                  setFace(f);
                  setHasImage(false);
                  setQueue([]);
                  setFilename("");
                  photoRequest.current++;
                  setProcessing(false);
                  stopCamera();
                }}
              >
                <i style={{ background: COLORS[f] }} />
                <span>
                  {FACE_NAMES[f]}面 {f}
                </span>
                {!colors
                  .slice(FACES.indexOf(f) * 9, FACES.indexOf(f) * 9 + 9)
                  .includes("?") ? (
                  <Check size={13} />
                ) : null}
              </button>
            ))}
          </div>
          <div className="capture-guidance">
            <strong>{FACE_NAMES[face]}面朝向镜头</strong>
            <span>
              默认中心为{COLOR_NAMES[face]}色 · 顶边邻接{FACE_NAMES[TOP[face]]}
              面 {TOP[face]}
            </span>
            <p>
              只翻转整颗魔方，保持各层不动。拍摄后拖动四个角点，框住当前面的九宫格。
            </p>
          </div>
          <div className="photo-stage">
            {camera ? (
              <video ref={video} playsInline muted autoPlay />
            ) : hasImage ? (
              <canvas
                ref={canvas}
                width="600"
                height="600"
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect(),
                    p = [
                      ((e.clientX - rect.left) / rect.width) * 600,
                      ((e.clientY - rect.top) / rect.height) * 600,
                    ];
                  let closest = -1,
                    distance = 45;
                  quad.forEach((q, i) => {
                    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
                    if (d < distance) {
                      closest = i;
                      distance = d;
                    }
                  });
                  drag.current = closest;
                  if (closest >= 0)
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (drag.current < 0) return;
                  const corner = drag.current;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(
                      0,
                      Math.min(
                        599,
                        ((e.clientX - rect.left) / rect.width) * 600,
                      ),
                    ),
                    y = Math.max(
                      0,
                      Math.min(
                        599,
                        ((e.clientY - rect.top) / rect.height) * 600,
                      ),
                    );
                  setQuad(
                    (old) =>
                      old.map((p, i) => (i === corner ? [x, y] : p)) as Quad,
                  );
                }}
                onPointerUp={() => (drag.current = -1)}
                onPointerCancel={() => (drag.current = -1)}
              />
            ) : (
              <div className="photo-empty">
                <div className="scan-frame">
                  <ScanGrid />
                </div>
                <strong>
                  {processing
                    ? "正在读取照片"
                    : "拍摄或导入" + FACE_NAMES[face] + "面"}
                </strong>
                <p>自然均匀光线 · 避开反光和手指遮挡</p>
              </div>
            )}
            {camera && <div className="camera-grid" aria-hidden="true" />}
          </div>
          <div className="photo-actions">
            <button className="secondary-button" onClick={startCamera}>
              <Camera size={16} />
              打开相机
            </button>
            <button
              className="secondary-button"
              onClick={() => file.current?.click()}
              disabled={processing}
            >
              <ImagePlus size={16} />
              导入照片
            </button>
            {camera ? (
              <button className="primary-button" onClick={takePhoto}>
                拍摄此面
              </button>
            ) : hasImage ? (
              <button
                className="primary-button"
                onClick={collect}
                disabled={processing}
              >
                采集九格
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                className="subtle-button"
                onClick={() => setFace(ORDER[(ORDER.indexOf(face) + 1) % 6])}
              >
                下一面
                <ArrowRight size={15} />
              </button>
            )}
          </div>
          {queue.length > 0 && (
            <p className="queue-note">
              还有 {queue.length} 张照片待处理；当前面采集后继续。
            </p>
          )}
          {hasImage && (
            <p className="photo-filename">
              {filename} → {FACE_NAMES[face]}面 {face}
            </p>
          )}
          <p className="photo-batch-hint">
            一次导入多张时，按前 F → 右 R → 后 B → 左 L → 上 U → 下 D 排列。
          </p>
          <input
            hidden
            type="file"
            accept="image/*"
            multiple
            ref={file}
            onChange={(e) => {
              filesSelected(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            ref={nativeCamera}
            onChange={(e) => {
              filesSelected(e.target.files);
              e.target.value = "";
            }}
          />
        </section>
        <section className="capture-review">
          <div className="section-title">
            <span>检查与修正</span>
            <small>{count} / 6 面</small>
          </div>
          <CubePreview state={colors} />
          <CubeNet
            state={colors}
            palette={DEFAULT_PALETTE}
            active={face}
            errors={validation.indices.length ? validation.indices : uncertain}
            onSticker={paintCell}
          />
          <div className="color-palette" aria-label="选择填色">
            {FACES.map((f) => (
              <button
                key={f}
                aria-label={"选择" + COLOR_NAMES[f] + "色"}
                aria-pressed={paint === f}
                style={{ background: COLORS[f] }}
                className={paint === f ? "selected" : ""}
                onClick={() => setPaint(f)}
              >
                {paint === f ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
          <p className="capture-hint">
            先选颜色，再点击色块。低置信度的识别会标出边框；中心也可以修改。
          </p>
          <button className="secondary-button rotate-face" onClick={turnFace}>
            <RotateCw size={15} />将{FACE_NAMES[face]}面记录旋转 90°
          </button>
          <div
            className={"validation " + (validation.valid ? "valid" : "")}
            role="status"
          >
            {validation.valid ? (
              <Check size={16} />
            ) : (
              <span className="validation-dot" />
            )}
            <p>{validation.message}</p>
          </div>
          <button
            className="subtle-button import-state"
            onClick={() => savedFile.current?.click()}
          >
            <FolderOpen size={15} />
            导入已保存的局面
          </button>
          <input
            hidden
            ref={savedFile}
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) {
                const message = await onImport(file);
                if (message) setError(message);
              }
            }}
          />
        </section>
      </div>
      {(error || savingWarning) && (
        <div className="notice error" role="alert">
          {error || "草稿无法保存到浏览器，关闭前请完成录入或保留照片。"}
        </div>
      )}
      <footer className="dialog-footer">
        <span>
          <Upload size={14} />
          照片留在此设备，草稿自动保存
        </span>
        <div>
          <button className="subtle-button" onClick={onClose}>
            <ArrowLeft size={14} />
            返回工作台
          </button>
          <button
            className="primary-button"
            disabled={
              !validation.valid || processing || hasImage || queue.length > 0
            }
            onClick={() =>
              normalized && onAccept(normalized.facelets, normalized.palette)
            }
          >
            生成机器人演示
            <ArrowUp />
          </button>
        </div>
      </footer>
    </dialog>
  );
}
function ScanGrid() {
  return (
    <div className="scan-grid">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
function ArrowUp() {
  return <ArrowRight size={16} />;
}
