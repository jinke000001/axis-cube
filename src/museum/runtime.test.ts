import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { Group, PerspectiveCamera } from "three";

const harness = vi.hoisted(() => ({ renderers: [] as any[], callbacks: new Set<() => void>(), tweens: [] as any[] }));
vi.mock("gsap", () => ({ gsap: {
  ticker: { add: (callback: () => void) => harness.callbacks.add(callback), remove: (callback: () => void) => harness.callbacks.delete(callback) },
  to(target: any, options: any) {
    const tween = { active: true, kill: vi.fn(function (this: any) { this.active = false; }), pause: vi.fn(), resume: vi.fn(),
      isActive() { return this.active; }, progress() { target.set(options.x, options.y, options.z); this.active = false; options.onUpdate(); }, options };
    harness.tweens.push(tween); return tween;
  },
} }));
vi.mock("three", async original => {
  const actual = await original<typeof import("three")>();
  return { ...actual, PMREMGenerator: class { fromScene() { return { texture: new actual.Texture(), dispose: vi.fn() }; } dispose() {} },
    WebGLRenderer: class {
      domElement = document.createElement("canvas"); shadowMap = {}; info = { memory: { geometries: 0, textures: 0 }, render: { triangles: 0 } };
      render = vi.fn(); dispose = vi.fn(); forceContextLoss = vi.fn(); setPixelRatio = vi.fn(); setSize = vi.fn();
      constructor() { harness.renderers.push(this); }
    },
  };
});
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({ GLTFLoader: class { load() {} } }));
import { MuseumRuntime, retainMuseumRuntime } from "./runtime";

let runtime: MuseumRuntime;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document);
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  harness.renderers.length = 0; harness.tweens.length = 0; harness.callbacks.clear();
  runtime = new MuseumRuntime();
});
afterEach(() => { runtime.dispose(); vi.unstubAllGlobals(); });
function exhibit() {
  const host = document.createElement("div"); document.body.append(host);
  host.getBoundingClientRect = () => ({ left: 100, top: 100, right: 700, bottom: 600, width: 600, height: 500, x: 100, y: 100, toJSON() {} });
  return { root: new Group(), camera: new PerspectiveCamera(), host, update: vi.fn(), pause: vi.fn(), available: vi.fn() };
}
function tick() { harness.callbacks.forEach(callback => callback()); }

describe("museum ownership and active-exhibit clock", () => {
  it("retains the canvas through StrictMode cleanup/reacquisition and releases it only after the last owner", async () => {
    runtime.dispose(); harness.renderers.length = 0;
    const first = retainMuseumRuntime(); first.release();
    const replacement = retainMuseumRuntime(), nested = retainMuseumRuntime();
    expect(replacement.runtime).toBe(first.runtime); expect(harness.renderers).toHaveLength(1);
    replacement.release(); replacement.release();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(harness.renderers[0].dispose).not.toHaveBeenCalled();
    nested.release(); await new Promise(resolve => setTimeout(resolve, 5));
    expect(harness.renderers[0].dispose).toHaveBeenCalledOnce(); expect(harness.callbacks.size).toBe(0);
  });
  it("reuses one renderer and one clock through 30 station replacements", () => {
    runtime.setRoute("/", false);
    for (let i = 0; i < 30; i++) {
      runtime.setRoute(["/", "/learn/f2l", "/library/oll/1", "/solve"][i % 4], false);
      const content = exhibit(), registration = runtime.register(content);
      tick(); expect(content.update).toHaveBeenCalledTimes(1);
      registration.dispose(); content.host.remove(); tick();
      expect(content.update).toHaveBeenCalledTimes(1);
      expect(runtime.scene.children).not.toContain(content.root);
    }
    expect(harness.renderers).toHaveLength(1);
    expect(harness.callbacks.size).toBe(1);
    expect(harness.renderers[0].dispose).not.toHaveBeenCalled();
    runtime.dispose(); expect(harness.callbacks.size).toBe(0); expect(harness.renderers[0].dispose).toHaveBeenCalledTimes(1);
  });
  it("updates only the active visible exhibit and pauses outgoing/background work", () => {
    runtime.setRoute("/learn/one", false);
    const first = exhibit(), second = exhibit();
    runtime.register(first); tick(); runtime.register(second); tick();
    expect(first.update).toHaveBeenCalledTimes(1); expect(second.update).toHaveBeenCalledTimes(1);
    expect(first.pause).toHaveBeenCalledOnce();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new window.Event("visibilitychange")); tick();
    expect(second.update).toHaveBeenCalledTimes(1); expect(second.pause).toHaveBeenCalledOnce();
  });
  it("redirects the transition to the last destination and snaps reduced motion", () => {
    runtime.setRoute("/", false); runtime.setRoute("/learn", false);
    const first = harness.tweens.at(-1);
    expect(first.options.duration).toBe(.78);
    runtime.setRoute("/library", false); expect(first.kill).toHaveBeenCalledOnce();
    runtime.setRoute("/solve", true); expect(harness.tweens.at(-1).kill).toHaveBeenCalledOnce();
    expect(runtime.renderer.domElement.dataset.station).toBe("solve");
    tick(); expect(runtime.camera.position.x).toBeCloseTo(-3.4 + 1.05);
  });
  it("leaves registered content readable when the shared context is lost and restores availability", () => {
    const content = exhibit(); runtime.register(content); tick();
    runtime.renderer.domElement.dispatchEvent(new window.Event("webglcontextlost", { cancelable: true })); tick();
    expect(content.available).toHaveBeenLastCalledWith(false); expect(content.update).toHaveBeenCalledTimes(1);
    runtime.renderer.domElement.dispatchEvent(new window.Event("webglcontextrestored")); tick();
    expect(content.available).toHaveBeenLastCalledWith(true); expect(content.update).toHaveBeenCalledTimes(2);
  });
});
