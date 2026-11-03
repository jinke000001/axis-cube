import { gsap } from "gsap";
import {
  ACESFilmicToneMapping, AmbientLight, Color, CylinderGeometry, DirectionalLight,
  FogExp2, Group, HemisphereLight, Material, Mesh, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Quaternion,
  Scene, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STATION_POSITIONS, stationForRoute, viewportProjection, type MuseumStation } from "./layout";

export interface MuseumExhibit {
  root: Group;
  camera: PerspectiveCamera;
  host: HTMLElement;
  /** Called only for the active, visible exhibit by the museum's sole render clock. */
  update(now: number, delta: number, rawDelta: number): void;
  pause(): void;
  afterRender?(): void;
  available?(available: boolean): void;
  visible?(): boolean;
  show?(): boolean;
}
export interface ExhibitRegistration {
  invalidate(): void;
  dispose(): void;
}
interface RegisteredExhibit extends MuseumExhibit { id: number; station: MuseumStation }
let createdContexts = 0;

/** Dispose an exhibit's own geometry once; never pass the shared gallery or renderer. */
export function disposeObject(root: Group) {
  const geometries = new Set<Mesh["geometry"]>();
  const materials = new Set<Material>();
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => {
    if (material instanceof MeshStandardMaterial) material.map?.dispose();
    material.dispose();
  });
  root.clear();
}

