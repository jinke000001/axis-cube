import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { getMuseumRuntime, type ExhibitRegistration } from "../museum/runtime";
import { pieceAtSticker, pieceFromRay, type PiecePick } from "../museum/piece-pick";
export type { PiecePick } from "../museum/piece-pick";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Box, ChevronLeft, ChevronRight, Focus, Grid3X3, Move3D, Pause, Play, Repeat, RotateCcw } from "lucide-react";
import { COLORS, COLOR_NAMES, DEFAULT_PALETTE, FACES, FACE_NAMES, NORMALS, SOLVED, type Face, type Move } from "../core/cube";
import { CubeModel } from "../scene/cube-model";
import { CENTER } from "../scene/motion";
import {
  clampLessonPosition,
  createLessonPlayback,
  nextLessonStep,
  previousLessonStep,
  sampleLessonFrame,
  targetStickerIndices,
} from "./lesson-playback";
import "./LessonPlayer.css";

export interface LessonPlayerProps {
  initialState: string;
  algorithm: string;
  focusFace?: Face;
  focusPieces?: Face[][];
  focusLabel?: string;
  label: string;
  onStepChange?: (step: number) => void;
  initialStep?: number;
  reduceMotion?: boolean;
  onPiecePick?: PiecePick;
  hideControls?: boolean;
}

interface LessonScene {
  draw: () => void;
  resetView: () => void;
  setOrbit: (enabled: boolean) => void;
}

const emptyPlayback = createLessonPlayback(SOLVED, "");
const initialView = new Vector3(0.16, 0.145, 0.19).multiplyScalar(1.16).add(CENTER);

function describeMove(move: Move): string {
  if (move.kind === "rotation") return `整颗魔方换向 ${move.notation}，不是只转一层`;
  const amount = move.turns === 2 ? "转半圈" : move.turns === 3 ? "逆时针转四分之一圈" : "顺时针转四分之一圈";
  if (move.kind === "wide") return `${FACE_NAMES[move.face]}侧两层一起${amount}`;
  if (move.kind === "slice") return `中间层 ${move.notation}；按公式标注的参照方向转动`;
  return `${FACE_NAMES[move.face]}面${amount}；以正对这一面观察为准`;
}

function StateNet({ state, focusFace, focusPieces, onPiecePick }: { state: string; focusFace?: Face; focusPieces?: Face[][]; onPiecePick?: PiecePick }) {
  const targets = targetStickerIndices(state, focusPieces);
  return <div className="lp-net" aria-label="当前步骤的魔方六面展开图">
    {FACES.map((face, faceIndex) => <div key={face} className={`lp-net-face lp-net-${face}${face === focusFace ? " lp-net-active" : ""}`}>
      <span className="lp-net-label">{FACE_NAMES[face]} {face}</span>
      <div className="lp-net-squares">
        {Array.from({ length: 9 }, (_, cell) => {
          const color = state[faceIndex * 9 + cell] as Face;
          const index = faceIndex * 9 + cell;
          const props = { className: targets.has(index) ? "lp-target-sticker" : undefined, style: { backgroundColor: COLORS[color] }, "aria-label": `${targets.has(index) ? "目标块，" : ""}${FACE_NAMES[face]}面第${cell + 1}格，${COLOR_NAMES[color]}色` };
          const content = cell === 4 ? <b>{face}</b> : null;
          return onPiecePick ? <button key={cell} type="button" {...props} onClick={() => { const piece = pieceAtSticker(state, index); if (piece) onPiecePick(piece.colors, piece.position); }}>{content}</button> : <span key={cell} {...props}>{content}</span>;
        })}
      </div>
    </div>)}
  </div>;
}

