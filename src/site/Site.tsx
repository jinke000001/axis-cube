import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Camera,
  Compass,
  Menu,
  X,
} from "lucide-react";
import { gsap } from "gsap";
import { ACADEMY_LESSONS as LESSONS } from "../learning/academy";
import { getCFOPCase } from "../learning/cfop-library";
import { MuseumProvider } from "../museum/MuseumProvider";
import { ALL_FINGER_STUDIES } from "../core/finger-studies";
import {
  minimizeAndroidApp,
  subscribeToAndroidBack,
  subscribeToAppState,
} from "../platform/lifecycle";
import { isNativeApp } from "../platform/runtime";
import {
  Home,
  CourseIndex,
  LessonPage,
  LoadingStage,
  PageHeading,
} from "./LearningPages";
import {
  LibraryIndex,
  FormulaDetail,
  FingerDetail,
  CFOPDetail,
} from "./LibraryPages";
import { HelpPage } from "./HelpPage";
import { Link } from "./Link";
import {
  navigate,
  navigationDepth,
  readRoute,
  routeHref,
  useRoute,
} from "./router";
import { useLearning } from "./useLearning";
import { useAcademy } from "./useAcademy";
import "./site.css";
const Workbench = lazy(() => import("../App"));

function Mark() {
  return (
    <span className="as-brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
export default function Site() {
  const route = useRoute(),
    learning = useLearning(),
    academy = useAcademy();
  const [systemReduced, setSystemReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reduced = learning.progress.reduceMotion || systemReduced;
  const [menu, setMenu] = useState(false);
  const initialRoute = useRef(true);
  const nativeStarted = useRef(false);
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  const main = useRef<HTMLDivElement>(null);
  const parts = route.split("/").filter(Boolean);
  const lesson =
    parts[0] === "learn"
      ? LESSONS.find((item) => item.id === parts[1])
      : undefined;
  const formulaLesson =
    parts[1] === "formulas"
      ? LESSONS.find((item) => item.id === parts[2])
      : undefined;
  const example = formulaLesson?.cases.find((item) => item.id === parts[3]);
  const finger =
    parts[1] === "fingers"
      ? ALL_FINGER_STUDIES.find((item) => item.id === parts[2])
      : undefined;
  const cfop = parts[1] === "cfop" ? getCFOPCase(parts[2]) : undefined;
  const studio = parts[0] === "studio" || route === "/solve";
  useEffect(() => {
    if (!isNativeApp() || nativeStarted.current || !learning.ready) return;
    nativeStarted.current = true;
    if (readRoute() === "/")
      navigate(
        LESSONS.some((item) => item.id === learning.progress.lastLesson)
          ? `/learn/${learning.progress.lastLesson}`
          : "/learn",
        true,
      );
  }, [learning.ready, learning.progress.lastLesson]);
  useEffect(() => {
    setMenu(false);
    const heading =
      lesson?.title ??
      cfop?.name ??
      finger?.name ??
      example?.title ??
      (
        {
          "/": "把每一步看清楚",
          "/learn": "互动课堂",
          "/library": "公式与指法",
          "/help": "学习说明",
          "/solve": "还原我的魔方",
          "/studio": "机械手演示",
        } as Record<string, string>
      )[route] ??
      "学习空间";
    document.title = `${heading} · AXIS`;
    window.scrollTo({ top: 0, behavior: "instant" });
    if (initialRoute.current) {
      initialRoute.current = false;
      return;
    }
    requestAnimationFrame(() =>
      main.current
        ?.querySelector<HTMLElement>("h1")
        ?.focus({ preventScroll: true }),
    );
  }, [route, lesson?.title, finger?.name, example?.title, cfop?.name]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    if (reduced || !main.current) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ".as-title-line",
        { yPercent: 26, clipPath: "inset(0 0 100% 0)", opacity: 0 },
        {
          yPercent: 0,
          clipPath: "inset(0 0 0% 0)",
          opacity: 1,
          stagger: 0.085,
          duration: 0.72,
          ease: "power3.out",
          clearProps: "transform,clipPath,opacity",
        },
      );
      gsap.fromTo(
        "[data-reveal]",
        { y: 12, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.65,
          stagger: 0.07,
          delay: 0.16,
          ease: "power2.out",
          clearProps: "transform,opacity",
        },
      );
    }, main);
    return () => context.revert();
  }, [route, reduced]);
  useEffect(() => {
    let active = true,
      cleanState: (() => void) | undefined,
      cleanBack: (() => void) | undefined;
    void subscribeToAppState((isActive) => {
      if (!isActive) window.dispatchEvent(new Event("axis:app-pause"));
    }).then((clean) => {
      if (active) cleanState = clean;
      else clean();
    });
    void subscribeToAndroidBack(() => {
      const dialog = document.querySelector("dialog[open]");
      if (dialog) {
        dialog.dispatchEvent(
          new Event("cancel", { bubbles: false, cancelable: true }),
        );
        return;
      }
      if (menuOpen.current) {
        setMenu(false);
        return;
      }
      if (navigationDepth() > 0) history.back();
      else if (readRoute() !== "/") navigate("/", true);
      else void minimizeAndroidApp();
    }).then((clean) => {
      if (active) cleanBack = clean;
      else clean();
    });
    return () => {
      active = false;
      cleanState?.();
      cleanBack?.();
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  let content;
  if (route === "/")
    content = <Home progress={learning.progress} reduceMotion={reduced} />;
  else if (route === "/learn")
    content = (
      <CourseIndex progress={learning.progress} academy={academy.progress} />
    );
  else if (lesson && parts.length === 2)
    content =
      learning.ready && academy.ready ? (
        <LessonPage
          key={lesson.id}
          lesson={lesson}
          progress={learning.progress.lessons[lesson.id]}
          reduceMotion={reduced}
          academy={academy}
          update={(patch) => learning.updateLesson(lesson.id, patch)}
        />
      ) : (
        <LoadingStage />
      );
  else if (route === "/library") content = <LibraryIndex />;
  else if (formulaLesson && example && parts.length === 4)
    content = (
      <FormulaDetail
        key={example.id}
        lesson={formulaLesson}
        example={example}
        reduceMotion={reduced}
      />
    );
  else if (cfop && parts.length === 3)
    content = (
      <CFOPDetail key={cfop.id} example={cfop} reduceMotion={reduced} />
    );
  else if (finger && parts.length === 3)
    content = (
      <FingerDetail key={finger.id} study={finger} reduceMotion={reduced} />
    );
  else if (route === "/help")
    content = (
      <HelpPage
        ready={learning.ready && academy.ready}
        reduceMotion={learning.progress.reduceMotion}
        setReduceMotion={learning.setReduceMotion}
        resetLearning={() => {
          learning.resetLearning();
          academy.reset();
        }}
      />
    );
  else if (!studio)
    content = (
      <div className="as-page as-not-found">
        <PageHeading
          eyebrow="A SMALL DETOUR"
          title="这条路还没有打开。"
          description="课程可能换了位置。回到学习路线，就能重新找到下一步。"
        />
        <Link to="/learn" className="as-button as-primary">
          查看课程
          <ArrowRight size={18} />
        </Link>
      </div>
    );
  return (
    <MuseumProvider route={route} reduceMotion={reduced}>
      <div
        className={`axis-site${reduced ? " as-reduce-motion" : ""}${studio ? " as-workbench-site" : ""}`}
      >
        <a
          className="as-skip"
          href={routeHref(route)}
          onClick={(event) => {
            event.preventDefault();
            main.current?.focus();
            main.current?.scrollIntoView();
          }}
        >
          跳到主要内容
        </a>
        <header className="as-header">
          <Link to="/" className="as-brand" aria-label="AXIS 首页">
            <Mark />
            <strong>
              AXIS<span>魔方机械展馆</span>
            </strong>
          </Link>
          <nav aria-label="网站导航" className={menu ? "is-open" : ""}>
            {[
              ["/", "展馆入口"],
              ["/learn", "互动课堂"],
              ["/library", "公式与指法"],
              ["/solve", "还原魔方"],
            ].map(([path, label], index) => (
              <Link
                key={path}
                to={path}
                aria-current={
                  (
                    path === "/"
                      ? route === "/"
                      : route.startsWith(path) || (path === "/solve" && studio)
                  )
                    ? "page"
                    : undefined
                }
              >
                <span className="as-nav-number">0{index}</span>
                {label}
              </Link>
            ))}
            <Link to="/help" className="as-nav-help">
              说明
              <ArrowUpRight size={13} />
            </Link>
          </nav>
          <Link
            to={`/learn/${learning.progress.lastLesson || LESSONS[0].id}`}
            className="as-header-continue"
          >
            {learning.progress.lastLesson ? "继续学习" : "进入课堂"}
            <ArrowUpRight size={15} />
          </Link>
          <button
            className="as-menu-toggle"
            aria-label={menu ? "关闭导航" : "打开导航"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={21} /> : <Menu size={21} />}
          </button>
        </header>
        {(learning.saveError || academy.saveError) && (
          <div className="as-storage-notice" role="status">
            {[learning.saveError, academy.saveError].filter(Boolean).join(" ")}
          </div>
        )}
        <div id="axis-main" ref={main} tabIndex={-1}>
          {studio ? (
            <div className="as-legacy">
              <Suspense fallback={<LoadingStage />}>
                <Workbench
                  key={route}
                  entry={route === "/solve" ? "capture" : "studio"}
                  studyId={parts[1]}
                  onHome={() => navigate("/")}
                />
              </Suspense>
            </div>
          ) : (
            <main>{content}</main>
          )}
        </div>
        {!studio && (
          <footer className="as-footer">
            <div>
              <Link to="/" className="as-brand">
                <Mark />
                <strong>AXIS</strong>
              </Link>
              <p>观察。理解。亲手完成。</p>
            </div>
            <nav aria-label="页脚导航">
              <Link to="/learn">互动课堂</Link>
              <Link to="/library">公式与指法</Link>
              <Link to="/help">说明与数据</Link>
              <Link to="/studio">
                机械工作台
                <ArrowUpRight size={13} />
              </Link>
            </nav>
            <span className="as-footer-note">
              THE MECHANICS OF UNDERSTANDING.
              <br />A SPACE FOR YOUR NEXT TURN.
            </span>
          </footer>
        )}
        <nav className="as-mobile-nav" aria-label="手机快捷导航">
          <Link to="/" aria-current={route === "/" ? "page" : undefined}>
            <Compass size={19} />
            展馆
          </Link>
          <Link
            to="/learn"
            aria-current={parts[0] === "learn" ? "page" : undefined}
          >
            <BookOpen size={18} />
            课堂
          </Link>
          <Link
            to="/library"
            aria-current={parts[0] === "library" ? "page" : undefined}
          >
            <Box size={18} />
            公式
          </Link>
          <Link to="/solve" aria-current={studio ? "page" : undefined}>
            <Camera size={19} />
            还原
          </Link>
        </nav>
      </div>
    </MuseumProvider>
  );
}
