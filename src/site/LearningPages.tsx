import { lazy, Suspense } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Compass,
} from "lucide-react";
import { ALL_FINGER_STUDIES } from "../core/finger-studies";
import {
  ACADEMY_LESSONS,
  LEARNING_TRACKS,
  getLessonActivities,
} from "../learning/academy";
import type { CourseLesson } from "../learning/types";
import type { LearningProgress } from "./progress";
import { practiceKey, type AcademyProgress } from "./academy-progress";
import { Link } from "./Link";
export { LessonPage } from "./InteractiveLesson";
const MechanicalStage = lazy(() => import("./MechanicalStage"));

export function LoadingStage() {
  return (
    <div className="as-loading" role="status">
      <span className="as-loading-mark" />
      正在准备展台<small>讲解和图示已可阅读</small>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="as-page-heading">
      <div className="as-eyebrow">{eyebrow}</div>
      <h1 tabIndex={-1}>
        <span className="as-title-line">{title}</span>
      </h1>
      <p data-reveal>{description}</p>
    </div>
  );
}
export function practicedCases(lesson: CourseLesson, academy: AcademyProgress) {
  return lesson.cases.filter((example) => {
    const saved = academy.cases[practiceKey(lesson.id, example.id)],
      activities = getLessonActivities(lesson.id, example.id);
    return (
      activities.length >= 3 &&
      saved?.physicalChecked &&
      activities.every((activity) => saved.answers[activity.id]?.passed)
    );
  }).length;
}
export function Home({
  progress,
  reduceMotion,
}: {
  progress: LearningProgress;
  reduceMotion: boolean;
}) {
  const next =
    ACADEMY_LESSONS.find((item) => item.id === progress.lastLesson) ??
    ACADEMY_LESSONS[0];
  return (
    <>
      <section className="as-home-hero">
        <div className="as-hero-copy">
          <div className="as-eyebrow">
            <i /> THE MECHANICS OF UNDERSTANDING
          </div>
          <h1 tabIndex={-1}>
            <span className="as-title-line">把每一步，</span>
            <span className="as-title-line as-title-accent">看清楚。</span>
          </h1>
          <p data-reveal>
            走进魔方的机械展馆。
            <br />
            从第一次还原，到理解每一次配对。
            <br />
            观察、判断，拿起你的魔方试一试。
          </p>
          <div className="as-hero-actions" data-reveal>
            <Link to={`/learn/${next.id}`} className="as-button as-primary">
              {progress.lastLesson ? "继续上次学习" : "开始第一次还原"}
              <ArrowUpRight size={18} />
            </Link>
            <Link to="/learn" className="as-text-link">
              探索课程
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="as-hero-note">
            <span>01 / 04</span>
            <span>
              入口展台
              <br />
              普通三阶魔方 · 无需注册
            </span>
          </div>
        </div>
        <div className="as-hero-visual">
          <div className="as-exhibit-index" aria-hidden="true">
            AXIS<span>THE CUBE ATELIER</span>
          </div>
          <Suspense fallback={<LoadingStage />}>
            <MechanicalStage
              study={ALL_FINGER_STUDIES[6]}
              reduceMotion={reduceMotion}
            />
          </Suspense>
          <div className="as-visual-caption">
            <span>
              <i /> 双手之间，看懂转动
            </span>
            <span>EXHIBIT 001 / LIVE</span>
          </div>
        </div>
      </section>
      <section className="as-station-nav" aria-label="选择展台">
        {[
          ["01", "/learn", "学习区", "从首次还原到简化 CFOP"],
          ["02", "/library", "公式区", "119 个 CFOP 情形与指法"],
          ["03", "/solve", "还原区", "录入你的魔方，找回下一步"],
        ].map(([number, path, title, description]) => (
          <Link to={path} key={path}>
            <span className="as-mono">{number}</span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
            <ArrowUpRight size={22} />
          </Link>
        ))}
      </section>
      <div className="as-home-divider">
        <span>OBSERVE / UNDERSTAND / TRY</span>
        <span>
          向下探索学习路线
          <ArrowDown size={14} />
        </span>
      </div>
      <section className="as-home-roadmap">
        <div className="as-section-intro">
          <div className="as-eyebrow">A CLEAR PATH THROUGH THE CUBE</div>
          <h2>
            先看懂关系，
            <br />
            再记住动作。
          </h2>
          <p>
            不用先背一整张公式表。每个情形都从找块开始，在新的局面里检验理解。
          </p>
          <Link to="/learn" className="as-text-link">
            浏览完整学习路线
            <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="as-path-list">
          {[
            [
              "01",
              "完成第一颗",
              "认识目标 → 分段跟做 → 独立还原",
              ACADEMY_LESSONS[0].id,
            ],
            [
              "02",
              "简化顶层",
              "10 套 OLL + 6 套 PLL，分两步完成顶层",
              "two-look-oll",
            ],
            [
              "03",
              "理解 F2L",
              "先理解角棱的关系，再处理变化与四个槽位",
              "f2l-foundations",
            ],
          ].map(([number, title, text, id]) => (
            <Link to={`/learn/${id}`} className="as-path-row" key={number}>
              <span className="as-mono">{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              <ArrowUpRight size={22} />
            </Link>
          ))}
        </div>
      </section>
      <section className="as-home-principle">
        <Compass size={30} strokeWidth={1} />
        <p>让公式成为你理解的动作。</p>
        <span>一颗普通魔方，一次清楚的观察。</span>
      </section>
    </>
  );
}
export function CourseIndex({
  progress,
  academy,
}: {
  progress: LearningProgress;
  academy: AcademyProgress;
}) {
  const practiced = ACADEMY_LESSONS.filter(
    (lesson) => practicedCases(lesson, academy) === lesson.cases.length,
  ).length;
  return (
    <div className="as-page">
      <PageHeading
        eyebrow="EXHIBIT 01 / THE LEARNING ATELIER"
        title="从看懂，到亲手完成。"
        description="先走完首次还原；接着学简化顶层，再系统理解 F2L。每节短课都有判断、两个变式和实物检查，也可以直接选择想探索的章节。"
      />
      <div className="as-course-summary">
        <span>
          新版练习<small>判断与变式通过，且已自行核对实物</small>
        </span>
        <div className="as-progress-track">
          <i
            style={{ width: `${(practiced / ACADEMY_LESSONS.length) * 100}%` }}
          />
        </div>
        <strong>
          {practiced}
          <span> / {ACADEMY_LESSONS.length}</span>
        </strong>
      </div>
      <nav className="as-track-jumps" aria-label="课程阶段">
        {LEARNING_TRACKS.map((track, index) => (
          <button
            key={track.id}
            onClick={() =>
              document
                .getElementById(`track-${track.id}`)
                ?.scrollIntoView({
                  block: "start",
                  behavior:
                    progress.reduceMotion ||
                    matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                })
            }
          >
            <span>0{index + 1}</span>
            {track.title}
            <ArrowDown size={13} />
          </button>
        ))}
      </nav>
      {LEARNING_TRACKS.map((track, index) => (
        <section className="as-track" id={`track-${track.id}`} key={track.id}>
          <div className="as-track-heading">
            <span className="as-mono">SECTION / 0{index + 1}</span>
            <h2>{track.title}</h2>
            <p>{track.description}</p>
          </div>
          <div className="as-course-list">
            {track.lessonIds.map((id) => {
              const lesson = ACADEMY_LESSONS.find((item) => item.id === id);
              if (!lesson) return null;
              const count = practicedCases(lesson, academy),
                done = count === lesson.cases.length,
                oldCompleted = progress.lessons[id]?.completed;
              return (
                <Link
                  to={`/learn/${lesson.id}`}
                  key={id}
                  className={`as-course-row${done ? " is-completed" : ""}`}
                >
                  <span className="as-course-number">
                    {String(lesson.number).padStart(2, "0")}
                  </span>
                  <div>
                    <span className="as-course-kicker">{lesson.kicker}</span>
                    <h3>{lesson.title}</h3>
                    <p>{lesson.summary}</p>
                  </div>
                  <span className="as-course-state">
                    {done ? (
                      <>
                        <CheckCircle2 size={17} />
                        练习已通过
                      </>
                    ) : count ? (
                      `${count} / ${lesson.cases.length} 情形已练习`
                    ) : oldCompleted ? (
                      "保留旧版完成记录"
                    ) : (
                      `${lesson.cases.length} 个学习情形`
                    )}
                  </span>
                  <ArrowUpRight size={21} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      <div className="as-soft-note">
        <strong>屏幕判断与实物还原，是两件事。</strong>
        <span>
          屏幕会核对你的判断；实物仍需要你亲自检查。旧版勾选记录会保留，不自动计为新版练习通过。
        </span>
      </div>
    </div>
  );
}
