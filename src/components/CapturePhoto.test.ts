import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { Quad } from "../core/vision";

let CapturePhoto: typeof import("./CapturePhoto").CapturePhoto;
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root;
let bounds = { left: 50, top: 30, width: 360, height: 400 };
const observers = new Set<() => void>();
const captures = new WeakMap<HTMLElement, number>();
const changed = vi.fn();
const putImageData = vi.fn();
const drawImage = vi.fn();
const pixels = {
  width: 1200,
  height: 1600,
  data: new Uint8ClampedArray(1200 * 1600 * 4),
} as ImageData;
const initial: Quad = [
  [120, 160],
  [1080, 160],
  [1080, 1440],
  [120, 1440],
];

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

beforeAll(async () => {
  const { window, document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(readonly callback: () => void) {}
      observe() {
        observers.add(this.callback);
      }
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
  Object.defineProperties(window.HTMLElement.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains("capture-photo-workspace"))
          return rect(bounds.left, bounds.top, bounds.width, bounds.height);
        if (this.classList.contains("capture-photo-image-layer"))
          return rect(
            bounds.left + Number.parseFloat(this.style.left),
            bounds.top + Number.parseFloat(this.style.top),
            Number.parseFloat(this.style.width),
            Number.parseFloat(this.style.height),
          );
        return rect(0, 0, 0, 0);
      },
    },
    setPointerCapture: {
      configurable: true,
      value: function (this: HTMLElement, pointerId: number) {
        captures.set(this, pointerId);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value: function (this: HTMLElement, pointerId: number) {
        return captures.get(this) === pointerId;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value: function (this: HTMLElement) {
        captures.delete(this);
      },
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ putImageData, drawImage, fillRect: vi.fn() }),
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ CapturePhoto } = await import("./CapturePhoto"));
});

function Harness({
  disabled = false,
  image = pixels,
  corners = initial,
}: {
  disabled?: boolean;
  image?: ImageData;
  corners?: Quad;
}) {
  const [quad, setQuad] = useState(corners);
  return createElement(CapturePhoto, {
    image,
    quad,
    disabled,
    onChange: (next) => {
      changed(next);
      setQuad(next);
    },
  });
}

beforeEach(() => {
  bounds = { left: 50, top: 30, width: 360, height: 400 };
  changed.mockClear();
  putImageData.mockClear();
  drawImage.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(createElement(Harness, props)));
}
function corner(index = 0) {
  return document.querySelectorAll<HTMLButtonElement>(".capture-photo-corner")[
    index
  ];
}
async function send(
  target: Element,
  type: string,
  props: Record<string, unknown> = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    ...props,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}
function lastQuad(): Quad {
  return changed.mock.lastCall![0];
}

