import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Lightbulb,
  RotateCcw,
} from "lucide-react";
import { applyAlgorithm, COLOR_NAMES, SOLVED, type Face } from "../core/cube";
import {
  ACADEMY_LESSONS,
  LEARNING_TRACKS,
  getLessonActivities,
} from "../learning/academy";
import type { LessonActivity } from "../learning/academy-types";
import type { CourseLesson } from "../learning/types";
import type { LessonProgress } from "./progress";
import { practiceKey } from "./academy-progress";
import type { useAcademy } from "./useAcademy";
import { Link } from "./Link";
import { LoadingStage } from "./LearningPages";
import { canShowMechanicalHands } from "./motion-loader";
import { CubeThumbnail } from "./CubeThumbnail";
const MechanicalStage = lazy(() => import("./MechanicalStage"));
const LessonPlayer = lazy(() => import("../learning/LessonPlayer"));
type Academy = ReturnType<typeof useAcademy>;
const phases = [
  "认识目标",
  "找块判断",
  "看懂原理",
  "分段示范",
  "实物跟做",
  "陌生变式",
  "自检纠错",
];

export function LessonPage({
  lesson,
  progress,
  reduceMotion,
  update,
  academy,
}: {
  lesson: CourseLesson;
  progress?: LessonProgress;
  reduceMotion: boolean;
  update: (patch: Partial<LessonProgress>) => void;
  academy: Academy;
}) {
  const [caseId, setCaseId] = useState(() =>
    lesson.cases.some((item) => item.id === progress?.caseId)
      ? progress!.caseId
      : lesson.cases[0].id,
  );
  const [step, setStep] = useState(progress?.step ?? 0),
    [hands, setHands] = useState(false);
  const [phase, setPhase] = useState((progress?.step ?? 0) > 0 ? 3 : 0),
    [transfer, setTransfer] = useState(0);
  const [hint, setHint] = useState(false),
    [feedback, setFeedback] = useState<{
      passed: boolean;
      text: string;
    } | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const focusRef = useRef<HTMLDivElement>(null);
  const scrollRequested = useRef(false);
  const active =
    lesson.cases.find((item) => item.id === caseId) ?? lesson.cases[0];
  const activities = useMemo(
    () => getLessonActivities(lesson.id, active.id),
    [lesson.id, active.id],
  );
  const saved = academy.progress.cases[practiceKey(lesson.id, active.id)];
  const activity: LessonActivity | undefined =
    phase === 1
      ? activities[0]
      : phase === 5
        ? activities[transfer + 1]
        : undefined;
  const activityResult = activity ? saved?.answers[activity.id] : undefined;
  const revealed = !!feedback || !!activityResult || hint;
  const initialState = useMemo(
    () => applyAlgorithm(SOLVED, activity?.setup ?? active.setup),
    [activity?.setup, active.setup],
  );
  const algorithm = activity
    ? feedback || activityResult
      ? activity.algorithm
      : ""
    : active.algorithm;
  const handStudy = useMemo(
    () => ({
      id: active.id,
      name: active.title,
      algorithm: active.algorithm,
      description: active.when,
      focus: active.check,
    }),
    [active],
  );
  const handsAvailable = canShowMechanicalHands(active.algorithm);
  const segment =
    active.steps.find((item) => step <= item.end) ?? active.steps.at(-1);
  const allAnswers =
    activities.length >= 3 &&
    activities.every((item) => saved?.answers[item.id]?.passed);
  const complete = allAnswers && saved?.physicalChecked;
  const nextCase = lesson.cases[lesson.cases.indexOf(active) + 1];
  const learningOrder = LEARNING_TRACKS.flatMap((track) => track.lessonIds);
  const nextLesson = ACADEMY_LESSONS.find(
    (item) => item.id === learningOrder[learningOrder.indexOf(lesson.id) + 1],
  );
  const physicalChecks = [...new Set([active.check, ...lesson.checklist])];
  const checked = saved?.physicalChecked ? physicalChecks : checks;
  useEffect(() => {
    update({ caseId: active.id });
  }, [active.id]);
  function resetPrompt() {
    setHint(false);
    setFeedback(null);
    setHands(false);
  }
  useLayoutEffect(() => {
    if (!scrollRequested.current) return;
    scrollRequested.current = false;
    focusRef.current?.scrollIntoView({
      block: "start",
      behavior: reduceMotion ? "instant" : "smooth",
    });
  }, [phase, transfer, caseId, reduceMotion]);
  function choose(id: string) {
    scrollRequested.current = true;
    resetPrompt();
    setCaseId(id);
    setStep(0);
    setPhase(0);
    setTransfer(0);
    setChecks([]);
    update({ caseId: id, step: 0 });
  }
  function choosePhase(value: number, focus = true) {
    scrollRequested.current = focus;
    resetPrompt();
    setPhase(value);
    if (phase === value && focus) {
      scrollRequested.current = false;
      focusRef.current?.scrollIntoView({
        block: "start",
        behavior: reduceMotion ? "instant" : "smooth",
      });
    }
  }
  function chooseTransfer(value: number) {
    scrollRequested.current = true;
    resetPrompt();
    setTransfer(value);
  }
  function respond(value: string, passed: boolean, detail?: string) {
    if (!activity) return;
    academy.answer(lesson.id, active.id, activity.id, value, passed);
    setFeedback({
      passed,
      text: passed ? activity.explanation : detail || activity.hint,
    });
  }
  function pick(colors: Face[]) {
    if (activity?.mode !== "pick-piece") return;
    const passed =
      [...colors].sort().join("") ===
      [...activity.answerColors].sort().join("");
    respond(
      passed ? activity.answer : colors.join(""),
      passed,
      `你选了${colors.map((color) => COLOR_NAMES[color]).join("·")}块。${activity.hint}`,
    );
  }
  const correct = feedback?.passed ?? activityResult?.passed;
  const showPlayback =
    phase === 3 ||
    phase === 4 ||
    phase === 6 ||
    (!!activity && !!(feedback || activityResult));
  return (
    <div className="as-lesson-page">
      <div className="as-lesson-topline">
        <Link to="/learn">
          <ArrowLeft size={15} />
          学习路线
        </Link>
        <span>
          LESSON {String(lesson.number).padStart(2, "0")} /{" "}
          {ACADEMY_LESSONS.length}
        </span>
        <Link to="/library">
          公式参考
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="as-lesson-title">
        <span className="as-chapter-no">
          {String(lesson.number).padStart(2, "0")}
        </span>
        <div>
          <span className="as-eyebrow">{lesson.kicker}</span>
          <h1 tabIndex={-1}>
            <span className="as-title-line">{lesson.title}</span>
          </h1>
          <p>{lesson.goal}</p>
        </div>
      </div>
      {progress?.completed && (
        <p className="as-history-note">
          旧版完成记录已保留。下面的判断和变式会单独记录。
        </p>
      )}
      <div className="as-lesson-layout">
        <aside className="as-case-sidebar">
          <h2>观察眼前的情形</h2>
          <p>每种情形，都是一次完整练习。</p>
          <label className="as-mobile-case-select">
            <span>学习情形 · {lesson.cases.length} 种</span>
            <select
              value={active.id}
              aria-label="选择教学情形"
              onChange={(event) => choose(event.target.value)}
            >
              {lesson.cases.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {String(index + 1).padStart(2, "0")}　{item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="as-case-list">
            {lesson.cases.map((item, index) => {
              const record =
                academy.progress.cases[practiceKey(lesson.id, item.id)];
              const done =
                record?.physicalChecked &&
                getLessonActivities(lesson.id, item.id).every(
                  (a) => record.answers[a.id]?.passed,
                );
              return (
                <button
                  key={item.id}
                  aria-pressed={active.id === item.id}
                  className={active.id === item.id ? "is-active" : ""}
                  onClick={() => choose(item.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>{item.title}</span>
                  {done ? <Check size={15} /> : <ChevronRight size={15} />}
                </button>
              );
            })}
          </div>
          <div className="as-prepare">
            <h3>开始前</h3>
            {lesson.prepare.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        </aside>
        <section className="as-lesson-main" aria-label="互动课堂">
          <div className="as-case-heading">
            <span className="as-eyebrow">
              CASE {String(lesson.cases.indexOf(active) + 1).padStart(2, "0")} /{" "}
              {lesson.cases.length}
            </span>
            <h2>{active.title}</h2>
          </div>
          <nav className="as-lesson-phases" aria-label="本课学习步骤">
            {phases.map((label, index) => (
              <button
                key={label}
                aria-current={phase === index ? "step" : undefined}
                onClick={() => choosePhase(index)}
              >
                <span>0{index + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="as-learning-focus" aria-live="polite" ref={focusRef}>
            <span className="as-eyebrow">
              {activity
                ? activity.kind === "transfer"
                  ? `TRANSFER / 变式 ${transfer + 1}`
                  : "LOOK BEFORE YOU TURN"
                : `STEP 0${phase + 1} / ${phases[phase]}`}
            </span>
            <h3>
              {activity?.title ??
                (phase === 0
                  ? "这一步，要解决什么？"
                  : phase === 2
                    ? "为什么这样转？"
                    : phase === 3
                      ? "把动作拆成几组"
                      : phase === 4
                        ? "暂停屏幕，轮到你转"
                        : "把判断带回自己的魔方")}
            </h3>
            <p>
              {activity?.question ??
                (phase === 0
                  ? active.when
                  : phase === 2
                    ? active.explanation[0]
                    : phase === 3
                      ? "先按下面的拿法对齐。每完成一组，停下来确认目标块去了哪里。"
                      : phase === 4
                        ? lesson.practice
                        : "屏幕只能核对你的判断。请对照自己的魔方，逐项确认下面的结果。")}
            </p>
          </div>
          <div className="as-demonstration">
            {!activity && (
              <details className="as-orientation">
                <summary>
                  <span>拿法</span>
                  {active.orientation.split("。")[0]}。<span>＋</span>
                </summary>
                <p>{active.orientation}</p>
              </details>
            )}
            <div className="as-demo-mode">
              <span>
                {activity
                  ? activity.mode === "pick-piece"
                    ? "点选目标块，或使用下面的文字选项"
                    : "先观察局面，再选择答案"
                  : "同一局面 · 逐步观察"}
              </span>
              {!activity && showPlayback && handsAvailable && (
                <button aria-pressed={hands} onClick={() => setHands(!hands)}>
                  {hands ? "返回魔方近景" : "观察双手配合"}
                </button>
              )}
            </div>
            <div className="as-demo-viewport">
              <Suspense fallback={<LoadingStage />}>
                {hands && !activity ? (
                  <MechanicalStage
                    key={`${active.id}-hands`}
                    study={handStudy}
                    initialState={initialState}
                    initialStep={step}
                    onStepChange={(value) => {
                      setStep(value);
                      update({ caseId: active.id, step: value });
                    }}
                    reduceMotion={reduceMotion}
                    close
                  />
                ) : (
                  <LessonPlayer
                    key={`${active.id}-${activity?.id ?? "lesson"}-cube`}
                    initialState={initialState}
                    algorithm={algorithm}
                    focusFace={activity ? undefined : active.focusFace}
                    focusPieces={
                      activity
                        ? revealed
                          ? activity.focusPieces
                          : undefined
                        : active.focusPieces
                    }
                    focusLabel={
                      activity
                        ? revealed
                          ? "观察目标块的关系"
                          : undefined
                        : active.focusLabel
                    }
                    label={activity?.title ?? active.title}
                    initialStep={activity ? 0 : step}
                    reduceMotion={reduceMotion}
                    hideControls={!showPlayback}
                    onPiecePick={
                      activity?.mode === "pick-piece"
                        ? (colors) => pick(colors)
                        : undefined
                    }
                    onStepChange={
                      activity
                        ? undefined
                        : (value) => {
                            setStep(value);
                            update({ caseId: active.id, step: value });
                          }
                    }
                  />
                )}
              </Suspense>
            </div>
          </div>
          <div className="as-lesson-side">
            {phase === 5 && (
              <div className="as-transfer-tabs" aria-label="选择陌生变式">
                {activities.slice(1).map((item, index) => (
                  <button
                    key={item.id}
                    className={transfer === index ? "is-active" : ""}
                    aria-pressed={transfer === index}
                    onClick={() => chooseTransfer(index)}
                  >
                    变式 {index + 1}
                    {saved?.answers[item.id]?.passed && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
            {activity ? (
              <section className="as-activity" aria-label="判断练习">
                <div className="as-answer-options">
                  {activity.options.map((option, index) => (
                    <button
                      key={option.id}
                      className={
                        activityResult?.answer === option.id
                          ? correct
                            ? "is-correct"
                            : "is-incorrect"
                          : ""
                      }
                      onClick={() =>
                        respond(
                          option.id,
                          option.id === activity.answer,
                          option.explanation,
                        )
                      }
                    >
                      <span className="as-option-key">
                        {String.fromCharCode(65 + index)}
                      </span>
                      {option.setup && (
                        <CubeThumbnail
                          state={applyAlgorithm(SOLVED, option.setup)}
                          label={option.label}
                        />
                      )}
                      <span>{option.label}</span>
                      {activityResult?.answer === option.id && correct && (
                        <Check size={17} />
                      )}
                    </button>
                  ))}
                </div>
                {(feedback || activityResult) && (
                  <div
                    className={`as-answer-feedback${correct ? " is-correct" : " is-incorrect"}`}
                    role="status"
                  >
                    <strong>
                      {correct ? "判断正确" : "先停一下，再看目标关系"}
                    </strong>
                    <p>
                      {feedback?.text ??
                        (activityResult?.passed
                          ? activity.explanation
                          : activity.hint)}
                    </p>
                  </div>
                )}
                <button
                  className="as-text-link"
                  onClick={() => setHint(!hint)}
                  aria-expanded={hint}
                >
                  <Lightbulb size={16} />
                  {hint ? "收起提示" : "给我一点提示"}
                </button>
                {hint && <p className="as-hint">{activity.hint}</p>}
              </section>
            ) : phase === 2 ? (
              <div className="as-explanation">
                {active.explanation.map((text, index) => (
                  <p key={index}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {text}
                  </p>
                ))}
              </div>
            ) : phase === 3 || phase === 4 ? (
              <>
                <div className="as-current-explanation" aria-live="polite">
                  <span>
                    {step === 0
                      ? "对齐拿法，再开始"
                      : (segment?.label ?? "检查结果")}
                  </span>
                  <p>
                    {step === 0
                      ? active.orientation
                      : (segment?.explanation ?? active.check)}
                  </p>
                </div>
                <div className="as-action-groups">
                  {active.steps.map((group, index) => (
                    <div
                      key={index}
                      className={
                        segment === group && step > 0 ? "is-active" : ""
                      }
                    >
                      <span>0{index + 1}</span>
                      <strong>{group.label}</strong>
                      <p>{group.explanation}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : phase === 6 ? (
              <section className="as-lesson-complete">
                <div className="as-practice-summary">
                  {activities.map((item) => (
                    <span
                      key={item.id}
                      className={
                        saved?.answers[item.id]?.passed ? "is-passed" : ""
                      }
                    >
                      <CheckCircle2 size={16} />
                      {item.kind === "transfer" ? item.title : "目标判断"}
                    </span>
                  ))}
                </div>
                <fieldset>
                  <legend>对照实物逐项检查，由你确认</legend>
                  {physicalChecks.map((text) => (
                    <label key={text}>
                      <input
                        type="checkbox"
                        checked={checked.includes(text)}
                        onChange={(event) => {
                          if (saved?.physicalChecked)
                            academy.confirmPhysical(
                              lesson.id,
                              active.id,
                              false,
                            );
                          setChecks(
                            event.target.checked
                              ? [...checked, text]
                              : checked.filter((item) => item !== text),
                          );
                        }}
                      />
                      <span>{text}</span>
                    </label>
                  ))}
                </fieldset>
                <button
                  className="as-button as-primary"
                  disabled={
                    !allAnswers ||
                    checked.length < physicalChecks.length ||
                    !!saved?.physicalChecked
                  }
                  onClick={() =>
                    academy.confirmPhysical(lesson.id, active.id, true)
                  }
                >
                  {complete ? "此情形练习已完成" : "我已核对实物"}
                  <Check size={18} />
                </button>
                {!allAnswers && (
                  <small>先完成目标判断和两个陌生变式，再记录这次练习。</small>
                )}
                {complete &&
                  (nextCase ? (
                    <button
                      className="as-button"
                      onClick={() => choose(nextCase.id)}
                    >
                      下一个情形：{nextCase.title}
                      <ArrowRight size={17} />
                    </button>
                  ) : nextLesson ? (
                    <Link className="as-button" to={`/learn/${nextLesson.id}`}>
                      下一课：{nextLesson.title}
                      <ArrowRight size={17} />
                    </Link>
                  ) : (
                    <Link className="as-button" to="/library">
                      探索完整公式库
                      <ArrowRight size={17} />
                    </Link>
                  ))}
              </section>
            ) : (
              <div className="as-result-check">
                <CheckCircle2 size={21} />
                <div>
                  <h3>完成后，你应该看到</h3>
                  <p>{active.check}</p>
                </div>
              </div>
            )}
          </div>
          <div className="as-phase-controls">
            <button
              className="as-text-link"
              disabled={phase === 0}
              onClick={() => choosePhase(phase - 1)}
            >
              <ArrowLeft size={16} />
              上一步
            </button>
            <span>
              {phase + 1} / {phases.length}
            </span>
            {phase < 6 && (
              <button
                className="as-button as-primary"
                onClick={() => {
                  if (phase === 5 && transfer === 0) chooseTransfer(1);
                  else choosePhase(phase + 1);
                }}
                disabled={!!activity && !correct}
              >
                {phase === 5 && transfer === 0
                  ? "试试另一个变式"
                  : phases[phase + 1]}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          <details className="as-prepare-mobile">
            <summary>
              开始前的准备<span>+</span>
            </summary>
            {lesson.prepare.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </details>
        </section>
      </div>
      <section className="as-lesson-bottom">
        <div className="as-pitfalls">
          <span className="as-eyebrow">IF YOUR CUBE LOOKS DIFFERENT</span>
          <h2>没对上，从哪里检查？</h2>
          {lesson.pitfalls.map((item) => (
            <details key={item.title}>
              <summary>
                {item.title}
                <span>+</span>
              </summary>
              <p>{item.body}</p>
            </details>
          ))}
          <p className="as-help-link">
            完全失去位置了？
            <Link to="/solve">
              用还原工具找回起点
              <ArrowUpRight size={14} />
            </Link>
          </p>
        </div>
        <div className="as-lesson-links">
          <span className="as-eyebrow">CONTINUE EXPLORING</span>
          <h2>把观察放回完整过程</h2>
          <p>
            识别局面、摆好方向，然后才是公式。每次换一个方位，重新判断角块和棱块的关系。
          </p>
          <Link to="/library" className="as-text-link">
            打开公式参考库
            <ArrowUpRight size={16} />
          </Link>
          <button
            className="as-text-link"
            onClick={() => {
              choosePhase(0, false);
              setStep(0);
              update({ step: 0 });
              window.scrollTo({
                top: 0,
                behavior: reduceMotion ? "instant" : "smooth",
              });
            }}
          >
            <RotateCcw size={15} />
            回到本情形的目标
          </button>
        </div>
      </section>
    </div>
  );
}
