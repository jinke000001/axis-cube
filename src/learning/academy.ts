import { LESSONS } from "./curriculum.ts";
import { F2L_LESSONS } from "./academy-data/f2l.ts";
import { TWO_LOOK_LESSONS } from "./academy-data/last-layer.ts";
import { buildActivities } from "./academy-data/activities.ts";
import type { CourseLesson } from "./types.ts";
import type { LearningTrack, LessonActivity } from "./academy-types.ts";

/** Original lesson ids and case records remain reachable; practice is versioned separately. */
export const ACADEMY_LESSONS: CourseLesson[] = [...LESSONS, ...F2L_LESSONS, ...TWO_LOOK_LESSONS];

export const LEARNING_TRACKS: LearningTrack[] = [
  { id:"first-solve", title:"首次还原", description:"从找一块开始，按阶段完成自己的第一次六面还原。", lessonIds:LESSONS.slice(0,11).map((lesson)=>lesson.id) },
  { id:"two-look-last-layer", title:"简化顶层", description:"入门后建议先学：把朝向与位置拆开，掌握两步 OLL 和两步 PLL。", lessonIds:["two-look-oll","two-look-pll"] },
  { id:"intuitive-f2l", title:"直观 F2L", description:"理解角棱与槽位，用六个单元从配对走到完整前两层。", lessonIds:F2L_LESSONS.map((lesson)=>lesson.id) },
  { id:"turning-supplement", title:"动作补充", description:"按需要练习转层节奏、握持衔接与原有 F2L 体验。", lessonIds:["smoother-turns"] },
];

const lessonsById = new Map(ACADEMY_LESSONS.map((lesson)=>[lesson.id,lesson]));
const activitiesByCase = new Map<string, LessonActivity[]>();

export function getAcademyLesson(id: string): CourseLesson | undefined {
  return lessonsById.get(id);
}

export function getLessonActivities(lessonId: string, caseId: string): LessonActivity[] {
  const lesson = lessonsById.get(lessonId);
  const item = lesson?.cases.find((candidate)=>candidate.id===caseId);
  if (!lesson || !item) return [];
  const key = `${lessonId}/${caseId}`;
  if (!activitiesByCase.has(key)) activitiesByCase.set(key,buildActivities(lesson,item));
  return activitiesByCase.get(key)!;
}

export { isChoiceActivity, isPickPieceActivity } from "./academy-types.ts";
export type { LessonActivity, ChoiceActivity, PickPieceActivity, LearningTrack } from "./academy-types.ts";

export const ACADEMY_SOURCES = [
  { title:"GAN 层先法教学", url:"https://www.gancube.com/pages/layer-by-layer-guide-of-gancube", role:"保留并互动化原有首次还原阶段" },
  { title:"CubeSkills — Intuitive F2L", url:"https://www.cubeskills.com/tutorials/f2l", role:"基础关系、核心情形、技巧与完整实例的课程组织" },
  { title:"J Perm — CFOP", url:"https://jperm.net/3x3/cfop", role:"两步顶层与直观 F2L 的进阶学习安排" },
  { title:"J Perm — 2-Look OLL", url:"https://jperm.net/algs/2look/oll", role:"3+7 算法及独立合法练习局面" },
  { title:"J Perm — 2-Look PLL", url:"https://jperm.net/algs/2look/pll", role:"2+4 算法及独立合法练习局面；Z 添加末尾顶层对齐" },
];
