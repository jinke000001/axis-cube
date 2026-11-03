import { lazy, Suspense, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { applyAlgorithm, SOLVED } from "../core/cube";
import { ALL_FINGER_STUDIES, type FingerStudy } from "../core/finger-studies";
import { ACADEMY_LESSONS } from "../learning/academy";
import { CFOP_CASES, type CFOPCase } from "../learning/cfop-library";
import type { CourseLesson, LessonCase } from "../learning/types";
import { Link } from "./Link";
import { LoadingStage, PageHeading } from "./LearningPages";
import { CubeThumbnail } from "./CubeThumbnail";
import { CFOPDiagram } from "./CFOPDiagram";
import { canShowMechanicalHands } from "./motion-loader";
const MechanicalStage = lazy(() => import("./MechanicalStage"));
const LessonPlayer = lazy(() => import("../learning/LessonPlayer"));
const formulas = ACADEMY_LESSONS.flatMap((lesson) =>
  lesson.cases.map((example) => ({ lesson, example })),
);
type LibraryFilter = "all" | "F2L" | "OLL" | "PLL" | "lessons" | "fingers";

export function LibraryIndex() {
  const [filter, setFilter] = useState<LibraryFilter>("all"),
    [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(search);
  const cases = CFOP_CASES.filter(
    (item) =>
      (filter === "all" || filter === item.stage) &&
      matches(
        `${item.stage} ${item.sourceName} ${item.sourceNumber} ${item.name} ${item.category} ${item.recognition} ${item.algorithm}`,
      ),
  );
  const courseCases =
    filter === "lessons"
      ? formulas.filter(({ lesson, example }) =>
          matches(
            `${lesson.title} ${example.title} ${example.when} ${example.algorithm}`,
          ),
        )
      : [];
  const fingers =
    filter === "fingers"
      ? ALL_FINGER_STUDIES.filter((item) =>
          matches(`${item.name} ${item.algorithm} ${item.description}`),
        )
      : [];
  return (
    <div className="as-page">
      <PageHeading
        eyebrow="EXHIBIT 02 / THE ALGORITHM ARCHIVE"
        title="每个情形，都有来由。"
        description="完整保留 GAN 原表的 41 个 F2L、57 个 OLL、21 个 PLL 编号。先认图、摆方向，再看公式怎样改变局面。它是随时查阅的资料库，不是新手的背诵清单。"
      />
      <div className="as-library-tools">
        <div className="as-tabs" aria-label="内容类型">
          {(
            [
              ["all", "全部 119"],
              ["F2L", "F2L · 41"],
              ["OLL", "OLL · 57"],
              ["PLL", "PLL · 21"],
              ["lessons", "课程示范"],
              ["fingers", "双手指法"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "is-active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="as-search">
          <Search size={17} />
          <input
            aria-label="搜索公式或指法"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索情形、原表编号、公式…"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="清空搜索">
              ×
            </button>
          )}
        </label>
      </div>
      {(["F2L", "OLL", "PLL"] as const).map((stage) => {
        const items = cases.filter((item) => item.stage === stage);
        if (!items.length) return null;
        return (
          <section className="as-library-section" key={stage}>
            <div className="as-section-heading">
              <div>
                <span className="as-eyebrow">
                  {stage === "F2L"
                    ? "PAIR & INSERT"
                    : stage === "OLL"
                      ? "ORIENT THE LAST LAYER"
                      : "PERMUTE THE LAST LAYER"}
                </span>
                <h2>
                  {stage}{" "}
                  <span>
                    {stage === "F2L"
                      ? "前两层配对"
                      : stage === "OLL"
                        ? "顶面朝向"
                        : "顶层换位"}
                  </span>
                </h2>
              </div>
              <span>{items.length} 个情形</span>
            </div>
            <div className="as-cfop-grid">
              {items.map((example) => (
                <Link
                  to={`/library/cfop/${example.id}`}
                  className="as-cfop-card"
                  key={example.id}
                >
                  <div className="as-cfop-card-top">
                    <span>
                      {stage} / {String(example.sourceNumber).padStart(2, "0")}
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                  <CFOPDiagram example={example} />
                  <h3>{example.name}</h3>
                  <span className="as-cfop-source">
                    GAN 原表编号 ·{" "}
                    {String(example.sourceNumber).padStart(2, "0")}
                  </span>
                  <code>{example.algorithm.replaceAll("'", "′")}</code>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {courseCases.length > 0 && (
        <section className="as-library-section">
          <div className="as-section-heading">
            <h2>课堂里的示范</h2>
            <span>{courseCases.length} 个情形</span>
          </div>
          <div className="as-formula-list">
            {courseCases.map(({ lesson, example }) => (
              <Link
                key={`${lesson.id}-${example.id}`}
                to={`/library/formulas/${lesson.id}/${example.id}`}
                className="as-formula-row"
              >
                <CubeThumbnail
                  state={applyAlgorithm(SOLVED, example.setup)}
                  label={`${example.title}的起始局面`}
                />
                <span className="as-formula-chapter">
                  {String(lesson.number).padStart(2, "0")}
                  <small>{lesson.title}</small>
                </span>
                <div>
                  <h3>{example.title}</h3>
                  <p>{example.when}</p>
                </div>
                <code>{example.algorithm.replaceAll("'", "′")}</code>
                <ArrowUpRight size={19} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {fingers.length > 0 && (
        <section className="as-library-section">
          <div className="as-section-heading">
            <h2>双手动作研究</h2>
            <span>{fingers.length} 段指法</span>
          </div>
          <p className="as-section-description">
            观察拨层与承托的配合。机械手的形态与人手不同，先看清转动方向，再用舒服的握姿练习。
          </p>
          <div className="as-finger-grid">
            {fingers.map((study, index) => (
              <Link
                key={study.id}
                to={`/library/fingers/${study.id}`}
                className="as-finger-card"
              >
                <div>
                  <span className="as-eyebrow">
                    MOTION / {String(index + 1).padStart(2, "0")}
                  </span>
                  <ArrowUpRight size={20} />
                </div>
                <code>{study.algorithm.replaceAll("'", "′")}</code>
                <h3>{study.name}</h3>
                <p>{study.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
      {!cases.length && !courseCases.length && !fingers.length && (
        <div className="as-empty">
          <h2>没有找到“{query}”</h2>
          <p>可以用 F2L、白色朝上、顶棱或 PLL 名称查询。</p>
          <button
            className="as-button"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            查看全部情形
            <ArrowRight size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

export function CFOPDetail({
  example,
  reduceMotion,
}: {
  example: CFOPCase;
  reduceMotion: boolean;
}) {
  const initialState = useMemo(
    () => applyAlgorithm(SOLVED, example.setup),
    [example],
  );
  const [hands, setHands] = useState(false),
    [step, setStep] = useState(0);
  const study = useMemo(
    () => ({
      id: example.id,
      name: example.name,
      algorithm: example.algorithm,
      description: example.recognition,
      focus: example.check,
    }),
    [example],
  );
  const available = canShowMechanicalHands(example.algorithm);
  const current = CFOP_CASES.indexOf(example),
    next = CFOP_CASES[current + 1];
  return (
    <div className="as-page as-detail-page">
      <Link to="/library" className="as-back-link">
        <ArrowLeft size={16} />
        公式参考库
      </Link>
      <PageHeading
        eyebrow={`${example.sourceName} / ${example.category}`}
        title={example.name}
        description={example.recognition}
      />
      <div className="as-detail-layout">
        <section>
          <div className="as-hold-note">
            <span>先这样拿</span>
            <p>{example.orientation}</p>
          </div>
          <div className="as-demo-mode">
            <span>已完成 {step} 步 · 切换视图保留步骤</span>
            {available && (
              <button aria-pressed={hands} onClick={() => setHands(!hands)}>
                {hands ? "返回魔方近景" : "观察双手配合"}
              </button>
            )}
          </div>
          <Suspense fallback={<LoadingStage />}>
            {hands ? (
              <MechanicalStage
                study={study}
                initialState={initialState}
                initialStep={step}
                onStepChange={setStep}
                reduceMotion={reduceMotion}
                close
              />
            ) : (
              <LessonPlayer
                initialState={initialState}
                algorithm={example.algorithm}
                label={example.name}
                initialStep={step}
                onStepChange={setStep}
                reduceMotion={reduceMotion}
              />
            )}
          </Suspense>
        </section>
        <div className="as-detail-notes">
          <div className="as-recognition-panel">
            <CFOPDiagram example={example} />
            <div>
              <span className="as-eyebrow">RECOGNITION / 识别</span>
              <strong>{example.sourceName}</strong>
              <p>
                {example.stage === "F2L"
                  ? "灰色贴片无需匹配，只追踪目标角棱。"
                  : example.stage === "OLL"
                    ? "同时看顶面与四周黄色侧条。"
                    : "箭头表示每个块要去的位置。"}
              </p>
            </div>
          </div>
          <h2>分组记住这段动作</h2>
          <code className="as-large-formula">
            {example.algorithm.replaceAll("'", "′")}
          </code>
          {example.alternateAlgorithms?.length ? (
            <details className="as-alternatives">
              <summary>原表中的另一种转法</summary>
              {example.alternateAlgorithms.map((algorithm) => (
                <code key={algorithm}>{algorithm.replaceAll("'", "′")}</code>
              ))}
              <p>当前展台播放上方主公式；替代转法用于对照。</p>
            </details>
          ) : null}
          <div className="as-result-check">
            <div>
              <h3>转完后，检查这些地方</h3>
              <p>{example.check}</p>
            </div>
          </div>
          <Link
            className="as-button as-primary"
            to={`/learn/${example.lessonId}`}
          >
            在完整课程里理解
            <ArrowRight size={17} />
          </Link>
          <p className="as-source-note">
            编号沿用原表，不代表其他教程采用相同编号。
            <a href={example.sourceUrl} target="_blank" rel="noreferrer">
              查看方法来源
              <ArrowUpRight size={12} />
            </a>
          </p>
          {next && (
            <Link className="as-text-link" to={`/library/cfop/${next.id}`}>
              下一个：{next.sourceName}
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
export function FormulaDetail({
  lesson,
  example,
  reduceMotion,
}: {
  lesson: CourseLesson;
  example: LessonCase;
  reduceMotion: boolean;
}) {
  const initialState = useMemo(
    () => applyAlgorithm(SOLVED, example.setup),
    [example],
  );
  return (
    <div className="as-page as-detail-page">
      <Link to="/library" className="as-back-link">
        <ArrowLeft size={16} />
        公式与指法
      </Link>
      <PageHeading
        eyebrow={`LESSON ${String(lesson.number).padStart(2, "0")} / ${lesson.title}`}
        title={example.title}
        description={example.when}
      />
      <div className="as-detail-layout">
        <section>
          <div className="as-hold-note">
            <span>先这样拿</span>
            <p>{example.orientation}</p>
          </div>
          <Suspense fallback={<LoadingStage />}>
            <LessonPlayer
              initialState={initialState}
              algorithm={example.algorithm}
              focusFace={example.focusFace}
              focusPieces={example.focusPieces}
              focusLabel={example.focusLabel}
              label={example.title}
              reduceMotion={reduceMotion}
            />
          </Suspense>
        </section>
        <div className="as-detail-notes">
          <h2>什么时候使用</h2>
          {example.explanation.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <div className="as-result-check">
            <div>
              <h3>完成后检查</h3>
              <p>{example.check}</p>
            </div>
          </div>
          <Link className="as-button as-primary" to={`/learn/${lesson.id}`}>
            回到互动课堂
            <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </div>
  );
}
export function FingerDetail({
  study,
  reduceMotion = false,
}: {
  study: FingerStudy;
  reduceMotion?: boolean;
}) {
  return (
    <div className="as-page as-detail-page">
      <Link to="/library" className="as-back-link">
        <ArrowLeft size={16} />
        公式与指法
      </Link>
      <PageHeading
        eyebrow="DUAL-HAND MOTION STUDY"
        title={study.name}
        description={study.description}
      />
      <div className="as-detail-layout">
        <div className="as-finger-stage">
          <Suspense fallback={<LoadingStage />}>
            <MechanicalStage study={study} reduceMotion={reduceMotion} close />
          </Suspense>
        </div>
        <div className="as-detail-notes">
          <span className="as-eyebrow">WATCH THE HANDOFF</span>
          <code className="as-large-formula">
            {study.algorithm.replaceAll("'", "′")}
          </code>
          <h2>留意两只手的交接</h2>
          <p>{study.focus}。</p>
          <p>
            先看主动手指，再看另一只手怎样承托。暂停后可以拖动视角，也可以透视手部，观察接触位置。
          </p>
          <div className="as-soft-note">
            <strong>从观察，到自己的手</strong>
            <span>机械演示用于理解转层与协作。慢慢转，保持舒服的握姿。</span>
          </div>
          <Link className="as-button as-primary" to={`/studio/${study.id}`}>
            进入机械工作台
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/learn/f2l-foundations" className="as-text-link">
            理解角棱与槽位
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
