import {
  CanvasTexture, Group, Mesh, MeshStandardMaterial, PerspectiveCamera,
  PlaneGeometry, SRGBColorSpace, Vector3, type WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { DexterousHand } from "./hand";
import { disposeObject, getMuseumRuntime, type ExhibitRegistration } from "../museum/runtime";
import { loadMuseumHands } from "../museum/hand-cache";
import { MechanicalArm } from "./arm";
import { CubeModel } from "./cube-model";
import { MotionTrace } from "./trajectory";
import {
  type MotionFrame,
} from "./motion";
import { mechanicalPlayback, type PlaybackProgram } from "./playback";
import {
  DEFAULT_PALETTE,
  SOLVED,
  snapshots,
  type Move,
  type Palette,
} from "../core/cube";
export type CameraView = "arms" | "close" | "top";
export interface CameraSnapshot {
  position: number[]; target: number[]; view: CameraView; orbitPhase: number; auto: boolean;
}
export interface FrameReport {
  time: number;
  duration: number;
  frame: MotionFrame;
  fps: number;
  triangles: number;
  stoppedAtBoundary: boolean;
}
export class Studio {
  renderer: WebGLRenderer;
  scene = new Group();
  camera = new PerspectiveCamera(37, 1, 0.01, 12);
  controls: OrbitControls;
  time = 0;
  playing = false;
  speed = 1;
  autoCamera = false;
  ready = false;
  disposed = false;
  suspended = false;
  reduceMotion = false;
  stopAt: number | undefined;
  private cube = new CubeModel();
  private trace = new MotionTrace();
  private arms = {
    left: new MechanicalArm("left"),
    right: new MechanicalArm("right"),
  };
  hands?: { left: DexterousHand; right: DexterousHand };
  private program = mechanicalPlayback([]);
  private states = [SOLVED];
  private palette = DEFAULT_PALETTE;
  private observer: ResizeObserver;
  private registration: ExhibitRegistration;
  private runtime = getMuseumRuntime();
  private reportTime = 0;
  private needsRender = true;
  private renderedTime = -1;
  private deltas: number[] = [];
  private targetPosition = new Vector3(0.4, 0.54, 1.0);
  private targetLook = new Vector3(0, 0.25, 0);
  private transitioning = true;
  private currentView: CameraView = "arms";
  private orbitPhase = 0.38;
  constructor(
    private host: HTMLElement,
    private report: (value: FrameReport) => void,
    status: (ready: boolean, error?: string) => void,
    onOrbit: () => void = () => {},
  ) {
    this.renderer = this.runtime.renderer;
    host.setAttribute("aria-label", "双机械臂魔方三维场景，可拖动旋转视角");
    this.camera.position.copy(this.targetPosition);
    this.controls = new OrbitControls(this.camera, host);
    this.controls.target.copy(this.targetLook);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 3.5;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.enablePan = true;
    this.controls.addEventListener("change", () => { this.needsRender = true; this.registration?.invalidate(); });
    this.controls.addEventListener("start", () => {
      this.transitioning = false; this.autoCamera = false; onOrbit();
    });
    this.createStage();
    this.scene.add(
      this.cube.root,
      this.arms.left.root,
      this.arms.right.root,
      this.trace.root,
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.registration = this.runtime.register({
      root: this.scene, camera: this.camera, host,
      update: this.animate,
      visible: () => !this.suspended,
      pause: () => { this.playing = false; },
      available: available => { if (!available) { this.playing = false; status(false, "三维画面暂时中断；课程图示仍可使用。"); } else if (this.ready) status(true); },
    });
    void loadMuseumHands().then(hands => {
      if (this.disposed) return;
      this.hands = hands;
      hands.left.setGhost(false); hands.right.setGhost(false);
      this.scene.add(hands.left.root, hands.right.root);
      this.ready = true; this.needsRender = true; this.registration.invalidate(); if (this.runtime.available) status(true);
    }).catch(error => { if (!this.disposed) status(false, error instanceof Error ? error.message : "手部资源加载失败"); });
  }

  private createStage() {
    const stage = new Group();
    const board = new Mesh(
      new RoundedBoxGeometry(1.0, 0.033, 0.56, 4, 0.027),
      new MeshStandardMaterial({
        color: "#242d30",
        metalness: 0.68,
        roughness: 0.32,
      }),
    );
    board.position.y = 0.007;
    board.receiveShadow = true;
    board.castShadow = true;
    stage.add(board);
    const trim = new Mesh(
      new RoundedBoxGeometry(1.005, 0.005, 0.565, 3, 0.024),
      new MeshStandardMaterial({
        color: "#576365",
        metalness: 0.8,
        roughness: 0.3,
      }),
    );
    trim.position.y = -0.006;
    stage.add(trim);
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, 2048, 1024);
    c.strokeStyle = "rgba(186,204,203,.11)";
    c.lineWidth = 1;
    for (let x = 64; x < 2048; x += 64) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 1024);
      c.stroke();
    }
    for (let y = 0; y < 1024; y += 64) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(2048, y);
      c.stroke();
    }
    c.strokeStyle = "rgba(195,208,200,.32)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(1024, 490, 150, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(1024, 490, 155, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(207,215,202,.7)";
    c.font = "22px monospace";
    c.fillText("AXIS  /  DEXTERITY STUDIO", 130, 900);
    c.font = "15px monospace";
    c.fillStyle = "rgba(174,191,188,.5)";
    c.fillText("DUAL ARM SYSTEM     —     KINEMATIC STUDY 01", 130, 936);
    c.fillText("L / 01", 190, 240);
    c.fillText("R / 02", 1740, 240);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const marks = new Mesh(
      new PlaneGeometry(0.97, 0.52),
      new MeshStandardMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        roughness: 0.65,
        metalness: 0.1,
      }),
    );
    marks.rotation.x = -Math.PI / 2;
    marks.position.y = 0.024;
    stage.add(marks);
    this.scene.add(stage);
  }

  configure(state: string, moves: Move[] | PlaybackProgram, palette: Palette) {
    this.needsRender = true;
    this.program = Array.isArray(moves) ? mechanicalPlayback(moves) : moves;
    this.states = snapshots(state, this.program.steps.map((step) => step.move));
    this.palette = palette;
    this.time = 0;
    this.stopAt = undefined;
  }
  get duration() {
    return this.program.duration;
  }
  seek(time: number) {
    this.time = Math.max(0, Math.min(this.duration, time));
    this.needsRender = true;
  }
  step(direction: number) {
    const index = this.program.sample(this.time).index;
    const target = Math.max(0, Math.min(this.program.steps.length, index + direction));
    this.seek(
      target === this.program.steps.length ? this.duration : this.program.steps[target].start,
    );
    this.playing = false;
  }
  view(view: CameraView) {
    this.currentView = view;
    this.transitioning = true;
    this.autoCamera = false;
    this.resize();
  }
  captureView(): CameraSnapshot {
    return { position:this.camera.position.toArray(), target:this.controls.target.toArray(), view:this.currentView, orbitPhase:this.orbitPhase, auto:this.autoCamera };
  }
  restoreView(snapshot: CameraSnapshot) {
    // OrbitControls clears accumulated rotation/pan deltas when damping is off.
    // Flush before restoring the recorded camera, so study gestures cannot drift it.
    const damping=this.controls.enableDamping;
    this.controls.enableDamping=false;
    this.controls.update();
    this.controls.enableDamping=damping;
    this.camera.position.fromArray(snapshot.position);
    this.controls.target.fromArray(snapshot.target);
    this.targetPosition.copy(this.camera.position);
    this.targetLook.copy(this.controls.target);
    this.currentView=snapshot.view;this.orbitPhase=snapshot.orbitPhase;this.autoCamera=snapshot.auto;
    this.transitioning=false;this.controls.update();
  }
  ghost(value: boolean) {
    this.hands?.left.setGhost(value);
    this.hands?.right.setGhost(value);
    this.needsRender = true;
  }
  showTrace(value: boolean) {
    this.trace.enabled = value;
    this.needsRender = true;
  }
  private resize() {
    this.needsRender = true;
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.fov = w < 650 ? 47 : 37;
    this.camera.updateProjectionMatrix();
    if (this.currentView === "close") {
      this.targetPosition.set(0.12, 0.62, 0.40);
      this.targetLook.set(0, 0.35, 0);
    } else if (this.currentView === "top") {
      this.targetPosition.set(0.015, 1.15, 0.015);
      this.targetLook.set(0, 0.24, 0);
    } else {
      this.targetPosition.set(0.4, 0.54, 1.0);
      this.targetLook.set(0, 0.25, 0);
      const offset = this.targetPosition.clone().sub(this.targetLook);
      const min =
        0.54 /
        (Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect);
      if (offset.length() < min)
        this.targetPosition.copy(this.targetLook).add(offset.setLength(min));
    }
    this.transitioning = true;
  }
  private animate = (now: number, dt: number, raw: number) => {
    if (this.disposed || this.suspended) return;
    const boundary = this.stopAt ?? this.duration;
    if (this.playing && this.ready && !document.hidden)
      this.time = Math.min(boundary, this.time + dt * this.speed);
    const stoppedAtBoundary = this.playing && this.time >= boundary;
    if (stoppedAtBoundary) this.playing = false;
    // Orbit damping can still move the camera while playback is paused.
    this.controls.update();
    if (!this.needsRender && !this.playing && !this.transitioning && !this.autoCamera && this.renderedTime === this.time) {
      return;
    }
    const frame = this.program.sample(this.time);
    const state = this.states[Math.min(frame.index, this.states.length - 1)];
    this.cube.update(
      state,
      this.palette,
      frame.orientation,
      this.program.steps[frame.index]?.move,
      frame.angle,
    );
    for (const side of ["left", "right"] as const) {
      this.hands?.[side].update(frame[side]);
      this.arms[side].update(frame[side].position, frame[side].quaternion);
    }
    this.trace.update(this.program, frame);
    if (this.transitioning) {
      const a = this.reduceMotion || this.runtime.reduceMotion ? 1 : 1 - Math.exp(-dt * 8);
      this.camera.position.lerp(this.targetPosition, a);
      this.controls.target.lerp(this.targetLook, a);
      if (this.camera.position.distanceTo(this.targetPosition) < 0.001)
        this.transitioning = false;
    }
    if (this.autoCamera && !this.transitioning && !this.reduceMotion && !this.runtime.reduceMotion) {
      this.orbitPhase += dt * 0.1;
      const radius = Math.max(
          1.08,
          0.54 /
            (Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect),
        ),
        a = 1 - Math.exp(-dt * 3);
      this.camera.position.lerp(
        new Vector3(
          Math.sin(this.orbitPhase) * radius,
          0.25 + (0.29 * radius) / 1.08,
          Math.cos(this.orbitPhase) * radius,
        ),
        a,
      );
      this.controls.target.lerp(new Vector3(0, 0.29, 0), a);
    }
    this.controls.update();
    this.registration.invalidate();
    if (raw > 0) {
      this.deltas.push(raw);
      if (this.deltas.length > 90) this.deltas.shift();
    }
    if (now - this.reportTime > 90 || stoppedAtBoundary || (!this.playing && (this.needsRender || this.renderedTime !== this.time))) {
      this.reportTime = now;
      this.report({
        time: this.time,
        duration: this.duration,
        frame,
        fps: Math.round(
          this.deltas.length / this.deltas.reduce((a, b) => a + b, 0),
        ),
        triangles: this.renderer.info.render.triangles,
        stoppedAtBoundary: !this.playing && this.time === boundary,
      });
    }
    this.needsRender = false;
    this.renderedTime = this.time;
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.playing = false;
    this.registration.dispose(); this.observer.disconnect(); this.controls.dispose();
    // Cached hands belong to the museum, not to a particular route/station.
    for (const hand of [this.hands?.left, this.hands?.right]) {
      if (hand?.root.parent === this.scene) hand.root.removeFromParent();
    }
    this.cube.dispose(); this.cube.root.removeFromParent();
    this.trace.dispose(); this.trace.root.removeFromParent();
    disposeObject(this.scene);
  }
}
