import{openingView}from'../wuji-exhibition-u8-r1/opening-view';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  Info,
  Layers3,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  CFOP_CASES,
  getCFOPCase,
  type CFOPCase,
  type CFOPStage,
} from "../learning/cfop-library";
import { COLOR_NAMES, DEFAULT_PALETTE, type Move } from "../core/cube";
import { buildExplainableSubstages } from "../core/cfop-case-matcher";
import { CFOPDiagram } from "../site/CFOPDiagram";
import { navigate, navigationDepth } from "../site/router";
import {
  minimizeAndroidApp,
  subscribeToAndroidBack,
  subscribeToAppState,
} from "../platform/lifecycle";
import { getCaseFormulas } from "../demonstrator/catalog";
import { availableDemonstrationCount, isDemonstrationAvailable } from "../wuji-exhibition-u8-r1/availability";
import { formulaHref, useFormulaRoute } from "../wuji-exhibition-u8-r1/routes";
import {
  DEFAULT_PREFERENCES,
  readDemoPreferences,
  saveDemoPreferences,
} from "../wuji-exhibition-u8-r1/preferences";
import TeachingStage, { type StageFollowMode, type StageLoopMode } from "../wuji-exhibition-u8-r1/TeachingStage";
import { SourceAlgorithm } from "../wuji-exhibition-u8-r1/SourceAlgorithm";
import type {
  DemonstratorHandle,
  DemonstratorStatus,
  FormulaRecord,
} from "../demonstrator/types";
import "../style.css";
import "../demonstrator/demonstrator.css";
import '../wuji-exhibition-u8-r1/solve.css';
import './mobile-capture.css';
import { useRestore } from '../wuji-solve-u9-r1/use-restore';
import{SolveCapture}from'../wuji-solve-v1/Capture';
import{exportSession}from'../core/session';

type LearningStatus = "favorite" | "learning" | "mastered";
const LEARNING_PROGRESS_KEY = "axis.cfop-learning-progress.v1";
function loadLearningProgress(): Record<string, LearningStatus> {
  try {
    const raw = localStorage.getItem(LEARNING_PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LearningStatus>) : {};
  } catch {
    return {};
  }
}
function saveLearningProgress(next: Record<string, LearningStatus>) {
  try {
    localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}
function inverseMoveNotation(move: Move): string {
  if (move.turns === 2) return move.face + "2";
  return move.turns === 3 ? move.face : move.face + "′";
}

const EMPTY_STATUS: DemonstratorStatus = {
  ready: false,
  playing: false,
  completed: 0,
  active: 0,
  phase: "准备",
  instruction: "正在准备机械展台",
  finger: "",
};
const stages: CFOPStage[] = ["F2L", "OLL", "PLL"];
const stageNames = { F2L: "前两层", OLL: "顶面定向", PLL: "顶层换位" };
const restorePhaseNames:Record<string,string>={cross:"十字",f2l:"前两层",oll:"顶面定向",pll:"顶层换位"};
const showNotation = (text: string) => text.replaceAll("'", "′");

function useCompact() {
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width: 760px), (max-height: 520px) and (orientation: landscape)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 760px), (max-height: 520px) and (orientation: landscape)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