describe("CapturePhoto coordinate and gesture contract", () => {
  it("contains a portrait image inside the available height with room for all four handles", async () => {
    await render();
    const layer = document.querySelector<HTMLElement>(
      ".capture-photo-image-layer",
    )!;
    expect(layer.style.width).toBe("264px");
    expect(layer.style.height).toBe("352px");
    expect(layer.style.left).toBe("48px");
    expect(layer.style.top).toBe("24px");
    expect(
      Array.from(document.querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["角点 1，左上", "角点 2，右上", "角点 3，右下", "角点 4，左下"]);
    expect(document.querySelector("canvas")!.getAttribute("width")).toBe(
      "1200",
    );
    expect(putImageData).toHaveBeenCalledWith(pixels, 0, 0);
  });

  it("maps a drag through letterboxing without jumping to the edge of the touch target", async () => {
    await render();
    const handle = corner();
    // Grab 15 CSS pixels away from the corner, then move 22 by 44 CSS pixels.
    await send(handle, "pointerdown", { clientX: 139.4, clientY: 104.2 });
    expect(changed).not.toHaveBeenCalled();
    await send(handle, "pointermove", { clientX: 161.4, clientY: 148.2 });
    expect(lastQuad()[0][0]).toBeCloseTo(220);
    expect(lastQuad()[0][1]).toBeCloseTo(360);
    expect(lastQuad().slice(1)).toEqual(initial.slice(1));
    expect(document.querySelector(".capture-photo-loupe")).not.toBeNull();
    expect(drawImage).toHaveBeenCalled();
    // The full-resolution photo is not repainted on every move.
    expect(putImageData).toHaveBeenCalledTimes(1);
    await send(handle, "pointerup");
    expect(document.querySelector(".capture-photo-loupe")).toBeNull();
    expect(captures.has(handle)).toBe(false);
  });

  it("bounds coordinates to decoded pixels and stops after a cancelled pointer", async () => {
    await render();
    const handle = corner(3);
    await send(handle, "pointerdown", { clientX: 100, clientY: 300 });
    await send(handle, "pointermove", { clientX: -900, clientY: 1300 });
    expect(lastQuad()[3]).toEqual([0, 1599]);
    await send(handle, "pointercancel");
    await send(handle, "pointermove", { clientX: 200, clientY: 200 });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("does not consume gestures on the photo and ignores another finger during a drag", async () => {
    await render();
    const canvas = document.querySelector("canvas")!;
    const down = await send(canvas, "pointerdown", {
      clientX: 180,
      clientY: 200,
    });
    await send(canvas, "pointermove", { clientX: 180, clientY: 100 });
    expect(down.defaultPrevented).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    await send(corner(), "pointerdown", { clientX: 120, clientY: 160 });
    await send(corner(), "pointermove", {
      pointerId: 2,
      clientX: 200,
      clientY: 240,
    });
    expect(changed).not.toHaveBeenCalled();
    await send(corner(), "pointerup", { pointerId: 2 });
    expect(document.querySelector(".capture-photo-loupe")).not.toBeNull();
  });

  it("supports exact pixel keyboard corrections, accelerated steps and disabled state", async () => {
    await render();
    const up = await send(corner(), "keydown", { key: "ArrowUp" });
    expect(up.defaultPrevented).toBe(true);
    expect(lastQuad()[0]).toEqual([120, 159]);
    await send(corner(), "keydown", { key: "ArrowRight", shiftKey: true });
    expect(lastQuad()[0]).toEqual([130, 159]);
    await render({ disabled: true });
    expect(corner().disabled).toBe(true);
    expect(document.querySelector(".capture-photo-loupe")).toBeNull();
    await send(corner(), "keydown", { key: "ArrowLeft" });
    await send(corner(), "pointerdown", { clientX: 130, clientY: 159 });
    await send(corner(), "pointermove", { clientX: 30, clientY: 59 });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("ends a held gesture when viewport geometry changes and uses the new scale next time", async () => {
    await render();
    await send(corner(), "pointerdown", { clientX: 100, clientY: 100 });
    bounds = { left: 20, top: 50, width: 700, height: 248 };
    await act(async () => {
      observers.forEach((callback) => callback());
    });
    expect(document.querySelector(".capture-photo-loupe")).toBeNull();
    await send(corner(), "pointermove", { clientX: 125, clientY: 125 });
    expect(changed).not.toHaveBeenCalled();
    await send(corner(), "pointerdown", { clientX: 100, clientY: 100 });
    await send(corner(), "pointermove", { clientX: 125, clientY: 125 });
    expect(lastQuad()[0]).toEqual([320, 360]);
  });

  it("keeps malformed corners operable so they can be repaired", async () => {
    await render({
      corners: [
        [120, 160],
        [120, 160],
        [1080, 1440],
        [120, 1440],
      ],
    });
    expect(document.querySelectorAll(".capture-photo-grid line")).toHaveLength(
      0,
    );
    await send(corner(1), "keydown", { key: "ArrowRight", shiftKey: true });
    expect(lastQuad()[1]).toEqual([130, 160]);
    expect(document.querySelectorAll(".capture-photo-corner")).toHaveLength(4);
  });
});
