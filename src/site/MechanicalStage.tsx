import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Studio } from "../scene/studio";
import { DEFAULT_PALETTE, parseAlgorithm } from "../core/cube";
import { studySession, type FingerStudy } from "../core/finger-studies";
import { completedMechanicalSourceStep, loadMechanicalTimeline, type MechanicalTimeline } from "./motion-loader";

export interface MechanicalStageProps {
  study: FingerStudy;
  close?: boolean;
  initialState?: string;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  reduceMotion?: boolean;
}
export default function MechanicalStage({ study, close = false, initialState, initialStep = 0, onStepChange, reduceMotion = false }: MechanicalStageProps) {
  const host = useRef<HTMLDivElement>(null), engine = useRef<Studio | null>(null);
  const timeline = useRef<MechanicalTimeline | null>(null), callback = useRef(onStepChange), startStep = useRef(initialStep);
  const currentStep = useRef(-1), reduced = useRef(reduceMotion);
  callback.current = onStepChange; startStep.current = initialStep; reduced.current = reduceMotion;
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [ghost, setGhost] = useState(false);
  const [logicalStep, setLogicalStep] = useState(initialStep), [totalSteps, setTotalSteps] = useState(0), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    let live = true, visible = true, studio: Studio | undefined;
    setReady(false); setError(""); setPlaying(false); setTime(0); currentStep.current = -1;
    const reportStep = (step: number) => { if (step !== currentStep.current) { currentStep.current = step; setLogicalStep(step); callback.current?.(step); } };
    const prepare = async () => { try {
      const session = studySession(study), moves = parseAlgorithm(session.solution), duration = Math.max(5, moves.length * 1.2);
      const compiled = await loadMechanicalTimeline(session.solution, duration, study.mode === "competitive");
      if (!live || !host.current) return;
      timeline.current = compiled; setTotalSteps(compiled.sourceMoves.length);
      studio = new Studio(host.current, report => {
        if (!live) return;
        setTime(report.duration ? report.time / report.duration : 0);
        reportStep(completedMechanicalSourceStep(compiled, report.frame.index));
        if (report.stoppedAtBoundary || !studio?.playing) setPlaying(false);
      }, (ok, issue) => { if (live) { setReady(ok); if (issue) setError(issue); else setError(""); } });
      studio.configure(initialState ?? session.facelets, compiled.program, DEFAULT_PALETTE);
      const first = Math.max(0, Math.min(compiled.sourceMoves.length, Math.floor(startStep.current)));
      studio.seek(compiled.sourceTimes[first]); reportStep(first);
      studio.reduceMotion = reduced.current; studio.view(close ? "close" : "arms"); studio.suspended = !visible; engine.current = studio;
    } catch (e) { if (live) setError(e instanceof Error ? e.message : "三维演示暂时无法打开"); } };
    void prepare();
    const pause = () => { if (studio) { studio.playing = false; setPlaying(false); } };
    const onVisibility = () => { if (document.hidden) pause(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (studio) { studio.suspended = !visible; if (studio.suspended) pause(); } });
    observer.observe(host.current); document.addEventListener("visibilitychange", onVisibility); window.addEventListener("axis:app-pause", pause);
    return () => { live = false; observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("axis:app-pause", pause); studio?.dispose(); engine.current = null; timeline.current = null; };
  }, [study, close, initialState, retry]);
  useEffect(() => { if (engine.current) engine.current.ghost(ghost); }, [ghost, ready]);
  useEffect(() => { if (engine.current) engine.current.reduceMotion = reduceMotion; }, [reduceMotion]);
  function toggle() {
    const studio = engine.current; if (!studio || !ready) return;
    if (studio.time >= studio.duration) studio.seek(0);
    studio.playing = !studio.playing; setPlaying(studio.playing);
    // Pause on a committed original step so swapping views never presents half an M/wide move.
    if (!studio.playing && timeline.current) studio.seek(timeline.current.sourceTimes[Math.max(0, currentStep.current)]);
  }
  return <div className="as-mechanical">
    <div className="as-stage" ref={host}/>
    <div className="as-stage-label"><span>AXIS / MOTION STUDY</span><span>双手协作</span></div>
    {!ready && <div className="as-stage-message" role="status">{error ? <>演示暂时无法加载<span>可以继续阅读课程，或重新打开这段演示。</span><button className="as-stage-retry" onClick={() => setRetry(value => value + 1)}>重新加载</button></> : <>正在准备双手演示<span>课程和导航已经可以使用。</span></>}</div>}
    <div className="as-stage-controls">
      <button onClick={toggle} disabled={!ready} aria-label={playing ? "暂停机械手演示" : "播放机械手演示"}>{playing ? <Pause size={16}/> : <Play size={16}/>}<span>{playing ? "暂停" : time >= 1 ? "再看一次" : "观看动作"}</span></button>
      <button aria-label="机械演示回到起点" disabled={!ready} onClick={() => { engine.current!.playing = false; engine.current!.seek(0); setPlaying(false); }}><RotateCcw size={16}/></button>
      <label><input type="checkbox" checked={ghost} onChange={e => setGhost(e.target.checked)}/>透视手部</label>
      <span className="as-stage-counter" aria-label={`已完成 ${logicalStep} 步，共 ${totalSteps} 步`}>{logicalStep.toString().padStart(2, "0")} / {totalSteps.toString().padStart(2, "0")}</span>
    </div>
  </div>;
}