export default function LessonPlayer({ initialState, algorithm, focusFace, focusPieces, focusLabel, label, onStepChange, initialStep = 0, reduceMotion: lessonReduceMotion = false, onPiecePick, hideControls = false }: LessonPlayerProps) {
  const parsed = useMemo(() => {
    try { return { playback: createLessonPlayback(initialState, algorithm), error: "" }; }
    catch (error) { return { playback: emptyPlayback, error: error instanceof Error ? error.message : "教学动作暂时无法读取。" }; }
  }, [initialState, algorithm]);
  const playback = parsed.playback;
  const [step, setStep] = useState(() => Math.floor(clampLessonPosition(initialStep, playback.moves.length)));
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [orbit, setOrbit] = useState(false);
  const [net, setNet] = useState(false);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reducedMotion = systemReducedMotion || lessonReduceMotion;
  const section = useRef<HTMLElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const labels = useRef<Partial<Record<Face, HTMLSpanElement | null>>>({});
  const engine = useRef<LessonScene | null>(null);
  const position = useRef(step);
  const currentStep = useRef(step);
  const callback = useRef(onStepChange);
  const pick = useRef(onPiecePick);
  const clock = useRef({ loop, speed, finishedAt: null as number | null });
  const playbackTick = useRef<(now: number, delta: number) => void>(() => {});
  const visible = useRef(true);
  const running = useRef(false);
  const data = useRef(playback);
  const focus = useRef(focusFace);
  const targetPieces = useRef(focusPieces);
  const reduce = useRef(reducedMotion);
  const showNet = useRef(net);
  const firstStep = useRef(initialStep);
  callback.current = onStepChange;
  pick.current = onPiecePick;
  clock.current.loop = loop; clock.current.speed = speed;
  data.current = playback;
  focus.current = focusFace;
  targetPieces.current = focusPieces;
  reduce.current = reducedMotion;
  showNet.current = net;
  firstStep.current = initialStep;

  const pause = useCallback(() => { running.current = false; setPlaying(false); }, []);
  const draw = useCallback(() => {
    if (!showNet.current) engine.current?.draw();
  }, []);
  const seek = useCallback((value: number, notify = true) => {
    position.current = clampLessonPosition(value, data.current.moves.length);
    const completed = Math.floor(position.current);
    if (completed !== currentStep.current || notify) {
      currentStep.current = completed;
      setStep(completed);
      callback.current?.(completed);
    }
    draw();
  }, [draw]);

  useEffect(() => {
    pause();
    seek(Math.floor(clampLessonPosition(firstStep.current, playback.moves.length)));
    setOrbit(false);
    engine.current?.resetView();
  }, [playback, pause, seek]);

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { setSystemReducedMotion(preference.matches); pause(); };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, [pause]);

  useEffect(() => { pause(); }, [lessonReduceMotion, pause]);

  useEffect(() => {
    const host = mount.current;
    if (!host || parsed.error) return;
    let controls: OrbitControls | undefined;
    let cube: CubeModel | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let registration: ExhibitRegistration | undefined;
    let disposed = false;
    const root = new Group();
    const outlines: { line: LineSegments; face: Face; index: number }[] = [];
    const outlineGeometries = new Set<EdgesGeometry>();
    const outlineMaterial = new LineBasicMaterial({ color: "#93d5f3", transparent: true, opacity: 0.95, depthTest: true });
    let pointerStart: { x: number; y: number } | undefined;
    let onPointerUp: ((event: PointerEvent) => void) | undefined;
    const onPointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; engine.current = null; registration?.dispose();
      resizeObserver?.disconnect(); controls?.dispose();
      host.removeEventListener("pointerdown", onPointerDown);
      if (onPointerUp) host.removeEventListener("pointerup", onPointerUp);
      outlines.forEach(({ line }) => line.removeFromParent());
      outlineGeometries.forEach(geometry => geometry.dispose()); outlineMaterial.dispose(); cube?.dispose(); root.clear();
    };
    try {
      const museum = getMuseumRuntime();
      const camera = new PerspectiveCamera(35, 1, 0.001, 40);
      camera.position.copy(initialView); camera.lookAt(CENTER);
      cube = new CubeModel(); root.add(cube.root);
      cube.root.traverse(object => {
        if (!(object instanceof Mesh) || !object.name.startsWith("sticker-")) return;
        const index = Number(object.name.slice(8)), geometry = new EdgesGeometry(object.geometry, 15);
        outlineGeometries.add(geometry);
        const line = new LineSegments(geometry, outlineMaterial);
        line.scale.setScalar(1.025); line.visible = false; line.renderOrder = 2;
        object.add(line); outlines.push({ line, face: FACES[Math.floor(index / 9)], index });
      });
      controls = new OrbitControls(camera, host);
      controls.target.copy(CENTER); controls.enableDamping = false; controls.enableZoom = false; controls.enablePan = false;
      controls.enabled = false; controls.minPolarAngle = 0.18; controls.maxPolarAngle = Math.PI - 0.18; controls.update();
      const identity = new Quaternion(), direction = new Vector3(), point = new Vector3();
      const render = () => {
        if (disposed || !cube || showNet.current || document.hidden || !visible.current) return;
        const frame = sampleLessonFrame(data.current, position.current, reduce.current);
        cube.update(frame.state, DEFAULT_PALETTE, identity, frame.move, frame.angle);
        const targets = targetStickerIndices(frame.state, targetPieces.current);
        outlines.forEach(({ line, face, index }) => { line.visible = targetPieces.current?.length ? targets.has(index) : face === focus.current; });
        registration?.invalidate();
      };
      const updateLabels = () => {
        const rect = host.getBoundingClientRect();
        direction.copy(museum.camera.position).sub(root.position).sub(CENTER).normalize();
        FACES.forEach(face => {
          const element = labels.current[face]; if (!element) return;
          const normal = new Vector3(...NORMALS[face]), facing = direction.dot(normal) > 0.23;
          element.hidden = !facing; if (!facing) return;
          point.copy(normal).multiplyScalar(0.087).add(CENTER).add(root.position).project(museum.camera);
          element.hidden = point.z < -1 || point.z > 1;
          element.style.left = `${((point.x * 0.5 + 0.5) * window.innerWidth - rect.left) / rect.width * 100}%`;
          element.style.top = `${((-point.y * 0.5 + 0.5) * window.innerHeight - rect.top) / rect.height * 100}%`;
        });
      };
      const localControls = controls;
      controls.addEventListener("change", render);
      registration = museum.register({
        root, camera, host,
        visible: () => visible.current, show: () => !showNet.current,
        update: (now, delta) => { playbackTick.current(now, delta); localControls.update(); },
        afterRender: updateLabels,
        pause,
        available: available => { if (!disposed) { setSceneState(available ? "ready" : "unavailable"); if (!available) pause(); } },
      });
      engine.current = {
        draw: render,
        resetView() { camera.position.copy(initialView); localControls.target.copy(CENTER); localControls.update(); render(); },
        setOrbit(enabled) { localControls.enabled = enabled; host.style.touchAction = enabled ? "none" : "pan-y"; },
      };
      const ray = new Raycaster(), pointer = new Vector2();
      onPointerUp = event => {
        if (!pick.current || !pointerStart || localControls.enabled || !cube || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) return;
        pointerStart = undefined;
        pause(); seek(Math.floor(position.current));
        pointer.set(event.clientX / window.innerWidth * 2 - 1, -event.clientY / window.innerHeight * 2 + 1);
        ray.setFromCamera(pointer, museum.camera); root.updateWorldMatrix(true, true);
        const piece = pieceFromRay(data.current.states[Math.floor(position.current)], cube.root, ray);
        if (piece) pick.current(piece.colors, piece.position);
      };
      host.addEventListener("pointerdown", onPointerDown); host.addEventListener("pointerup", onPointerUp);
      const resize = () => { if (disposed || !host.clientWidth || !host.clientHeight) return; camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); render(); };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); resize();
      setSceneState("ready");
    } catch { cleanup(); setSceneState("unavailable"); }
    return cleanup;
  }, [parsed.error, pause, seek]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
      else draw();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("axis:app-pause", pause);
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (!entry.isIntersecting) pause();
      else draw();
    }, { threshold: 0.01 }) : null;
    if (section.current) observer?.observe(section.current);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("axis:app-pause", pause);
      observer?.disconnect();
      running.current = false;
    };
  }, [pause, draw, parsed.error]);

  useEffect(() => {
    engine.current?.setOrbit(orbit && !net);
    draw();
  }, [orbit, net, focusFace, focusPieces, reducedMotion, draw]);

  // The museum drives lesson playback too: switching stations cannot leave a second RAF behind.
  playbackTick.current = (now, delta) => {
    if (!running.current || !data.current.moves.length) return;
    if (document.hidden || !visible.current) { pause(); return; }
    if (position.current >= data.current.moves.length) {
      if (!clock.current.loop) { pause(); return; }
      clock.current.finishedAt ??= now;
      if (now - clock.current.finishedAt >= 1000) { seek(0); clock.current.finishedAt = null; }
    } else { clock.current.finishedAt = null; seek(position.current + delta * 1000 / (1450 / clock.current.speed), false); }
  };

  const togglePlaying = () => {
    if (running.current) { pause(); return; }
    if (!visible.current || document.hidden || !playback.moves.length) return;
    if (position.current >= playback.moves.length) seek(0);
    running.current = true;
    setPlaying(true);
  };
  const jump = (value: number) => { pause(); seek(value); };
  const resetView = () => { setOrbit(false); engine.current?.resetView(); };
  const actualStep = Math.min(step, playback.moves.length);
  const state = playback.states[actualStep];
  const finished = actualStep === playback.moves.length;
  const nextMove = playback.moves[actualStep];
  const useNet = net || sceneState === "unavailable";

  if (parsed.error) return <section className="lp-player lp-error" aria-label={label}><p role="alert">{parsed.error}</p></section>;

  return <section ref={section} className="lp-player" aria-label={`${label}，交互演示`}>
    <div className="lp-viewbar">
      <span className="lp-view-title">{focusPieces?.length ? "追踪目标块" : focusFace ? `观察${FACE_NAMES[focusFace]}面 ${focusFace}` : "看清这一段变化"}</span>
      <div className="lp-view-actions">
        <button type="button" onClick={() => { pause(); setNet((value) => !value); }} aria-pressed={useNet} disabled={sceneState === "unavailable"}>
          {useNet && sceneState !== "unavailable" ? <Box size={16} /> : <Grid3X3 size={16} />}{useNet && sceneState !== "unavailable" ? "三维视图" : "展开图"}
        </button>
        <button type="button" onClick={resetView} disabled={useNet}><Focus size={16} />视角复位</button>
      </div>
    </div>
    <div className={`lp-stage${orbit ? " lp-orbit" : ""}`}>
      <div ref={mount} className="lp-scene" style={{ visibility: useNet ? "hidden" : "visible" }} />
      {!useNet && <div className="lp-labels" aria-hidden="true">{FACES.map((face, index) => <span key={face} ref={(element) => { labels.current[face] = element; }} className={`lp-face-label${focusFace === face ? " lp-face-focus" : ""}`} hidden>
        {FACE_NAMES[face]}面 {face}<small>{COLOR_NAMES[state[index * 9 + 4] as Face]}中心</small>
      </span>)}</div>}
      {useNet && <div className="lp-net-wrap"><StateNet state={state} focusFace={focusPieces?.length ? undefined : focusFace} focusPieces={focusPieces} onPiecePick={onPiecePick}/></div>}
      {sceneState === "loading" && !net && <p className="lp-loading">正在准备魔方…</p>}
      {!useNet && sceneState === "ready" && <button type="button" className="lp-orbit-toggle" aria-pressed={orbit} onClick={() => { pause(); setOrbit((value) => !value); }}><Move3D size={15} />{orbit ? "完成视角调整" : "调整观察视角"}</button>}
    </div>
    <p className="lp-view-hint">
      {focusPieces?.length ? <span className="lp-target-hint">蓝色描边：{focusLabel || "本次观察的目标块"}。 </span> : null}
      {sceneState === "unavailable" ? "当前设备未能显示三维画面，已切换为真实局面的展开图；仍可逐步核对。" : orbit ? "在画面内拖动观察；完成后可复位。观察角度不会改变转动记号。" : useNet ? "展开图显示当前已完成步骤的局面；中心字母表示面的位置。" : "正面 F 是固定参照。看背面时也不要把观察角度当成整颗换向。"}
    </p>
    {!hideControls && <div className="lp-step-status" aria-live="polite" aria-atomic="true">
      <span className="lp-step-count">{actualStep === 0 ? "起始局面" : `已完成 ${actualStep} / ${playback.moves.length} 步`}</span>
      <span>{!playback.moves.length ? "先观察目标块与中心的关系。" : finished ? "演示完成，对照课程检查实物。" : `${nextMove.notation} · ${describeMove(nextMove)}`}</span>
    </div>}
    {!hideControls && !!playback.moves.length && <>
      <div className="lp-controls">
        <div className="lp-transport">
          <button type="button" className="lp-icon-button" aria-label="返回起始局面" onClick={() => jump(0)}><RotateCcw size={19} /></button>
          <button type="button" className="lp-icon-button" aria-label="上一步" disabled={position.current === 0} onClick={() => jump(previousLessonStep(position.current, playback.moves.length))}><ChevronLeft size={22} /></button>
          <button type="button" className="lp-play-button" disabled={sceneState === "unavailable"} onClick={togglePlaying}><span>{playing ? <Pause size={19} /> : <Play size={19} />}</span>{playing ? "暂停" : finished ? "再看一遍" : "播放示范"}</button>
          <button type="button" className="lp-icon-button" aria-label="下一步" disabled={finished} onClick={() => jump(nextLessonStep(position.current, playback.moves.length))}><ChevronRight size={22} /></button>
        </div>
        <div className="lp-options">
          <label className="lp-speed"><span>速度</span><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="教学播放速度"><option value="0.6">细看</option><option value="1">慢速</option><option value="1.6">熟悉</option></select></label>
          <button type="button" className="lp-loop-button" aria-pressed={loop} onClick={() => setLoop((value) => !value)}><Repeat size={17} />循环</button>
        </div>
      </div>
      <label className="lp-scrubber"><span className="lp-sr-only">跳到已完成的动作步数</span><input type="range" min="0" max={playback.moves.length} step="1" value={actualStep} aria-valuetext={`已完成 ${actualStep} 步，共 ${playback.moves.length} 步`} onChange={(event) => jump(Number(event.target.value))} /></label>
      <details className="lp-formula" key={algorithm} open={playback.moves.length <= 8}>
        <summary>完整公式 · {playback.moves.length} 步<span aria-hidden="true">+</span></summary>
        <div className="lp-algorithm" aria-label="点击公式中的动作，从该动作前开始观察">
          {playback.moves.map((move, index) => <button type="button" key={`${index}-${move.notation}`} className={`${index < actualStep ? "lp-done" : ""}${index === actualStep ? " lp-current" : ""}`} aria-current={index === actualStep ? "step" : undefined} aria-label={`查看第 ${index + 1} 步 ${move.notation} 前的局面`} onClick={() => jump(index)}>{move.notation}</button>)}
        </div>
      </details>
    </>}
    {reducedMotion && <p className="lp-reduced-note">已减少动态转动，播放将逐步显示局面。</p>}
  </section>;
}
