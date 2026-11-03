export const PROGRESS_KEY = "axis.learning.v1";
export interface LessonProgress {
  caseId: string;
  step: number;
  checks: string[];
  completed: boolean;
  updatedAt: string;
}
export interface LearningProgress {
  version: 1;
  lastLesson: string;
  lessons: Record<string, LessonProgress>;
  reduceMotion: boolean;
  resetAt: string;
  preferencesUpdatedAt: string;
}
export const emptyProgress = (): LearningProgress => ({
  version: 1,
  lastLesson: "",
  lessons: {},
  reduceMotion: false,
  resetAt: "",
  preferencesUpdatedAt: "",
});
const idPattern = /^[a-z0-9-]{1,64}$/;
const timestamp = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : "";
export function canReadProgress(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const data = JSON.parse(raw);
    if (
      data?.version !== 1 ||
      !data.lessons ||
      typeof data.lessons !== "object" ||
      Array.isArray(data.lessons) ||
      Object.keys(data.lessons).length > 64
    )
      return false;
    // Earlier version-1 records omitted the two reset/preference timestamps.
    for (const key of ["resetAt", "preferencesUpdatedAt"])
      if (data[key] !== undefined && data[key] !== "" && !timestamp(data[key]))
        return false;
    return Object.entries(data.lessons).every(([id, value]) => {
      const item = value as Partial<LessonProgress>;
      return (
        idPattern.test(id) &&
        !!item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof item.caseId === "string" &&
        idPattern.test(item.caseId) &&
        Number.isInteger(item.step) &&
        item.step! >= 0 &&
        item.step! <= 1024 &&
        Array.isArray(item.checks) &&
        item.checks.length <= 20 &&
        item.checks.every(
          (check) => typeof check === "string" && check.length < 180,
        ) &&
        typeof item.completed === "boolean" &&
        (item.updatedAt === undefined ||
          item.updatedAt === "" ||
          !!timestamp(item.updatedAt))
      );
    });
  } catch {
    return false;
  }
}
export function parseProgress(raw: string | null): LearningProgress {
  if (!raw) return emptyProgress();
  try {
    const data = JSON.parse(raw);
    if (
      data?.version !== 1 ||
      !data.lessons ||
      typeof data.lessons !== "object" ||
      Array.isArray(data.lessons)
    )
      return emptyProgress();
    const lessons: LearningProgress["lessons"] = {};
    for (const [id, entry] of Object.entries(data.lessons).slice(0, 64)) {
      const item = entry as Partial<LessonProgress>;
      if (
        !idPattern.test(id) ||
        !item ||
        typeof item !== "object" ||
        typeof item.caseId !== "string" ||
        !idPattern.test(item.caseId)
      )
        continue;
      if (!Number.isInteger(item.step) || item.step! < 0 || item.step! > 1024)
        continue;
      lessons[id] = {
        caseId: item.caseId,
        step: item.step!,
        checks: Array.isArray(item.checks)
          ? item.checks
              .filter(
                (v): v is string => typeof v === "string" && v.length < 180,
              )
              .slice(0, 20)
          : [],
        completed: item.completed === true,
        updatedAt: timestamp(item.updatedAt),
      };
    }
    return {
      version: 1,
      lessons,
      lastLesson:
        typeof data.lastLesson === "string" && idPattern.test(data.lastLesson)
          ? data.lastLesson
          : "",
      reduceMotion: data.reduceMotion === true,
      resetAt: timestamp(data.resetAt),
      preferencesUpdatedAt: timestamp(data.preferencesUpdatedAt),
    };
  } catch {
    return emptyProgress();
  }
}
export function loadProgress(): LearningProgress {
  try {
    return parseProgress(localStorage.getItem(PROGRESS_KEY));
  } catch {
    return emptyProgress();
  }
}
export function nextProgressTimestamp(progress: LearningProgress): string {
  const dates = [
    progress.resetAt,
    progress.preferencesUpdatedAt,
    ...Object.values(progress.lessons).map((item) => item.updatedAt),
  ];
  return new Date(
    Math.max(Date.now(), ...dates.map((value) => (Date.parse(value) || 0) + 1)),
  ).toISOString();
}
export function mergeProgress(
  local: LearningProgress,
  backup: LearningProgress,
): LearningProgress {
  const resetAt =
    local.resetAt > backup.resetAt ? local.resetAt : backup.resetAt;
  const lessons: LearningProgress["lessons"] = {};
  for (const [id, item] of [
    ...Object.entries(backup.lessons),
    ...Object.entries(local.lessons),
  ]) {
    if (resetAt && item.updatedAt <= resetAt) continue;
    if (!lessons[id] || item.updatedAt >= lessons[id].updatedAt)
      lessons[id] = item;
  }
  const preference =
    backup.preferencesUpdatedAt > local.preferencesUpdatedAt ? backup : local;
  const lastLesson =
    Object.entries(lessons).sort((a, b) =>
      b[1].updatedAt.localeCompare(a[1].updatedAt),
    )[0]?.[0] ?? "";
  const reduceMotion =
    !local.preferencesUpdatedAt && !backup.preferencesUpdatedAt
      ? local.reduceMotion || backup.reduceMotion
      : preference.reduceMotion;
  return {
    version: 1,
    lessons,
    lastLesson,
    resetAt,
    reduceMotion,
    preferencesUpdatedAt: preference.preferencesUpdatedAt,
  };
}
export function persistProgress(progress: LearningProgress): boolean {
  try {
    // Preserve unreadable or newer records rather than silently replacing them.
    if (!canReadProgress(localStorage.getItem(PROGRESS_KEY))) return false;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
