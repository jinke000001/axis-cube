import { useCallback, useEffect, useRef, useState } from "react";
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
  type CFOPCase,
  type CFOPStage,
} from "../learning/cfop-library";
import { CFOPDiagram } from "../site/CFOPDiagram";
import { navigate, navigationDepth } from "../site/router";
import {
  minimizeAndroidApp,
  subscribeToAndroidBack,
  subscribeToAppState,
} from "../platform/lifecycle";
import { getCaseFormulas } from "./catalog";
import { availableDemonstrationCount, isDemonstrationAvailable } from "./availability";
import { formulaHref, useFormulaRoute } from "./routes";
import {
  DEFAULT_PREFERENCES,
  readDemoPreferences,
  saveDemoPreferences,
} from "./preferences";
import TeachingStage from "./TeachingStage";
import { SourceAlgorithm } from "./SourceAlgorithm";
import type {
  DemonstratorHandle,
  DemonstratorStatus,
  FormulaRecord,
} from "./types";
import "./demonstrator.css";

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
        默认视角与持方者同向。拖动展台改变视角，双指缩放；开启手部透视可以看清遮挡。返回起始步骤后，先对照情形图再跟做。
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

export default function DemonstratorApp() {
  const { formula, retired, missing } = useFormulaRoute();
  const compact = useCompact();
  const stage = useRef<DemonstratorHandle>(null);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [filter, setFilter] = useState<CFOPStage>(formula.case.stage);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<"list" | "details" | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const preferenceChanges = useRef<Partial<typeof preferences>>({});
  const [preferenceWritable, setPreferenceWritable] = useState(false);
  const [preferenceNote, setPreferenceNote] = useState("");
  const [loopGroup, setLoopGroup] = useState<number | null>(null);
  const [view, setView] = useState<"solver" | "side" | "back">("solver");
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
  const total = formula.steps.length;
  const demonstrationAvailable = isDemonstrationAvailable(formula.id);
  const canOperate = demonstrationAvailable && status.ready;
  const currentGroup =
    formula.steps[Math.min(status.active, total - 1)]?.group ?? 0;
  const updateStatus = useCallback((value: DemonstratorStatus) => {
    setStatus(current => current.ready === value.ready &&
      current.playing === value.playing && current.completed === value.completed &&
      current.active === value.active && current.phase === value.phase &&
      current.instruction === value.instruction && current.finger === value.finger &&
      current.error === value.error ? current : value);
  }, []);
  const filtered = CFOP_CASES.filter(
    (item) =>
      item.stage === filter &&
      (!query.trim() ||
        `${item.stage} ${String(item.sourceNumber).padStart(2, "0")} ${item.sourceNumber} ${item.name} ${item.category} ${item.algorithm} ${item.recognition}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const openDrawer = (kind: "list" | "details") => {
    opener.current = document.activeElement as HTMLElement;
    setDrawer(kind);
  };
  const choose = (item: CFOPCase, variant?: number) => {
    const selectedVariant = variant ?? getCaseFormulas(item.id).find(record => isDemonstrationAvailable(record.id))?.variant ?? 0;
    stage.current?.pause();
    setLoopGroup(null);
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
              setQuery("");
            }}
            aria-pressed={filter === item}
          >
            <b>{item}</b>
            <span>{CFOP_CASES.filter((c) => c.stage === item).length}</span>
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
        <span>{stageNames[filter]}</span>
        <span>{filtered.length} 个情形</span>
      </div>
      <div className="cd-case-list">
        {filtered.length ? (
          filtered.map((item) => (
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
                </small>
                <strong>{item.name}</strong>
                <em className={getCaseFormulas(item.id).some(record => isDemonstrationAvailable(record.id)) ? "cd-availability-ready" : ""}>
                  {isDemonstrationAvailable(item.id) ? "机械演示已开放" : getCaseFormulas(item.id).some(record => isDemonstrationAvailable(record.id)) ? "替代式演示已开放" : "演示校准中"}
                  {item.alternateAlgorithms?.length ? " · 含替代公式" : ""}
                </em>
              </span>
              <ChevronRight size={14} />
            </button>
          ))
        ) : (
          <p className="cd-empty">没有匹配的情形。试试编号或清空搜索。</p>
        )}
      </div>
      <div className="cd-library-footer">
        <span className="cd-status-dot" /> 119 情形资料 · {availableDemonstrationCount} 段演示已开放
      </div>
    </>
  );

  return (
    <div className="cd-app">
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
          <span>CFOP 指法演示</span>
        </a>
        <div className="cd-header-right">
          <span className="cd-desktop-label">看清接触。跟上每一步。</span>
          <button
            className="cd-icon"
            aria-label="查看当前情形与拿法"
            onClick={() => openDrawer("details")}
          >
            <Info size={18} />
          </button>
        </div>
      </header>
      <div className="cd-workspace">
        {!compact && (
          <aside className="cd-sidebar" aria-label="公式目录">
            {catalogue}
          </aside>
        )}
        <main className="cd-main" aria-label="机械指法展台">
          <div className="cd-stage-top">
            <div>
              <span className="cd-kicker">
                {formula.case.stage} /{" "}
                {String(formula.case.sourceNumber).padStart(2, "0")}
              </span>
              <h1>{formula.case.name}</h1>
            </div>
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
          <div className="cd-viewport">
            <TeachingStage
              ref={stage}
              formula={formula}
              speed={preferences.speed}
              ghostHands={preferences.ghostHands}
              loopGroup={loopGroup}
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
                className="cd-icon"
                aria-label="复位视角"
                onClick={() => {
                  setView("solver");
                  stage.current?.resetView();
                }}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            {!demonstrationAvailable && <span className="cd-calibration-badge" role="status">演示校准中</span>}
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
            <span className="cd-stage-caption">
              {status.playing
                ? "MECHANICAL DEMONSTRATION"
                : "拖动观察 · 双指缩放"}
            </span>
          </div>
          <section className="cd-player" aria-label="公式与播放控制">
            <div className="cd-player-heading">
              <span className="cd-kicker">原表公式</span>
              <div className="cd-variants">
                {getCaseFormulas(formula.case.id).length > 1 &&
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
            <SourceAlgorithm
              formula={formula}
              active={status.active}
              completed={status.completed}
              loopGroup={loopGroup}
              playable={canOperate}
              onSeek={(step) => {
                setLoopGroup(null);
                stage.current?.seek(step);
              }}
            />
            <div className="cd-current">
              <span
                className={`cd-phase-dot ${status.playing ? "is-playing" : ""}`}
              />
              <span className="cd-finger">
                {!demonstrationAvailable ? "资料预览" : status.completed === total
                  ? "本段完成"
                  : status.finger || "起始拿法"}
              </span>
              <p>
                {!demonstrationAvailable ? <>演示校准中，可先对照原表。 <button className="cd-inline-link" onClick={() => openDrawer("details")}>识别与拿法</button></> : status.completed === total
                  ? "核对目标块与已完成部分，再从头跟做。"
                  : status.instruction}
              </p>
              <span className="cd-phase">{demonstrationAvailable ? status.phase : "校准中"}</span>
            </div>
            <div className="cd-controls">
              <div className="cd-transport">
                <button
                  className="cd-icon"
                  onClick={() =>
                    stage.current?.seek(Math.max(0, status.completed - 1))
                  }
                  disabled={!canOperate || status.completed === 0}
                  aria-label="上一步"
                >
                  <SkipBack size={19} />
                </button>
                <button
                  className="cd-play"
                  disabled={!canOperate}
                  aria-label={
                    !demonstrationAvailable ? "演示校准中" : status.playing
                      ? "暂停演示"
                      : status.completed === total
                        ? "重新播放"
                        : "播放演示"
                  }
                  onClick={() => {
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
                    {!demonstrationAvailable ? "校准中" : status.playing
                      ? "暂停"
                      : status.completed === total
                        ? "重播"
                        : "播放"}
                  </span>
                </button>
                <button
                  className="cd-icon"
                  onClick={() =>
                    stage.current?.seek(Math.min(total, status.completed + 1))
                  }
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
                    <option value={1}>教学</option>
                    <option value={0.6}>慢放</option>
                    <option value={0.35}>细看</option>
                  </select>
                </label>
                <button
                  className={`cd-loop ${loopGroup !== null ? "is-on" : ""}`}
                  disabled={!canOperate}
                  aria-pressed={loopGroup !== null}
                  aria-label={
                    loopGroup !== null ? "取消动作组循环" : "循环当前动作组"
                  }
                  onClick={() =>
                    setLoopGroup(loopGroup === null ? currentGroup : null)
                  }
                >
                  <Repeat2 size={18} />
                  <span>
                    {loopGroup === null ? "循环组" : `第 ${loopGroup + 1} 组`}
                  </span>
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
      {drawer && (compact || drawer === "details") && (
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
    </div>
  );
}
