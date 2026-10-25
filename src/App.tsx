import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Camera,
  CircleHelp,
  Download,
  Eye,
  Focus,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Route,
  ScanLine,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  applyAlgorithm,
  DEFAULT_PALETTE,
  COLOR_NAMES,
  FACE_NAMES,
  parseAlgorithm,
  randomScramble,
  SOLVED,
  snapshots,
  type Face,
} from "./core/cube";
import {
  exportSession,
  loadSession,
  newSession,
  readSession,
  saveSession,
  type Session,
} from "./core/session";
import { Solver } from "./core/solver";
import { readFollow, saveFollow } from "./core/follow";
import type { CFOPPhaseName } from "./core/cfop-state";
import {
  type MotionFrame,
  type Side,
} from "./scene/motion";
import { compileFingerSolve } from "./scene/finger-solve-program";
import { retimeFingerProgram } from "./scene/finger-cadence";
import { expandExecutionMoves } from "./core/execution-moves";
import type { PresentationMode } from "./core/competition";
import { compileCompetitiveExecution } from "./scene/competitive-program";
import { Studio, type CameraView, type CameraSnapshot, type FrameReport } from "./scene/studio";
import { CubeNet } from "./components/CubeNet";
import { Capture } from "./components/Capture";
import { FingerStudies } from "./components/FingerStudies";
import { ALL_FINGER_STUDIES, studySession, type FingerStudy } from "./core/finger-studies";
const initial = loadSession();
const initialMode: PresentationMode = (() => {
  try { return initial?.competition && localStorage.getItem("axis.presentation.v1") === "competitive" ? "competitive" : "cfop"; }
  catch { return "cfop"; }
})();
const initialFollow = readFollow(initial, initialMode);
const seeded = applyAlgorithm(SOLVED, "R U2 F' L D B2 R' F2 U L2 D' B R2 U' F");
const CFOP_LABELS: Record<CFOPPhaseName, [string,string]> = {
  cross: ["十字", "底层十字"], f2l: ["F2L", "前两层配对"],
  oll: ["OLL", "顶层定向"], pll: ["PLL", "顶层排列"],
};
const clock = (t: number) =>
  t < 60
    ? t.toFixed(2) + " s"
    : Math.floor(t / 60) +
      ":" +
      Math.floor(t % 60)
        .toString()
        .padStart(2, "0");