function Details({ formula }: { formula: FormulaRecord }) {
  return (
    <div className="cd-details">
      <div className="cd-detail-case">
        <CFOPDiagram example={formula.case} />
        <div>
          <span className="cd-kicker">{formula.case.sourceName}</span>
          <h2>{formula.case.name}</h2>
        </div>
      </div>
      <h3>识别情形</h3>
      <p>{formula.case.recognition}</p>
      <h3>起始拿法</h3>
      <p>{formula.case.orientation}</p>
      <h3>原表公式 · {formula.label}</h3>
      <p className="cd-original">{showNotation(formula.algorithm)}</p>
      <div className="cd-legend">
        <span className="cd-blue">蓝 · 左食指</span>
        <span className="cd-red">红 · 右拇指</span>
        <span className="cd-orange">橙 · 无名指</span>
      </div>
      <p className="cd-footnote">
        彩色字母保留原表指定手指，其余步骤结合前后握姿编排。动作组循环从该组开始前的局面重新演示。
      </p>
      <h3>完成后检查</h3>
      <p>{formula.case.check}</p>
      <h3>观察方式</h3>
      <p>
        默认近景围绕魔方、指尖末节和支撑手，M与背宽层采用相应的后侧取景，下宽层可切侧面近景，沿两层接缝看末节与释放。点视角按钮切换正面、侧面和背面；需要细看某一步时，可切侧面或复位当前视角。拖动和缩放可观察完整换握，手部透视用于辅助辨认遮挡。先对照识别图与拿法，再跟做。
      </p>
      <div className="cd-sources">
        {formula.sources.map((source, index) => (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            {source.title} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ExhibitionApp() {
  const { formula, retired, missing, personal } = useFormulaRoute();
  const { flow, state: restore } = useRestore(personal);
  const importFile = useRef<HTMLInputElement>(null);
  const recovery = restore.recovery;
  const motionFailed = personal && !restore.source && !!recovery && restore.motionFailed;
  const source=personal?restore.source:formula;
  const compact = useCompact();
  const stage = useRef<DemonstratorHandle>(null);
  useEffect(() => {
    if (restore.capturing) stage.current?.pause();
  }, [restore.capturing]);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [filter, setFilter] = useState<CFOPStage>(formula.case.stage);
  const [categoryFilter, setCategoryFilter] = useState<string>("全部");
  const [learningProgress, setLearningProgress] = useState<Record<string, LearningStatus>>(loadLearningProgress);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<"list" | "details" | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const preferenceChanges = useRef<Partial<typeof preferences>>({});
  const [preferenceWritable, setPreferenceWritable] = useState(false);
  const [preferenceNote, setPreferenceNote] = useState("");
  const [loopGroup, setLoopGroup] = useState<number | null>(null);
  const [loopMode, setLoopMode] = useState<StageLoopMode>("off");
  const [followMode, setFollowMode] = useState<StageFollowMode>("off");
  const [focusTarget, setFocusTarget] = useState(false);
  const [autoCamera, setAutoCamera] = useState(false);
  const [undoHint, setUndoHint] = useState("");
  const [view, setView] = useState<"solver" | "side" | "back">(()=>openingView(formula));
  const [routeNotice, setRouteNotice] = useState(
    retired
      ? "当前版本聚焦 CFOP 指法演示，原有记录已保留。"
      : missing
        ? "没有找到这个公式，已打开原表目录。"
        : "",
  );
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;
  const queryRef = useRef(query);
  queryRef.current = query;
  const total = source?.steps.length??0;
  const demonstrationAvailable = personal?!!restore.source:isDemonstrationAvailable(formula.id);
  const canOperate = demonstrationAvailable && status.ready;
  const currentGroup =
    source?.steps[Math.min(status.active, total - 1)]?.group ?? 0;
  const updateStatus = useCallback((value: DemonstratorStatus) => {
    setStatus(current => {
      if (value.playing && undoHint) setUndoHint("");
      return current.ready === value.ready &&
        current.playing === value.playing && current.completed === value.completed &&
        current.active === value.active && current.phase === value.phase &&
        current.stageCode === value.stageCode &&
        Math.abs((current.time ?? 0) - (value.time ?? 0)) < 0.01 &&
        current.duration === value.duration &&
        current.instruction === value.instruction && current.finger === value.finger &&
        current.error === value.error ? current : value;
    });
  }, [undoHint]);
  const categories = useMemo(
    () => [
      "全部",
      "★ 收藏",
      ...new Set(CFOP_CASES.filter((c) => c.stage === filter).map((c) => c.category)),
    ],
    [filter],
  );
  const filtered = CFOP_CASES.filter(
    (item) =>
      item.stage === filter &&
      (categoryFilter === "全部" ||
        (categoryFilter === "★ 收藏"
          ? !!learningProgress[item.id]
          : item.category === categoryFilter)) &&
      (!query.trim() ||
        `${item.stage} ${String(item.sourceNumber).padStart(2, "0")} ${item.sourceNumber} ${item.name} ${item.category} ${item.algorithm} ${item.recognition}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const cycleLearningStatus = (caseId: string) => {
    const current = learningProgress[caseId];
    const next: Record<string, LearningStatus> = { ...learningProgress };
    if (!current) next[caseId] = "favorite";
    else if (current === "favorite") next[caseId] = "learning";
    else if (current === "learning") next[caseId] = "mastered";
    else delete next[caseId];
    setLearningProgress(next);
    saveLearningProgress(next);
  };
  const explainableSubstages = useMemo(() => {
    if (!personal || !restore.source) return [];
    return buildExplainableSubstages(
      restore.source.states,
      restore.source.steps.map((s) => s.move),
      restore.source.session.phases,
      restore.source.palette,
    );
  }, [personal, restore.source]);
  const openDrawer = (kind: "list" | "details") => {
    opener.current = document.activeElement as HTMLElement;
    setDrawer(kind);
  };
  const choose = (item: CFOPCase, variant?: number) => {
    const selectedVariant = variant ?? getCaseFormulas(item.id).find(record => isDemonstrationAvailable(record.id))?.variant ?? 0;
    stage.current?.pause();
    setLoopGroup(null);
    setLoopMode("off");
    setUndoHint("");
    setDrawer(null);
    setRouteNotice("");
    if (formula.case.id !== item.id || formula.variant !== selectedVariant)
      navigate(formulaHref(item.id, selectedVariant));
  };

  useEffect(() => {
    let active = true;
    void readDemoPreferences()
      .then((value) => {
        if (!active) return;
        if (value) {
          const merged = { ...value, ...preferenceChanges.current };
          setPreferences(merged);
          setPreferenceWritable(true);
          if (Object.keys(preferenceChanges.current).length)
            void saveDemoPreferences(merged).catch(() => {
              if (active)
                setPreferenceNote("当前设置已生效，但未能保存到设备。");
            });
        } else
          setPreferenceNote(
            "已保存的偏好版本不同，本次设置仅在当前打开期间生效。",
          );
      })
      .catch(() => {
        if (active) setPreferenceNote("暂时无法读取偏好，本次仍可正常演示。");
      });
    return () => {
      active = false;
    };
  }, []);
  const savePreferences = (change: Partial<typeof preferences>) => {
    preferenceChanges.current = { ...preferenceChanges.current, ...change };
    const next = { ...preferences, ...change };
    setPreferences(next);
    if (preferenceWritable)
      void saveDemoPreferences(next).catch(() =>
        setPreferenceNote("当前设置已生效，但未能保存到设备。"),
      );
  };
  useEffect(() => {
    setLoopGroup(null);
    setDrawer(null);
    setFilter(formula.case.stage);
    const startView=openingView(formula);setView(startView);
    const selected = formula.case;
    const search = queryRef.current.trim().toLowerCase();
    if (search && !`${selected.stage} ${String(selected.sourceNumber).padStart(2, "0")} ${selected.sourceNumber} ${selected.name} ${selected.category} ${selected.algorithm} ${selected.recognition}`.toLowerCase().includes(search)) setQuery("");
    document.title = `${formula.case.stage} ${String(formula.case.sourceNumber).padStart(2, "0")} · CFOP 指法演示 · AXIS`;
  }, [formula]);
  useEffect(() => {
    if (retired || missing) navigate("/library", true);
  }, [retired, missing]);
  useEffect(() => {
    const subscriptions: (() => void)[] = [];
    let active = true;
    const keep = (unsubscribe: () => void) => {
      if (active) subscriptions.push(unsubscribe);
      else unsubscribe();
    };
    void subscribeToAppState((isActive) => {
      if (!isActive) stage.current?.pause();
    }).then(keep);
    void subscribeToAndroidBack(() => {
      if (drawerRef.current) setDrawer(null);
      else if (navigationDepth() > 0) history.back();
      else void minimizeAndroidApp();
    }).then(keep);
    return () => {
      active = false;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
  useEffect(() => {
    if (!drawer || (!compact && drawer === "list")) return;
    const frame = requestAnimationFrame(() =>
      dialog.current
        ?.querySelector<HTMLElement>('button, input, [tabindex="0"]')
        ?.focus(),
    );
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a, input, select, [tabindex="0"]',
        ),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keyboard);
      opener.current?.focus({ preventScroll: true });
    };
  }, [drawer, compact]);

  useEffect(()=>{stage.current?.pause();setLoopGroup(null);setLoopMode("off");setUndoHint("");setDrawer(null);if(!personal)flow.closeCapture();document.title=personal?'还原我的魔方 · AXIS':document.title;},[personal,flow]);
  const modeTo=(own:boolean)=>{stage.current?.pause();navigate(own?'/solve':formulaHref(formula.case.id,formula.variant));};
  const stepBackward = useCallback(() => {
    const prevIdx = Math.max(0, status.completed - 1);
    const undoneStep = source?.steps[prevIdx];
    if (undoneStep) {
      setUndoHint(`撤回第 ${prevIdx + 1} 步（${showNotation(undoneStep.move.notation)}）：实物魔方请反拧 ${inverseMoveNotation(undoneStep.move)}`);
    }
    stage.current?.seek(prevIdx);
  }, [status.completed, source]);
  const stepForward = useCallback(() => {
    setUndoHint("");
    stage.current?.seek(Math.min(total, status.completed + 1));
  }, [status.completed, total]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (drawer || restore.capturing) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) {
        if (event.key !== " " && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      }
      if (!canOperate) return;
      if (event.key === " ") {
        event.preventDefault();
        if (status.playing) stage.current?.pause();
        else stage.current?.play();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.shiftKey) {
          stage.current?.seekTime?.(Math.max(0, (status.time ?? 0) - 0.08));
        } else if (status.completed > 0) {
          stepBackward();
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) {
          stage.current?.seekTime?.(Math.min(status.duration ?? 0, (status.time ?? 0) + 0.08));
        } else if (status.completed < total) {
          stepForward();
        }
      } else if (event.key === "r" || event.key === "R") {
        stage.current?.resetView();
      } else if (event.key === "g" || event.key === "G") {
        savePreferences({ ghostHands: !preferences.ghostHands });
      } else if (event.key === "f" || event.key === "F") {
        setFocusTarget((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawer, restore.capturing, canOperate, status.playing, status.time, status.duration, status.completed, total, stepBackward, stepForward, preferences.ghostHands]);
  const activePalette = personal && restore.source ? restore.source.palette : DEFAULT_PALETTE;
  const orientationSummary = personal
    ? `持方：上[${COLOR_NAMES[activePalette.U]}] · 前[${COLOR_NAMES[activePalette.F]}] · 右[${COLOR_NAMES[activePalette.R]}]`
    : "持方：上[黄] · 前[蓝] · 右[红] · 底[白]";
  const currentCaseStatus = learningProgress[formula.case.id];
  const catalogue = (
    <>
      <div className="cd-library-title">
        <div>
          <span className="cd-kicker">FORMULA INDEX</span>
          <h2>选择情形</h2>
        </div>
        {compact && (
          <button
            className="cd-icon"
            onClick={() => setDrawer(null)}
            aria-label="关闭公式选择"
          >
            <X size={20} />
          </button>
        )}
      </div>
      <div className="cd-tabs" aria-label="CFOP 阶段">
        {stages.map((item) => (
          <button
            key={item}
            onClick={() => {
              setFilter(item);
              setCategoryFilter("全部");
              setQuery("");
            }}
            aria-pressed={filter === item}
          >
            <b>{item}</b>
            <span>{CFOP_CASES.filter((c) => c.stage === item).length}</span>
          </button>
        ))}
      </div>
      <div className="cd-category-chips" role="group" aria-label="子分类筛选">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`cd-chip ${categoryFilter === cat ? "is-active" : ""}`}
            aria-pressed={categoryFilter === cat}
            onClick={() => setCategoryFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <label className="cd-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="编号、情形或公式"
          aria-label="搜索公式"
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="清空搜索">
            <X size={15} />
          </button>
        )}
      </label>
      <div className="cd-list-caption">
        <span>{stageNames[filter]}{categoryFilter !== "全部" ? ` · ${categoryFilter}` : ""}</span>
        <span>{filtered.length} 个情形</span>
      </div>
      <div className="cd-case-list">
        {filtered.length ? (
          filtered.map((item) => {
            const mark = learningProgress[item.id];
            return (
              <button
                className={`cd-case ${formula.case.id === item.id ? "is-selected" : ""}`}
                key={item.id}
                onClick={() => choose(item)}
                aria-current={formula.case.id === item.id ? "true" : undefined}
                aria-label={`${item.stage} ${String(item.sourceNumber).padStart(2, "0")} ${item.name}`}
              >
                <CFOPDiagram example={item} />
                <span>
                  <small>
                    {item.stage} {String(item.sourceNumber).padStart(2, "0")}
                    {mark ? ` · ${mark === "favorite" ? "★ 收藏" : mark === "learning" ? "在练" : "✓ 已掌握"}` : ""}
                  </small>
                  <strong>{item.name}</strong>
                  <em className={getCaseFormulas(item.id).some(record => isDemonstrationAvailable(record.id)) ? "cd-availability-ready" : ""}>
                    {isDemonstrationAvailable(item.id) ? "指法演示可播放" : getCaseFormulas(item.id).some(record => isDemonstrationAvailable(record.id)) ? "替代式演示已开放" : "演示校准中"}
                    {item.alternateAlgorithms?.length ? " · 含替代公式" : ""}
                  </em>
                </span>
                <ChevronRight size={14} />
              </button>
            );
          })
        ) : (
          <p className="cd-empty">没有匹配的情形。试试切换分类或清空搜索。</p>
        )}
      </div>
      <div className="cd-library-footer">
        <span className="cd-status-dot" /> 119 情形 · {availableDemonstrationCount} 段演示
      </div>
    </>
  );

  return (
    <div className={`cd-app solve-app ${personal?"is-personal":""}`}>
      <header className="cd-header">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            choose(CFOP_CASES[0]);
          }}
          className="cd-brand"
          aria-label="AXIS 公式目录"
        >
          <span className="cd-brand-mark">A</span>
          <strong>AXIS</strong>
          <span>机械指法展台</span>
        </a>
        <nav className="solve-modes" aria-label="展台模式"><button aria-pressed={!personal} onClick={()=>modeTo(false)}>CFOP公式</button><button aria-pressed={personal} onClick={()=>modeTo(true)}>还原我的魔方</button></nav>
        <div className="cd-header-right">
          <span className="cd-desktop-label">看清接触。跟上每一步。</span>
          <button hidden={personal}
            className="cd-icon"
            aria-label="查看当前情形与拿法"
            onClick={() => openDrawer("details")}
          >
            <Info size={18} />
          </button>
        </div>
      </header>
      <div className="cd-workspace">
        {!compact && !personal && (
          <aside className="cd-sidebar" aria-label="公式目录">
            {catalogue}
          </aside>
        )}
        <main className="cd-main" aria-label="机械指法展台">
          {personal?<div className="cd-stage-top solve-heading"><div><span className="cd-kicker">YOUR CUBE / 本机处理</span><h1>还原我的魔方</h1></div><button className="cd-select-button" onClick={()=>{stage.current?.pause();flow.openCapture();}}>{recovery?'重新录入':'拍摄 / 导入六面'}</button><button className="cd-tool" onClick={()=>importFile.current?.click()}>导入局面</button><input ref={importFile} hidden type="file" accept=".json,application/json" aria-label="导入局面文件" onChange={e=>{const file=e.target.files?.[0];if(file){stage.current?.pause();void flow.importSession(file);}e.target.value='';}}/></div>:(
          <div className="cd-stage-top">
            <div>
              <span className="cd-kicker">
                {formula.case.stage} /{" "}
                {String(formula.case.sourceNumber).padStart(2, "0")}
              </span>
              <h1>{formula.case.name}</h1>
            </div>
            <button
              type="button"
              className={`cd-tool cd-bookmark-button ${currentCaseStatus ? "is-on" : ""}`}
              onClick={() => cycleLearningStatus(formula.case.id)}
              aria-label="标记当前情形学习状态"
            >
              {!currentCaseStatus ? "☆ 收藏" : currentCaseStatus === "favorite" ? "★ 已收藏" : currentCaseStatus === "learning" ? "● 在练" : "✓ 已掌握"}
            </button>
            <button
              className="cd-select-button"
              onClick={() => openDrawer("list")}
            >
              <Layers3 size={16} />
              <span>选择公式</span>
              <ChevronDown size={14} />
            </button>
            <button
              className="cd-holding-button"
              onClick={() => openDrawer("details")}
            >
              <CFOPDiagram example={formula.case} />
              <span>
                识别与拿法
                <ChevronRight size={12} />
              </span>
            </button>
          </div>
          )}
          <div className="cd-viewport">
            <TeachingStage
              ref={stage}
              formula={formula}
              personal={personal}
              restore={restore.source}
              onView={setView}
              speed={preferences.speed}
              ghostHands={preferences.ghostHands}
              loopGroup={loopGroup}
              loopMode={loopMode}
              followMode={followMode}
              focusTarget={focusTarget}
              autoCamera={autoCamera}
              onStatus={updateStatus}
            />
            <div className="cd-view-tools">
              <button
                className="cd-tool"
                aria-label="切换观察视角"
                onClick={() => {
                  const next =
                    view === "solver"
                      ? "side"
                      : view === "side"
                        ? "back"
                        : "solver";
                  setView(next);
                  stage.current?.setView(next);
                }}
              >
                <Eye size={16} />
                <span>
                  {view === "solver"
                    ? "持方视角"
                    : view === "side"
                      ? "侧面视角"
                      : "背面视角"}
                </span>
              </button>
              <button
                className={`cd-tool ${preferences.ghostHands ? "is-on" : ""}`}
                aria-pressed={preferences.ghostHands}
                onClick={() =>
                  savePreferences({ ghostHands: !preferences.ghostHands })
                }
              >
                手部透视
              </button>
              <button
                className={`cd-tool ${focusTarget ? "is-on" : ""}`}
                aria-pressed={focusTarget}
                onClick={() => setFocusTarget((v) => !v)}
              >
                聚焦目标
              </button>
              <button
                className={`cd-tool ${autoCamera ? "is-on" : ""}`}
                aria-pressed={autoCamera}
                onClick={() => setAutoCamera((v) => !v)}
              >
                智能跟拍
              </button>
              <button
                className="cd-icon"
                aria-label="复位视角"
                onClick={() => {
                  stage.current?.resetView();
                }}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            {!personal&&!demonstrationAvailable && <span className="cd-calibration-badge" role="status">演示校准中</span>}
            {(routeNotice || preferenceNote) && (
              <div className="cd-notice" role="status">
                {routeNotice || preferenceNote}
                <button
                  aria-label="收起提示"
                  onClick={() => {
                    setRouteNotice("");
                    setPreferenceNote("");
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {status.error && (
              <div className="cd-stage-error" role="alert">
                <p>{status.error}</p>
                <button onClick={() => openDrawer("details")}>
                  查看情形图和原表公式
                </button>
              </div>
            )}
            {personal && !restore.source && (
              <div className="solve-empty">
                {motionFailed && recovery ? (
                  <>
                    <h2>复原演示暂时无法显示</h2>
                    <p role="alert">局面、配色和解序已保留。可重试演示或下载局面。</p>
                    <div className="solve-recovery-actions">
                      <button className="cd-play" onClick={flow.retryMotion}>重试演示</button>
                      <button className="cd-tool" onClick={() => exportSession(recovery)}>下载局面</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="cd-kicker">从你手中的魔方开始</span>
                    <h2>录入六个面，看完整复原</h2>
                    <p>连续拍摄或导入照片，逐格核对后再计算。照片仅在本机处理。</p>
                    <button className="cd-play" onClick={flow.openCapture}>拍摄 / 导入六面</button>
                    <small>颜色草稿可保存在本机；刷新后需重新导入照片。</small>
                  </>
                )}
              </div>
            )}
            <span className="cd-stage-caption">
              {status.playing
                ? "MECHANICAL DEMONSTRATION"
                : "拖动观察 · 双指缩放"}
            </span>
            <span className="cd-orientation-pill" aria-label="实物魔方当前持方中心色">
              {orientationSummary}
            </span>
          </div>
          <section className="cd-player" aria-label="公式与播放控制">
            <div className="cd-player-heading">
              <span className="cd-kicker">{personal?"复原步骤":"原表公式"}</span>
              <div className="cd-variants">
                {!personal&&getCaseFormulas(formula.case.id).length > 1 &&
                  getCaseFormulas(formula.case.id).map((record) => (
                    <button
                      key={record.id}
                      aria-pressed={formula.id === record.id}
                      aria-label={`${record.label}，${isDemonstrationAvailable(record.id) ? "可播放" : "演示校准中"}`}
                      onClick={() => choose(record.case, record.variant)}
                    >
                      {record.variant === 0 ? "主公式" : `替代式 ${record.variant}`} · {isDemonstrationAvailable(record.id) ? "可播放" : "校准中"}
                    </button>
                  ))}
              </div>
              <span className="cd-counter">
                {(demonstrationAvailable ? status.completed : 0).toString().padStart(2, "0")}{" "}
                <i>/ {total.toString().padStart(2, "0")}</i>
              </span>
            </div>
            {personal?<div className="solve-sequence">{restore.source?<><div className="solve-phases">{restore.source.groups.filter(g=>g.end>g.start).map(g=><button key={g.index} disabled={!canOperate || (personal&&total===0)} aria-pressed={currentGroup===g.index} onClick={()=>{setLoopGroup(null);setUndoHint("");stage.current?.seek(g.start);}}>{restorePhaseNames[g.text]??g.text}</button>)}<button onClick={()=>exportSession(restore.source!.session)}>下载局面</button></div>{explainableSubstages.length > 0 && (<div className="solve-substages" aria-label="CFOP 子阶段分段拆解">{explainableSubstages.map(sub=>{const isActive=status.active>=sub.start&&status.active<sub.end;return(<div key={sub.id} className={`solve-substage-chip ${isActive?'is-active':''}`}><button type="button" className="solve-substage-jump" disabled={!canOperate} onClick={()=>{setLoopGroup(null);setUndoHint("");stage.current?.seek(sub.start);}}><b>{sub.title}</b><span>{sub.detail}</span></button>{sub.matchedCase&&(<button type="button" className="solve-substage-link" onClick={()=>{const matched=getCFOPCase(sub.matchedCase!.id);if(matched)choose(matched);}} aria-label={`对照标准库 ${sub.matchedCase.code}`}>标准库 {sub.matchedCase.code} ↗</button>)}</div>);})}</div>)}<div className="solve-tokens" aria-label="真实解序">{restore.source.steps.map((s,i)=><button key={i} disabled={!canOperate || (personal&&total===0)} aria-label={`定位到复原第 ${i+1} 个动作 ${showNotation(s.move.notation)} 前`} aria-current={status.active===i?'step':undefined} className={i<status.completed?'is-done':''} onClick={()=>{setLoopGroup(null);setUndoHint("");stage.current?.seek(i);}}>{showNotation(s.move.notation)}</button>)}</div>{total===0&&<p>输入局面已经还原，无需转层。</p>}</>:!motionFailed&&<p>录入 → 校正 → 核对 → 生成复原演示</p>}{restore.notice&&<p className="solve-record-note" role="status">{restore.notice}</p>}{restore.error&&!restore.capturing&&<p role="alert">{restore.error}</p>}</div>:<SourceAlgorithm
              formula={formula} active={status.active} completed={status.completed} loopGroup={loopGroup} playable={canOperate}
              onSeek={step=>{setLoopGroup(null);setUndoHint("");stage.current?.seek(step);}}/>}
            <div className="cd-current">
              <span
                className={`cd-phase-dot ${status.playing ? "is-playing" : ""}`}
              />
              <span className="cd-finger">
                {personal&&!restore.source?(motionFailed?"等待重试":"等待录入"):!demonstrationAvailable ? "资料预览" : status.completed === total
                  ? (personal?"复原完成":"本段完成")
                  : status.finger || "起始拿法"}
              </span>
              <p>
                {undoHint ? (
                  <span className="cd-undo-cue">{undoHint}</span>
                ) : personal&&!restore.source?(motionFailed?"当前解序可直接恢复。":"先录入并核对六面颜色。"):!demonstrationAvailable ? <>演示校准中，可先对照原表。 <button className="cd-inline-link" onClick={() => openDrawer("details")}>识别与拿法</button></> : status.completed === total
                  ? (personal?"六面已还原，可倒退到任一步重新观察。":"核对目标块与已完成部分，再从头跟做。")
                  : status.instruction}
              </p>
              <span className="cd-phase">{personal&&!restore.source?(motionFailed?"恢复":"录入"):demonstrationAvailable ? status.phase : "校准中"}</span>
            </div>
            <div className="cd-scrubber">
              <input
                type="range"
                className="cd-timeline-range"
                aria-label="动作时间轴进度"
                min={0}
                max={Math.max(0.01, status.duration ?? 0.01)}
                step={0.01}
                value={Math.min(status.time ?? 0, Math.max(0.01, status.duration ?? 0.01))}
                disabled={!canOperate || (personal && total === 0)}
                onChange={(event) => {
                  setUndoHint("");
                  stage.current?.seekTime?.(Number(event.target.value));
                }}
              />
              <span className="cd-scrubber-time">
                {(status.time ?? 0).toFixed(1)}s / {(status.duration ?? 0).toFixed(1)}s
              </span>
            </div>
            <div className="cd-controls">
              <div className="cd-transport">
                <button
                  className="cd-icon"
                  onClick={stepBackward}
                  disabled={!canOperate || status.completed === 0}
                  aria-label="上一步"
                >
                  <SkipBack size={19} />
                </button>
                <button
                  className="cd-play"
                  disabled={!canOperate || (personal&&total===0)}
                  aria-label={
                    personal&&!restore.source?(motionFailed?"复原演示不可用":"请先录入"):!demonstrationAvailable ? "演示校准中" : status.playing
                      ? "暂停演示"
                      : status.completed === total
                        ? "重新播放"
                        : "播放演示"
                  }
                  onClick={() => {
                    setUndoHint("");
                    if (status.playing) stage.current?.pause();
                    else stage.current?.play();
                  }}
                >
                  {status.playing ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" />
                  )}
                  <span>
                    {personal&&!restore.source?(motionFailed?"等待重试":"等待录入"):!demonstrationAvailable ? "校准中" : status.playing
                      ? "暂停"
                      : status.completed === total
                        ? "重播"
                        : "播放"}
                  </span>
                </button>
                <button
                  className="cd-icon"
                  onClick={stepForward}
                  disabled={!canOperate || status.completed === total}
                  aria-label="下一步"
                >
                  <SkipForward size={19} />
                </button>
              </div>
              <div className="cd-play-options">
                <label className="cd-speed">
                  <span>速度</span>
                  <select
                    aria-label="演示速度"
                    disabled={!demonstrationAvailable}
                    value={preferences.speed}
                    onChange={(event) =>
                      savePreferences({ speed: Number(event.target.value) })
                    }
                  >
                    <option value={1}>教学1×</option>
                    <option value={0.6}>慢放0.6×</option>
                    <option value={0.35}>细看0.35×</option>
                    <option value={2}>快速2×</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`cd-loop cd-follow-toggle ${followMode !== "off" ? "is-on" : ""}`}
                  disabled={!canOperate || (personal && total === 0)}
                  aria-pressed={followMode !== "off"}
                  aria-label="跟做自动停稳模式"
                  onClick={() =>
                    setFollowMode((cur) =>
                      cur === "off" ? "step" : cur === "step" ? "group" : "off",
                    )
                  }
                >
                  <span>
                    {followMode === "off"
                      ? "跟做:连续"
                      : followMode === "step"
                        ? "跟做:单步停"
                        : "跟做:按组停"}
                  </span>
                </button>
                <button
                  className={`cd-loop ${loopGroup !== null || loopMode !== "off" ? "is-on" : ""}`}
                  disabled={!canOperate || (personal&&total===0)}
                  aria-pressed={loopGroup !== null || loopMode !== "off"}
                  aria-label={
                    loopGroup !== null || loopMode !== "off" ? "切换或取消循环模式" : "循环当前动作组"
                  }
                  onClick={() => {
                    if (loopGroup === null && loopMode === "off") {
                      setLoopGroup(currentGroup);
                      setLoopMode("group");
                    } else if (loopMode === "group") {
                      setLoopGroup(null);
                      setLoopMode("step");
                    } else if (loopMode === "step") {
                      setLoopGroup(null);
                      setLoopMode("all");
                    } else {
                      setLoopGroup(null);
                      setLoopMode("off");
                    }
                  }}
                >
                  <Repeat2 size={18} />
                  <span>
                    {loopGroup !== null
                      ? `第 ${loopGroup + 1} 组`
                      : loopMode === "step"
                        ? "单步循环"
                        : loopMode === "all"
                          ? "整式循环"
                          : "循环组"}
                  </span>
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
      {!personal&&drawer && (compact || drawer === "details") && (
        <div className="cd-modal">
          <button
            className="cd-scrim"
            tabIndex={-1}
            onClick={() => setDrawer(null)}
            aria-label="关闭面板"
          />
          <div
            ref={dialog}
            className={`cd-drawer ${drawer === "details" ? "cd-info-drawer" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={drawer === "list" ? "选择公式" : "当前情形与拿法"}
          >
            {drawer === "list" ? (
              catalogue
            ) : (
              <>
                <div className="cd-drawer-heading">
                  <button
                    className="cd-icon"
                    aria-label="返回展台"
                    onClick={() => setDrawer(null)}
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <span>情形与拿法</span>
                  <button
                    className="cd-icon"
                    aria-label="关闭说明"
                    onClick={() => setDrawer(null)}
                  >
                    <X size={19} />
                  </button>
                </div>
                <Details formula={formula} />
              </>
            )}
          </div>
        </div>
      )}
      {personal&&restore.capturing&&<div className="solve-capture-modal" role="dialog" aria-modal="true" aria-label="录入我的魔方"><SolveCapture onImport={file=>flow.importSession(file)} onRestart={flow.inputChanged} onClose={flow.closeCapture} onChange={flow.inputChanged} onAccept={(state,palette)=>void flow.submit(state,palette)} busy={restore.busy} externalError={restore.error} onCancelSolve={flow.cancel}/></div>}
    </div>
  );
}
