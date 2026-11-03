import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { homography, type Quad } from "../core/vision";
import "./CapturePhoto.css";

const CORNERS = ["左上", "右上", "右下", "左下"];
const HANDLE_RADIUS = 24;
const LOUPE_ZOOM = 2.5;
type Drag = {
  index: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  corner: Quad[number];
  handle: HTMLButtonElement;
};

export function CapturePhoto({
  image,
  quad,
  onChange,
  disabled,
}: {
  /** Pixels already normalized by decodePhoto; coordinates use this orientation. */
  image: ImageData;
  quad: Quad;
  onChange: (quad: Quad) => void;
  disabled: boolean;
}) {
  const instructions = useId();
  const workspace = useRef<HTMLDivElement>(null);
  const imageLayer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const magnifier = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const currentQuad = useRef(quad);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  currentQuad.current = quad;

  function finishDrag() {
    const active = drag.current;
    drag.current = null;
    if (active?.handle.hasPointerCapture?.(active.pointerId))
      active.handle.releasePointerCapture(active.pointerId);
    setActiveCorner(null);
  }

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    let lastWidth = -1;
    let lastHeight = -1;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      // Rotation / toolbar changes must not turn a held finger into a new point.
      finishDrag();
      setSize({ width, height });
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    canvas.current?.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);

  useEffect(() => {
    finishDrag();
  }, [disabled, image]);

  const scale = Math.max(
    0,
    Math.min(
      (size.width - HANDLE_RADIUS * 2) / image.width,
      (size.height - HANDLE_RADIUS * 2) / image.height,
    ),
  );
  const photoWidth = image.width * scale;
  const photoHeight = image.height * scale;
  const photoLeft = (size.width - photoWidth) / 2;
  const photoTop = (size.height - photoHeight) / 2;
  const loupeSize = Math.max(
    0,
    Math.min(112, size.width - 16, size.height - 16),
  );
  const selected = activeCorner === null ? null : quad[activeCorner];
  const loupeLeft =
    selected && photoLeft + selected[0] * scale < size.width / 2
      ? size.width - loupeSize - 8
      : 8;
  const loupeTop =
    selected && photoTop + selected[1] * scale < size.height / 2
      ? size.height - loupeSize - 8
      : 8;

  useLayoutEffect(() => {
    const target = magnifier.current;
    const source = canvas.current;
    const ctx = target?.getContext("2d");
    if (!selected || !target || !source || !ctx || scale <= 0) return;
    const sourceSize = loupeSize / (scale * LOUPE_ZOOM);
    ctx.fillStyle = "#101810";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(
      source,
      selected[0] - sourceSize / 2,
      selected[1] - sourceSize / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      target.width,
      target.height,
    );
  }, [image, selected, scale, loupeSize]);

  function moveCorner(index: number, x: number, y: number) {
    const next = currentQuad.current.map((point, i) =>
      i === index
        ? [
            Math.max(0, Math.min(image.width - 1, x)),
            Math.max(0, Math.min(image.height - 1, y)),
          ]
        : point,
    ) as Quad;
    currentQuad.current = next;
    onChange(next);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (
      disabled ||
      drag.current ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    drag.current = {
      index,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      corner: [...currentQuad.current[index]],
      handle: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveCorner(index);
  }

  function dragCorner(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    const rect = imageLayer.current?.getBoundingClientRect();
    if (
      disabled ||
      !active ||
      active.pointerId !== event.pointerId ||
      !rect?.width ||
      !rect.height
    )
      return;
    // Keep the grab offset inside the 48px target; touching its edge must not
    // make the corner jump under the finger before the first deliberate move.
    moveCorner(
      active.index,
      active.corner[0] +
        ((event.clientX - active.clientX) * image.width) / rect.width,
      active.corner[1] +
        ((event.clientY - active.clientY) * image.height) / rect.height,
    );
  }

  function nudgeCorner(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const point = currentQuad.current[index];
    moveCorner(
      index,
      point[0] + direction[0] * step,
      point[1] + direction[1] * step,
    );
    setActiveCorner(index);
  }

  let grid: [number, number, number, number][] = [];
  try {
    const map = homography(quad);
    grid = Array.from({ length: 4 }, (_, i) => i / 3).flatMap((part) => [
      [...map(part, 0), ...map(part, 1)] as [number, number, number, number],
      [...map(0, part), ...map(1, part)] as [number, number, number, number],
    ]);
    if (
      grid.some((line) =>
        line.some((coordinate) => !Number.isFinite(coordinate)),
      )
    )
      grid = [];
  } catch {
    // Invalid corners remain visible and movable; recognition reports validity.
  }
  const outline = quad.map(([x, y]) => `${x},${y}`).join(" ");
  const shade = `M0,0 H${image.width} V${image.height} H0 Z M${quad
    .map(([x, y]) => `${x},${y}`)
    .join(" L")} Z`;

  return (
    <div className="capture-photo-editor" aria-label="照片四角调整">
      <div className="capture-photo-workspace" ref={workspace}>
        <div
          className="capture-photo-image-layer"
          ref={imageLayer}
          style={{
            width: photoWidth,
            height: photoHeight,
            left: photoLeft,
            top: photoTop,
            visibility: scale > 0 ? "visible" : "hidden",
          }}
        >
          <canvas
            className="capture-photo-image"
            ref={canvas}
            width={image.width}
            height={image.height}
            role="img"
            aria-label="当前照片，完整显示。拖动四个编号角点调整魔方面边界。"
          />
          <svg
            className="capture-photo-grid"
            viewBox={`0 0 ${image.width} ${image.height}`}
            aria-hidden="true"
          >
            <path d={shade} fill="rgba(5,13,10,.48)" fillRule="evenodd" />
            {grid.map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
            <polygon points={outline} fill="none" />
          </svg>
          {quad.map(([x, y], index) => (
            <button
              key={index}
              type="button"
              className="capture-photo-corner"
              style={{
                left: `${(x / image.width) * 100}%`,
                top: `${(y / image.height) * 100}%`,
              }}
              aria-label={`角点 ${index + 1}，${CORNERS[index]}`}
              aria-describedby={instructions}
              disabled={disabled}
              onPointerDown={(event) => startDrag(event, index)}
              onPointerMove={dragCorner}
              onPointerUp={(event) => {
                if (drag.current?.pointerId === event.pointerId) finishDrag();
              }}
              onPointerCancel={(event) => {
                if (drag.current?.pointerId === event.pointerId) finishDrag();
              }}
              onLostPointerCapture={(event) => {
                if (drag.current?.pointerId === event.pointerId) finishDrag();
              }}
              onKeyDown={(event) => nudgeCorner(event, index)}
              onBlur={() => {
                if (!drag.current) setActiveCorner(null);
              }}
            >
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
        {selected && loupeSize > 0 && (
          <div
            className="capture-photo-loupe"
            style={{
              width: loupeSize,
              height: loupeSize,
              left: loupeLeft,
              top: loupeTop,
            }}
            aria-hidden="true"
          >
            <canvas ref={magnifier} width={224} height={224} />
            <i className="capture-photo-crosshair" />
            <span>角点 {activeCorner! + 1} · 2.5×</span>
          </div>
        )}
      </div>
      <p className="capture-photo-instructions" id={instructions}>
        拖动 1–4 对准四角；方向键微调，Shift 加快。
      </p>
    </div>
  );
}