const programCache=new Map<string,ReturnType<typeof compileFingerSolve>>();
function sessionProgram(solution: string, practice=false, competitive=false) {
  const key=`${competitive?'competitive':'cfop'}:${practice?'practice':'solve'}:${solution}`,cached=programCache.get(key);
  if(cached)return cached;
  const moves=parseAlgorithm(solution);
  const duration=practice?Math.min(5,Math.round((.9+moves.length*.35)*100)/100):5;
  const result=retimeFingerProgram(competitive ? compileCompetitiveExecution(moves,duration) : compileFingerSolve(moves,duration));
  programCache.set(key,result);
  if(programCache.size>6)programCache.delete(programCache.keys().next().value!);
  return result;
}
function readableSessionProgram(solution:string,practice=false,competitive=false) {
  try{return {program:sessionProgram(solution,practice,competitive),issue:""};}
  catch(error){return {program:compileFingerSolve([]),issue:error instanceof Error?error.message:"当前动作无法播放"};}
}
function describeHandRoles(frame?: MotionFrame, rotation=false): Record<Side, string> {
  if(rotation && frame?.stage==='TURN') {
    const holders = new Set(frame.contacts?.filter(contact => contact.role === 'drive').map(contact => contact.side));
    return {left:holders.has('left')?'持握转体':'预备接应',right:holders.has('right')?'持握转体':'预备接应'};
  }
  if (!frame?.active) return { left: "稳持", right: "稳持" };
  const active = frame.active,
    other: Side = active === "left" ? "right" : "left";
  const roles = { left: "承托", right: "承托" };
  if (frame.stage === "REORIENT") {
    roles[active] = "接应";
    roles[other] = "换向";
  } else if (["UNLOAD", "TRANSFER", "SUPPORT"].includes(frame.stage)) {
    roles[active] = "承托";
    roles[other] = "回接";
  } else
    roles[active] =
      frame.stage === "TURN"
        ? frame.activeFinger ? ["拇指","食指","中指","无名指","小指"][frame.activeFinger-1]+"拨层" : "腕转"
        : frame.stage === "RECEIVE"
          ? "接握"
          : "预备";
  return roles;
}
export default function App() {
  const mount = useRef<HTMLDivElement>(null),
    engine = useRef<Studio | null>(null),
    solver = useRef(new Solver());
  const [savedSession, setSession] = useState<Session | null>(initial),
    [ready, setReady] = useState(false),
    [sceneError, setSceneError] = useState(""),
    [report, setReport] = useState<FrameReport | null>(null);
  const [playing, setPlaying] = useState(false),
    [pace, setPace] = useState<"race" | "slow" | "study">("race"),
    [view, setView] = useState<CameraView>("arms"),
    [capture, setCapture] = useState(false),
    [busy, setBusy] = useState(!initial),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [ghost, setGhost] = useState(false),
    [trace, setTrace] = useState(false),
    [auto, setAuto] = useState(false),
    [info, setInfo] = useState(false),
    [followPreference, setFollow] = useState(initialFollow.enabled),
    [confirmed, setConfirmed] = useState(initialFollow.completed),
    [showInspector, setShowInspector] = useState(true);
  const [study, setStudy] = useState<FingerStudy | null>(null),
    [showStudies, setShowStudies] = useState(false);
  const [mode, setMode] = useState<PresentationMode>(initialMode);
  const modePlayback = useRef<Record<PresentationMode, number>>({ cfop: 0, competitive: 0 });
  const pendingAction = useRef<"solve" | "competition">("solve");
  const session = useMemo(() => study ? studySession(study) : savedSession, [study, savedSession]);
  const follow = !study && followPreference;
  const returnPlayback = useRef({ time: 0, pace: "race" as typeof pace, view: "arms" as CameraView, auto:false, camera:undefined as CameraSnapshot | undefined });
  const importRequest = useRef(0);
  const request = useRef(0);
  const pendingSolve = useRef({
    state: initial?.facelets ?? seeded,
    palette: initial?.palette ?? DEFAULT_PALETTE,
    name: initial?.name ?? "序章 / 机械协奏",
  });
  const competitiveView = study ? study.mode === "competitive" : mode === "competitive" && !!session?.competition;
  const visibleSolution = !study && competitiveView ? session!.competition!.execution.algorithm : session?.solution ?? "";
  const compiled = useMemo(() => readableSessionProgram(visibleSolution,!!study,competitiveView), [visibleSolution, study, competitiveView]),
    program=compiled.program,
    moves=useMemo(()=>program.steps.map((step)=>step.move),[program]),
    steps = program.steps,
    duration = program.duration,
    time = report?.time ?? 0,
    index = report?.frame.index ?? 0;
  const speed = pace === "race" ? 1 : pace === "slow" ? 0.25 : 0.1;
  const handRoles = describeHandRoles(report?.frame,moves[index]?.kind==='rotation');
  const current = moves[index],
    complete = !!session && !compiled.issue && index >= moves.length,
    states = useMemo(() => snapshots(session?.facelets ?? seeded, moves),[session?.facelets,moves]),
    displayState = states[Math.min(index, states.length - 1)];
  const phases=useMemo(()=>{
    if (compiled.issue || study) return undefined;
    if (competitiveView && session?.competition) {
      const { boundaries } = session.competition.execution;
      return session.competition.phases.map(phase => ({...phase,start:boundaries[phase.start],end:boundaries[phase.end]}));
    }
    if(!session?.phases)return undefined;
    const {boundaries}=expandExecutionMoves(parseAlgorithm(session.solution));
    return session.phases.map((phase)=>({...phase,start:boundaries[phase.start],end:boundaries[phase.end]}));
  },[session,compiled.issue,study,competitiveView]);
  const currentPhase = phases?.find((phase) => index >= phase.start && index < phase.end) ?? phases?.at(-1);
  const activeError=error||compiled.issue;
  useEffect(() => {
    const studio = new Studio(
      mount.current!,
      (r) => {
        setReport(r);
        if (r.stoppedAtBoundary) setPlaying(false);
      },
      (ok, message) => {
        setReady(ok);
        setSceneError(message ?? "");
      },
      () => setAuto(false),
    );
    engine.current = studio;
    studio.configure(
      initial?.facelets ?? seeded,
      program,
      initial?.palette ?? DEFAULT_PALETTE,
    );
    if (initialFollow.enabled)
      studio.seek(
        program.steps[
          initialFollow.completed
        ]?.start ?? studio.duration,
      );
    return () => {
      studio.dispose();
      engine.current = null;
      solver.current.cancel();
    };
  }, []);
  function rememberMode(next: PresentationMode) {
    setMode(next);
    try { localStorage.setItem("axis.presentation.v1",next); } catch { /* Session export remains available. */ }
  }
  function accept(next: Session, autoplay = true, prepared?: ReturnType<typeof sessionProgram>, desiredMode = mode) {
    const nextMode = desiredMode === "competitive" && next.competition ? "competitive" : "cfop";
    const nextProgram=prepared ?? sessionProgram(nextMode === "competitive" ? next.competition!.execution.algorithm : next.solution,false,nextMode === "competitive");
    if (study) restoreStudyPresentation();
    setStudy(null);
    setSession(next);
    rememberMode(nextMode);
    modePlayback.current = { cfop: 0, competitive: 0 };
    engine.current?.configure(
      next.facelets,
      nextProgram,
      next.palette,
    );
    setConfirmed(0);
    const play =
      autoplay &&
      !followPreference &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !!next.solution;
    setPlaying(play);
    if (engine.current) engine.current.playing = play;
    setError("");
    setNotice(
      saveSession(next) ? "" : "浏览器未能保存局面，可下载局面文件保留。",
    );
  }
  async function solve(
    state: string,
    palette = DEFAULT_PALETTE,
    name = "随机局面",
  ) {
    pendingAction.current = "solve";
    importRequest.current++;
    pendingSolve.current = { state, palette, name };
    const token = ++request.current;
    setBusy(true);
    setPlaying(false);
    if (engine.current) engine.current.playing = false;
    setError("");
    try {
      const result = await solver.current.solve(state);
      if (token !== request.current) return;
      const next = newSession(state, result.solution, palette, name, { method: result.method === "competitive" ? "cfop" : result.method, phases: result.phases });
      if (mode === "competitive") {
        const competition = await solver.current.solve(state,undefined,"competitive");
        if (token !== request.current) return;
        if (!competition.competition) throw new Error("竞速编排没有返回完整动作。");
        next.competition = competition.competition;
      }
      accept(readSession(next));
    } catch (e) {
      if (token === request.current)
        setError(e instanceof Error ? e.message : "计算失败");
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  async function chooseMode(nextMode: PresentationMode) {
    if (!savedSession || study || busy || nextMode === mode) return;
    const source = savedSession, token = ++request.current;
    importRequest.current++;
    pendingAction.current = "competition";
    modePlayback.current[mode] = engine.current?.time ?? 0;
    setPlaying(false);
    if (engine.current) engine.current.playing = false;
    setError("");
    try {
      let next = source;
      if (nextMode === "competitive" && !source.competition) {
        setBusy(true);
        const result = await solver.current.solve(source.facelets,undefined,"competitive");
        if (token !== request.current) return;
        if (!result.competition) throw new Error("竞速编排没有返回完整动作。");
        next = readSession({ ...source, competition: result.competition });
      }
      const nextProgram = sessionProgram(nextMode === "competitive" ? next.competition!.execution.algorithm : next.solution,false,nextMode === "competitive");
      if (next !== source) {
        setSession(next);
        setNotice(saveSession(next) ? "" : "浏览器未能保存竞速编排，可下载局面文件保留。");
      }
      const progress = readFollow(next,nextMode);
      rememberMode(nextMode);
      setFollow(progress.enabled); setConfirmed(progress.completed);
      engine.current?.configure(next.facelets,nextProgram,next.palette);
      engine.current?.seek(progress.enabled ? nextProgram.steps[progress.completed]?.start ?? nextProgram.duration :
        Math.min(modePlayback.current[nextMode],nextProgram.duration));
    } catch (error) {
      if (token === request.current) setError(error instanceof Error ? error.message : "竞速编排失败");
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!initial) void solve(seeded, DEFAULT_PALETTE, "序章 / 机械协奏");
  }, []);
  useEffect(() => {
    if (engine.current) engine.current.playing = playing && !busy && !capture;
  }, [playing, busy, capture]);
  useEffect(() => {
    if (engine.current) engine.current.speed = speed;
  }, [speed]);
  useEffect(() => {
    engine.current?.ghost(ghost);
  }, [ghost, ready]);
  useEffect(() => {
    engine.current?.showTrace(trace);
  }, [trace]);
  useEffect(() => {
    if (engine.current) engine.current.autoCamera = auto;
  }, [auto]);
  useEffect(() => {
    if (engine.current)
      engine.current.stopAt =
        follow && confirmed < moves.length
          ? (steps[confirmed + 1]?.start ?? duration)
          : undefined;
    if (
      !study && !compiled.issue && session &&
      !saveFollow(session, { enabled: follow, completed: confirmed }, mode)
    )
      setNotice("跟做进度未能保存；当前局面仍可下载。");
  }, [follow, confirmed, session, duration, study, compiled.issue, mode]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        capture ||
        info || showStudies ||
        /INPUT|TEXTAREA|SELECT|BUTTON/.test(
          (event.target as HTMLElement).tagName,
        )
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        engine.current?.step(1);
        setPlaying(false);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        engine.current?.step(-1);
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function togglePlay() {
    if (busy || !ready || !session || compiled.issue) return;
    if (
      !playing &&
      follow &&
      confirmed < moves.length &&
      (index !== confirmed || time >= (steps[confirmed + 1]?.start ?? duration))
    ) {
      engine.current?.seek(steps[confirmed].start);
    } else if (!playing && complete) {
      engine.current?.seek(0);
    }
    setPlaying((p) => !p);
  }
  function chooseView(next: CameraView) {
    setView(next);
    setAuto(false);
    engine.current?.view(next);
  }
  function previewStudy(next: FingerStudy) {
    if (!study) returnPlayback.current = { time: engine.current?.time ?? 0, pace, view, auto, camera:engine.current?.captureView?.() };
    const temporary = studySession(next);
    setStudy(next);
    setShowStudies(false);
    setPlaying(false);
    setPace("slow");
    chooseView("close");
    engine.current?.configure(temporary.facelets, sessionProgram(temporary.solution,true,next.mode === "competitive"), temporary.palette);
  }
  function restoreStudyPresentation() {
    const previous=returnPlayback.current;
    setPace(previous.pace);
    chooseView(previous.view);
    setAuto(previous.auto);
    if (engine.current) {
      if(previous.camera)engine.current.restoreView(previous.camera);
      engine.current.autoCamera=previous.auto;
    }
  }
  function leaveStudy() {
    if (!study) return;
    setStudy(null);
    setPlaying(false);
    restoreStudyPresentation();
    if (savedSession) {
      const restored=readableSessionProgram(mode === "competitive" && savedSession.competition ? savedSession.competition.execution.algorithm : savedSession.solution,false,mode === "competitive");
      engine.current?.configure(savedSession.facelets, restored.program, savedSession.palette);
      engine.current?.seek(Math.min(returnPlayback.current.time,restored.program.duration));
    }
  }
  function closeCapture() {
    importRequest.current++;
    setCapture(false);
  }
  async function importFile(file: File): Promise<string | void> {
    const token=++importRequest.current, operation=request.current;
    try {
      if (file.size > 16000)
        throw new Error("局面文件过大，请选择 AXIS 导出的 JSON。");
      const text=await file.text();
      if(token!==importRequest.current || operation!==request.current)return;
      const next = readSession(JSON.parse(text));
      const nextMode=mode === "competitive" && next.competition ? "competitive" : "cfop";
      const prepared=sessionProgram(nextMode === "competitive" ? next.competition!.execution.algorithm : next.solution,false,nextMode === "competitive");
      request.current++;
      solver.current.cancel();
      setBusy(false);
      setCapture(false);
      accept(next,true,prepared);
    } catch (e) {
      if(token!==importRequest.current || operation!==request.current)return;
      return e instanceof SyntaxError
        ? "局面文件不是有效的 JSON，请选择 AXIS 导出的文件。"
        : e instanceof Error
          ? e.message
          : "文件读取失败";
    }
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="AXIS 首页">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <strong>
            AXIS<span> / STUDIO</span>
          </strong>
        </a>
        <nav aria-label="主导航">
          <button className={!study ? "nav-active" : ""} onClick={leaveStudy}>
            工作台<span>01</span>
          </button>
          <button className={study ? "nav-active" : ""} disabled={!ready || busy}
            onClick={() => { setPlaying(false); setShowStudies(true); }}>指法<span>{ALL_FINGER_STUDIES.length}</span></button>
          <button
            onClick={() => {
              setPlaying(false);
              setCapture(true);
            }}
          >
            我的魔方
            <ArrowUpRight size={13} />
          </button>
        </nav>
        <div className="header-end">
          <span className="live-dot" />
          <span className="desktop-only">双臂协作 · 灵巧演示</span>
          <button
            className="icon-button"
            aria-label="使用说明"
            onClick={() => setInfo(true)}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <main
        className={"workspace" + (!showInspector ? " inspector-hidden" : "")}
      >
        <section className="scene-panel" aria-label="机械演示工作台">
          <div className="scene-host" ref={mount} />
          <div className="scene-heading">
            <div className="eyebrow">DEXTERITY STUDY / 001</div>
            <h1>
              双臂魔方<span>Dual-arm cube</span>
            </h1>
            <p>解构每一次转动。</p>
          </div>
          <div className="scene-top-right">
            <span className={"status-pill " + (ready ? "" : "pending")}>
              <i />
              {sceneError
                ? "加载中断"
                : !ready
                  ? "准备机械手"
                  : busy
                    ? "计算解法"
                    : playing
                      ? "正在演示"
                      : complete
                        ? study ? "片段完成" : "还原完成"
                        : "待机"}
            </span>
            <button
              className="icon-button"
              aria-label={showInspector ? "收起信息栏" : "展开信息栏"}
              onClick={() => setShowInspector((v) => !v)}
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>
          <div className="camera-toolbar" aria-label="镜头选择">
            {(["arms", "close", "top"] as CameraView[]).map((v, i) => (
              <button
                key={v}
                className={view === v && !auto ? "selected" : ""}
                onClick={() => chooseView(v)}
              >
                {i === 0 ? (
                  <Maximize2 size={14} />
                ) : i === 1 ? (
                  <Focus size={14} />
                ) : (
                  <Camera size={14} />
                )}
                <span>{["全臂", "特写", "俯视"][i]}</span>
              </button>
            ))}
            <span className="separator" />
            <button
              className={auto ? "selected" : ""}
              aria-pressed={auto}
              onClick={() => setAuto((v) => !v)}
            >
              <Eye size={14} />
              <span>巡游</span>
            </button>
          </div>
          <div className="scene-bottom">
            <span>
              <i className="small-cross" />
              拖动旋转 · 滚轮缩放
            </span>
            <div className="scene-observation-controls">
              <button
                className={trace ? "ghost-active" : ""}
                aria-label="显示腕部运动轨迹"
                aria-pressed={trace}
                disabled={!ready || !moves.length}
                onClick={() => setTrace((v) => !v)}
              >
                <Route size={14} />
                轨迹
              </button>
              <button
                className={ghost ? "ghost-active" : ""}
                aria-pressed={ghost}
                onClick={() => setGhost((v) => !v)}
              >
                <ScanLine size={14} />
                透视手部
              </button>
            </div>
          </div>
          {trace && ready && moves.length > 0 && (
            <div className="trajectory-legend" aria-label="运动轨迹图例">
              <span className="left-trace">
                <i />
                左腕
              </span>
              <span className="right-trace">
                <i />
                右腕
              </span>
              <span>第 {Math.min(index + 1, moves.length)} 步路径</span>
              <span className="trace-marker-note">亮点为当前位置</span>
            </div>
          )}
          {!ready && (
            <div className="scene-loading" role="status">
              {sceneError ? (
                <>
                  <strong>模型未能加载</strong>
                  <p>{sceneError}</p>
                  <button onClick={() => location.reload()}>重新加载</button>
                </>
              ) : (
                <>
                  <div className="loader-orbit" />
                  <p>
                    装配双臂与灵巧手<span>加载关节、网格与材质</span>
                  </p>
                </>
              )}
            </div>
          )}
          <div className="stage-caption">
            KINEMATIC REPLAY<span>WUJI HAND · DUAL ARM</span>
          </div>
        </section>
        <aside className="inspector" aria-label="动作与局面">
          <div className="inspector-top">
            <span className="eyebrow">LIVE SEQUENCE</span>
            <span className="muted">
              {String(index + (!complete ? 1 : 0)).padStart(2, "0")} /{" "}
              {String(moves.length).padStart(2, "0")}
            </span>
          </div>
          <section className="move-card">
            <div className="move-display">
              {busy ? "…" : complete ? "✓" : (current?.notation ?? "—")}
              <span>
                {busy
                  ? "正在求解"
                  : complete
                    ? study ? "片段完成" : "还原完成"
                    : current
                      ? (current.kind==='rotation'?"整物转面":FACE_NAMES[current.face]+"面") +
                        " · " +
                        (current.turns === 2
                          ? "180°"
                          : current.turns === 3
                            ? "逆时针 90°"
                            : "顺时针 90°")
                      : "准备中"}
              </span>
            </div>
            <div className="phase-line">
              <span className="live-dot" />
              {busy
                ? "生成与当前局面对应的动作"
                : (report?.frame.phase ?? "准备演示")}
              <span>双手协作</span>
            </div>
            <div className="hand-cooperation" aria-label="双手当前分工">
              <span className="left-hand-role">左手 · {handRoles.left}</span>
              <span className="right-hand-role">右手 · {handRoles.right}</span>
            </div>
            <div className="phase-progress">
              <i style={{ width: (report?.frame.progress ?? 0) * 100 + "%" }} />
            </div>
          </section>
          {study && <div className="study-context">
            <span className="eyebrow">FINGER STUDY</span><strong>{study.name}</strong>
            <p>{study.focus}</p>
            {study.algorithm!==moves.map((move)=>move.notation).join(' ') && <p className="execution-note">实际动作 <code>{moves.map((move)=>move.notation).join(' ')}</code></p>}
            <button onClick={leaveStudy}>返回我的魔方 <ArrowUpRight size={13} /></button>
          </div>}
          <section className="net-section">
            <div className="section-title">
              <span>当前局面</span>
              <small>URFDLB</small>
            </div>
            <CubeNet
              state={displayState}
              palette={session?.palette}
              active={current?.face}
            />
            <p>展开图显示当前步骤开始时的状态</p>
          </section>
          <section className="sequence-section">
            {!study && session && <div className="presentation-control">
              <div className="presentation-switch" role="group" aria-label="复原编排">
                <button aria-pressed={mode === "cfop"} disabled={busy || !ready} onClick={() => void chooseMode("cfop")}>{session.method === "cfop" ? "CFOP 分步" : "原有解法"}</button>
                <button aria-pressed={mode === "competitive"} disabled={busy || !ready} onClick={() => void chooseMode("competitive")}>竞速编排</button>
              </div>
              <p>{competitiveView ? "五指接力 · 顺势换面 · 连续衔接" : session.method === "cfop" ? "保留清晰的 CFOP 阶段与原有手法" : "保留原始解法与已有跟做进度"}</p>
            </div>}
            {!study && !competitiveView && session && session.method !== "cfop" && <button className="cfop-upgrade"
              disabled={busy || !ready} onClick={() => solve(session.facelets,session.palette,session.name)}>
              <span>同一局面 · CFOP编排</span><ArrowUpRight size={14}/>
              {follow && <small>重新编排后，跟做从第1步开始</small>}
            </button>}
            {phases && <nav className="cfop-phases" aria-label="CFOP阶段">
              {phases.map((phase) => <button
                key={phase.name}
                className={currentPhase?.name === phase.name ? "current" : index >= phase.end ? "past" : ""}
                aria-label={`查看${CFOP_LABELS[phase.name][1]}阶段`}
                aria-current={currentPhase?.name === phase.name ? "step" : undefined}
                title={phase.start === phase.end ? "此阶段无需转动" : `${CFOP_LABELS[phase.name][1]} · 第${phase.start + 1}–${phase.end}步`}
                disabled={busy || !ready || phase.start === phase.end}
                onClick={() => { engine.current?.seek(steps[phase.start]?.start ?? duration); setPlaying(false); }}
              ><span>{CFOP_LABELS[phase.name][0]}</span><small>{phase.end - phase.start} 步</small></button>)}
            </nav>}
            <div className="section-title">
              <span>{currentPhase ? CFOP_LABELS[currentPhase.name][1] : "动作序列"}</span>
              <small>{currentPhase ? `${currentPhase.end > currentPhase.start ? currentPhase.start + 1 : 0}–${currentPhase.end} / ${moves.length}` : `${moves.length} MOVES`}</small>
            </div>
            <div className="move-list">
              {moves.map((m, i) => (!currentPhase || (i >= currentPhase.start && i < currentPhase.end)) && (
                <button
                  key={i}
                  className={i === index ? "current" : i < index ? "past" : ""}
                  aria-label={"跳到第" + (i + 1) + "步 " + m.notation}
                  aria-current={i === index ? "step" : undefined}
                  title={`${m.notation} · ${steps[i]?.active === "left" ? "左手" : "右手"}转层`}
                  onClick={() => {
                    engine.current?.seek(steps[i].start);
                    setPlaying(false);
                  }}
                >
                  {m.notation}
                </button>
              ))}
            </div>
          </section>
          <div className="inspector-footer">
            <span>{session?.name ?? "正在准备局面"}</span>
            <button
              className="icon-button"
              aria-label="下载当前局面"
              disabled={!savedSession || !!study}
              onClick={() => session && exportSession(session)}
            >
              <Download size={16} />
            </button>
          </div>
        </aside>
      </main>
      {(activeError || notice) && (
        <div
          className={"notice" + (activeError ? " error" : "")}
          role={activeError ? "alert" : "status"}
        >
          <span>{activeError || notice}</span>
          {activeError && (
            <button
              onClick={() => pendingAction.current === "competition" ? void chooseMode("competitive") :
                void solve(
                  pendingSolve.current.state,
                  pendingSolve.current.palette,
                  pendingSolve.current.name,
                )
              }
            >
              重试
            </button>
          )}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <footer className="transport">
        <div className="timeline-row">
          <span>{clock(time / speed)}</span>
          <input
            type="range"
            aria-label="播放进度"
            min="0"
            max={duration || 1}
            step="0.01"
            value={time}
            style={
              {
                "--progress": (duration ? (time / duration) * 100 : 0) + "%",
              } as React.CSSProperties
            }
            onChange={(e) => {
              engine.current?.seek(Number(e.target.value));
              setPlaying(false);
            }}
          />
          <span>{clock(duration / speed)}</span>
        </div>
        <div className="transport-row">
          <div className="playback-controls">
            <button
              className="icon-button"
              aria-label="从头重播"
              onClick={() => {
                engine.current?.seek(0);
                setPlaying(!follow);
              }}
              disabled={busy || !session}
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="上一步"
              onClick={() => {
                engine.current?.step(-1);
                setPlaying(false);
              }}
              disabled={busy}
            >
              <SkipBack size={18} />
            </button>
            <button
              className="play-button"
              aria-label={playing ? "暂停演示" : "播放演示"}
              onClick={togglePlay}
              disabled={busy || !ready || !!compiled.issue}
            >
              {playing ? (
                <Pause size={19} fill="currentColor" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              aria-label="下一步"
              onClick={() => {
                engine.current?.step(1);
                setPlaying(false);
              }}
              disabled={busy}
            >
              <SkipForward size={18} />
            </button>
            <select
              aria-label="播放速度"
              value={pace}
              onChange={(e) => setPace(e.target.value as typeof pace)}
            >
              <option value="race">{study?"原速":"竞速"} · {duration.toFixed(study?2:0)} 秒</option>
              <option value="slow">慢动作 · {(duration*4).toFixed(study?1:0)} 秒</option>
              <option value="study">细看 · {(duration*10).toFixed(study?1:0)} 秒</option>
            </select>
          </div>
          <div className="playback-mode">
            <button
              className={!follow ? "active" : ""}
              disabled={!!study}
              onClick={() => {
                setFollow(false);
              }}
            >
              连续演示
            </button>
            <button
              className={follow ? "active" : ""}
              disabled={!!study}
              onClick={() => {
                setFollow(true);
                setPace("study");
                setPlaying(false);
                engine.current?.seek(steps[confirmed]?.start ?? duration);
              }}
            >
              逐步跟做
            </button>
            {follow && (
              <>
                <button
                  className="confirm-step"
                  disabled={confirmed >= moves.length}
                  onClick={() => {
                    const n = Math.min(confirmed + 1, moves.length);
                    setConfirmed(n);
                    engine.current?.seek(steps[n]?.start ?? duration);
                    setPlaying(false);
                  }}
                >
                  {confirmed >= moves.length
                    ? "实物已全部完成"
                    : `实物 ${confirmed} / ${moves.length} · 确认第 ${confirmed + 1} 步`}
                </button>
                <button
                  className="icon-button"
                  aria-label="撤回一步实物确认"
                  disabled={!confirmed}
                  onClick={() => {
                    const n = Math.max(0, confirmed - 1);
                    setConfirmed(n);
                    engine.current?.seek(steps[n]?.start ?? 0);
                    setPlaying(false);
                  }}
                >
                  <RotateCcw size={13} />
                </button>
                <span className="follow-reference">
                  开始时{COLOR_NAMES[session ? session.palette[session.facelets[4] as Face] : "U"]}色朝上、
                  {COLOR_NAMES[session ? session.palette[session.facelets[22] as Face] : "F"]}色朝前。
                  {moves.some((move)=>move.kind==='rotation')?'遇到转体符号，按演示整体换面。':'保持这个朝向，按符号转层。'}
                </span>
              </>
            )}
          </div>
          <div className="session-controls">
            <button
              className="subtle-button"
              aria-label="生成新局面"
              disabled={busy}
              onClick={() => solve(applyAlgorithm(SOLVED, randomScramble()))}
            >
              <Shuffle size={15} />
              <span>新局面</span>
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setPlaying(false);
                setCapture(true);
              }}
            >
              <Camera size={16} />
              <span>录入魔方</span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </footer>
      <div className="app-footnote">
        <span>
          <i className="live-dot" />
          LOCAL STUDIO<span className="footnote-divider">/</span>浏览器本地计算
        </span>
        <span>
          {ready ? (report?.fps ?? "—") + " FPS" : "LOADING"}
          <span className="footnote-divider">/</span>V 0.1
        </span>
      </div>
      {capture && (
        <Capture
          onClose={closeCapture}
          onAccept={(state, palette) => {
            setCapture(false);
            void solve(state, palette, "我的魔方");
          }}
          onImport={importFile}
        />
      )}
      {info && <Info onClose={() => setInfo(false)} />}
      {showStudies && <FingerStudies selected={study?.id} onSelect={previewStudy} onClose={() => setShowStudies(false)} />}
    </div>
  );
}
function Info({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="info-dialog" onCancel={onClose}>
      <button
        className="dialog-close icon-button"
        aria-label="关闭说明"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="eyebrow">AXIS / FIELD NOTES</div>
      <h2>观察每一次协作</h2>
      <p>
        这是由真实魔方状态驱动的运动学演示。双臂按关节轨迹运动，尚不代表实体机器人能够以相同接触力完成操作。
      </p>
      <dl>
        <dt>镜头</dt>
        <dd>拖动旋转，滚轮缩放；全臂、特写、俯视可随时切换。</dd>
        <dt>播放</dt>
        <dd>
          解法准备后，竞速模式约 5 秒完成整轮演示；慢动作约 20
          秒，细看保留完整关节节奏。空格播放／暂停，方向键单步，时间轴可回看。这里显示的是动画用时。
        </dd>
        <dt>我的魔方</dt>
        <dd>
          按指引拍摄六个面，只翻转整颗魔方，不拧动单层。所有识别和求解在本地进行。
        </dd>
        <dt>逐步跟做</dt>
        <dd>
          回看位置和已确认的实物进度分别记录，拖动时间轴不会自动改变完成步数。
        </dd>
        <dt>指法片段</dt>
        <dd>从「指法」选择短片段，用同一条时间轴慢放、暂停和回看。返回工作台时恢复原局面、播放位置和跟做进度。</dd>
      </dl>
      <p className="license-note">
        手部模型：Wuji Technology · MIT
        <br />
        求解器：rubiks-cube-solver / cubejs · MIT
        <br />
        机械臂与场景：AXIS Studio
      </p>
      <button className="primary-button" onClick={onClose}>
        回到工作台
      </button>
    </dialog>
  );
}