/** One renderer, scene, camera and ticker for the lifetime of the website. */
export class MuseumRuntime {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(42, 1, 0.005, 40);
  reduceMotion = false;
  private station: MuseumStation = "entry";
  private offset = new Vector3();
  private defaultCamera = new PerspectiveCamera(40, 1, 0.01, 40);
  private localPosition = new Vector3();
  private localQuaternion = new Quaternion();
  private framing = { fov: 40, offsetX: 0, offsetY: 0 };
  private cameraInitialized = false;
  private exhibits = new Map<number, RegisteredExhibit>();
  private sequence = 0;
  private active?: RegisteredExhibit;
  private transition?: gsap.core.Tween;
  private initialized = false;
  private disposed = false;
  private contextAvailable = true;
  private dirty = true;
  private width = 1;
  private height = 1;
  private last = 0;
  private frames = 0;
  private frameTimes: number[] = [];
  private renders = 0;
  private lastStats = 0;
  private readonly environment;
  private readonly gallery = new Group();
  private readonly key = new DirectionalLight("#f1f7ff", 3.2);
  private readonly keyTarget = new Group();
  private readonly rim = new DirectionalLight("#9bcced", 2.0);
  private readonly fallback = new Group();
  private readonly onVisibility = () => {
    this.last = 0;
    if (document.hidden) this.pause();
    else { this.dirty = true; this.transition?.resume(); }
  };
  private readonly onPause = () => { this.pause(); this.transition?.progress(1); };
  private readonly onResize = () => { this.resize(); this.dirty = true; };
  private readonly onScroll = () => { this.dirty = true; };
  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.contextAvailable = false;
    this.pause();
    this.exhibits.forEach(exhibit => exhibit.available?.(false));
    this.renderer.domElement.dataset.context = "lost";
  };
  private readonly onRestored = () => {
    this.contextAvailable = true;
    this.dirty = true;
    this.exhibits.forEach(exhibit => exhibit.available?.(true));
    this.renderer.domElement.dataset.context = "ready";
  };
  constructor() {
    this.renderer = new WebGLRenderer({ alpha: false, antialias: true, powerPreference: "high-performance" });
    createdContexts++;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = "museum-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.dataset.context = "ready";
    this.renderer.domElement.dataset.contextsCreated = String(createdContexts);
    this.renderer.domElement.dataset.renderLoops = "1";
    this.scene.background = new Color("#0a1016");
    this.scene.fog = new FogExp2("#0a1016", 0.073);
    const pmrem = new PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.5;
    room.dispose(); pmrem.dispose();
    this.scene.add(new AmbientLight("#d3e5f0", 0.55), new HemisphereLight("#e8f4ff", "#131b23", 1.05));
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    Object.assign(this.key.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.01, far: 6 });
    this.key.shadow.normalBias = 0.001; this.key.shadow.bias = -0.00015;
    this.key.target = this.keyTarget; this.rim.target = this.keyTarget;
    this.scene.add(this.key, this.keyTarget, this.rim, this.gallery);
    this.defaultCamera.position.set(1.05, 0.9, 1.65);
    this.defaultCamera.lookAt(0, 0.12, 0);
    this.createFallback();
    this.gallery.add(this.fallback);
    // Decoration is optional; a failed/offline load keeps the same usable environment.
    new GLTFLoader().load("/models/museum/axis-gallery.glb", gltf => {
      if (this.disposed) { disposeObject(gltf.scene); return; }
      this.fallback.removeFromParent(); disposeObject(this.fallback);
      gltf.scene.traverse(node => { if (node instanceof Mesh) { node.receiveShadow = true; node.castShadow = true; } });
      this.gallery.add(gltf.scene); this.dirty = true;
      this.renderer.domElement.dataset.gallery = "asset";
    }, undefined, () => { this.renderer.domElement.dataset.gallery = "fallback"; });
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onRestored);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
    window.addEventListener("axis:app-pause", this.onPause);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    gsap.ticker.add(this.tick);
  }
  private createFallback() {
    const floor = new Mesh(new PlaneGeometry(12, 12), new MeshStandardMaterial({ color: "#10171d", roughness: 0.8, metalness: 0.25 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.21; floor.receiveShadow = true; this.fallback.add(floor);
    Object.values(STATION_POSITIONS).forEach(position => {
      const stage = new Group(); stage.position.fromArray(position);
      const pedestal = new Mesh(new CylinderGeometry(0.55, 0.59, 0.15, 48), new MeshStandardMaterial({ color: "#252f36", metalness: 0.72, roughness: 0.34 }));
      pedestal.position.y = -0.115; pedestal.receiveShadow = true;
      const ring = new Mesh(new TorusGeometry(0.53, 0.0028, 6, 64), new MeshStandardMaterial({ color: "#89c6e7", emissive: "#568eac", emissiveIntensity: 1.1 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.036;
      stage.add(pedestal, ring); this.fallback.add(stage);
    });
  }
  get available() { return this.contextAvailable; }
  attach(host: HTMLElement) { if (this.renderer.domElement.parentElement !== host) host.append(this.renderer.domElement); this.resize(); }
  setRoute(route: string, reduceMotion: boolean) {
    this.reduceMotion = reduceMotion;
    const station = stationForRoute(route);
    const next = new Vector3(...STATION_POSITIONS[station]);
    if (!this.initialized || reduceMotion) {
      this.transition?.kill(); this.offset.copy(next); this.dirty = true;
    } else if (station !== this.station) {
      this.transition?.kill();
      this.transition = gsap.to(this.offset, { x: next.x, y: next.y, z: next.z, duration: 0.78, ease: "power2.inOut", onUpdate: () => { this.dirty = true; } });
    }
    if (station !== this.station) this.active?.pause();
    this.station = station; this.initialized = true;
    this.renderer.domElement.dataset.station = station;
    this.dirty = true;
  }
  register(exhibit: MuseumExhibit): ExhibitRegistration {
    const entry: RegisteredExhibit = { ...exhibit, id: ++this.sequence, station: this.station };
    entry.root.position.fromArray(STATION_POSITIONS[entry.station]);
    this.scene.add(entry.root); this.exhibits.set(entry.id, entry); this.dirty = true;
    exhibit.available?.(this.contextAvailable);
    return {
      invalidate: () => { this.dirty = true; },
      dispose: () => {
        if (!this.exhibits.delete(entry.id)) return;
        entry.pause(); entry.root.removeFromParent();
        if (this.active === entry) this.active = undefined;
        this.dirty = true;
      },
    };
  }
  private pause() { this.exhibits.forEach(exhibit => exhibit.pause()); this.transition?.pause(); this.last = 0; }
  private resize() {
    this.width = Math.max(1, window.innerWidth); this.height = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.width < 700 ? 1.4 : 1.75));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
  }
  private tick = () => {
    if (this.disposed || document.hidden || !this.contextAvailable) return;
    const now = performance.now(), rawDelta = this.last ? (now - this.last) / 1000 : 0, delta = Math.min(rawDelta, 0.05);
    this.last = now; this.frames++;
    if (rawDelta > 0) { this.frameTimes.push(rawDelta); if (this.frameTimes.length > 90) this.frameTimes.shift(); }
    let next: RegisteredExhibit | undefined;
    for (const exhibit of this.exhibits.values()) {
      const rect = exhibit.host.getBoundingClientRect();
      const visible = exhibit.station === this.station && exhibit.host.isConnected && rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < this.height && rect.right > 0 && rect.left < this.width && (exhibit.visible?.() ?? true);
      if (visible) next = exhibit;
    }
    if (next !== this.active) { this.active?.pause(); this.active = next; this.dirty = true; }
    this.exhibits.forEach(exhibit => {
      const show = exhibit === next && (exhibit.show?.() ?? true);
      if (exhibit.root.visible !== show) { exhibit.root.visible = show; this.dirty = true; }
    });
    next?.update(now, delta, rawDelta);
    const local = next?.camera ?? this.defaultCamera;
    const target = next ? viewportProjection(local.fov, this.height, next.host.getBoundingClientRect(), this.width) : { fov: local.fov, offsetX: 0, offsetY: 0 };
    const amount = !this.cameraInitialized || this.reduceMotion ? 1 : 1 - Math.exp(-delta * 12);
    this.localPosition.lerp(local.position, amount); this.localQuaternion.slerp(local.quaternion, amount);
    for (const key of ["fov", "offsetX", "offsetY"] as const) this.framing[key] += (target[key] - this.framing[key]) * amount;
    const movingCamera = this.localPosition.distanceToSquared(local.position) > 1e-10 || this.localQuaternion.angleTo(local.quaternion) > 1e-5
      || Math.abs(this.framing.fov - target.fov) > 0.001 || Math.abs(this.framing.offsetX - target.offsetX) + Math.abs(this.framing.offsetY - target.offsetY) > 0.02;
    this.cameraInitialized = true;
    if (!this.dirty && !this.transition?.isActive() && !movingCamera) { this.stats(now); return; }
    this.camera.position.copy(this.localPosition).add(this.offset); this.camera.quaternion.copy(this.localQuaternion);
    this.camera.near = local.near; this.camera.far = 40; this.camera.fov = this.framing.fov;
    this.camera.setViewOffset(this.width, this.height, this.framing.offsetX, this.framing.offsetY, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.key.position.copy(this.offset).add(new Vector3(-0.6, 1.65, 0.75));
    this.keyTarget.position.copy(this.offset).add(new Vector3(0, 0.2, 0));
    this.rim.position.copy(this.offset).add(new Vector3(0.7, 0.9, -0.7));
    this.renderer.render(this.scene, this.camera); next?.afterRender?.(); this.renders++;
    this.dirty = false; this.stats(now);
  };
  private stats(now: number) {
    if (now - this.lastStats < 500) return;
    this.lastStats = now;
    Object.assign(this.renderer.domElement.dataset, {
      exhibits: String(this.exhibits.size), activeExhibits: this.active ? "1" : "0",
      geometries: String(this.renderer.info.memory.geometries), textures: String(this.renderer.info.memory.textures),
      frames: String(this.frames), renders: String(this.renders), triangles: String(this.renderer.info.render.triangles),
      tickerFps: String(Math.round(this.frameTimes.length / (this.frameTimes.reduce((sum, delta) => sum + delta, 0) || 1))),
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); this.transition?.kill(); gsap.ticker.remove(this.tick);
    window.removeEventListener("resize", this.onResize); window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("axis:app-pause", this.onPause); document.removeEventListener("visibilitychange", this.onVisibility);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onLost); this.renderer.domElement.removeEventListener("webglcontextrestored", this.onRestored);
    disposeObject(this.gallery); this.environment.dispose(); this.key.shadow.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
let runtime: MuseumRuntime | undefined;
let failure: unknown;
let owners = 0;
let disposal: ReturnType<typeof setTimeout> | undefined;
export function getMuseumRuntime(): MuseumRuntime {
  if (failure) throw failure;
  if (!runtime) { try { runtime = new MuseumRuntime(); } catch (error) { failure = error; throw error; } }
  return runtime;
}
/** Provider ownership survives React StrictMode's synchronous effect rehearsal. */
export function retainMuseumRuntime() {
  if (disposal) clearTimeout(disposal);
  const active = getMuseumRuntime(); owners++;
  let released = false;
  return { runtime: active, release: () => {
    if (released) return; released = true;
    owners = Math.max(0, owners - 1);
    disposal = setTimeout(() => { if (!owners && runtime === active) { active.dispose(); runtime = undefined; } }, 0);
  } };
}
