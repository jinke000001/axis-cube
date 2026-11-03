/** Exercise results are separate from the original self-reported lesson history. */
export const ACADEMY_PROGRESS_KEY = "axis.academy.v1";
export const ACTIVITY_REVISION = 1;
export interface ActivityResult {
  answer: string;
  passed: boolean;
  attempts: number;
  updatedAt: string;
}
export interface CasePractice {
  revision: number;
  answers: Record<string, ActivityResult>;
  physicalChecked: boolean;
  physicalUpdatedAt: string;
}
export interface AcademyProgress {
  version: 1;
  cases: Record<string, CasePractice>;
  resetAt: string;
}
export const emptyAcademyProgress = (): AcademyProgress => ({
  version: 1,
  cases: {},
  resetAt: "",
});
export const practiceKey = (lessonId: string, caseId: string) =>
  `${lessonId}/${caseId}`;
// Activity IDs are namespaced as lesson/case/activity by the content catalogue.
const validId = /^[a-z0-9-]{1,96}(?:\/[a-z0-9-]{1,96}){0,2}$/;
const validKey = /^[a-z0-9-]{1,64}\/[a-z0-9-]{1,96}$/;
const date = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : "";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function canReadAcademy(raw: string | null) {
  if (!raw) return true;
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      !object(value.cases) ||
      Object.keys(value.cases).length > 500
    )
      return false;
    if (value.resetAt !== "" && !date(value.resetAt)) return false;
    return Object.entries(value.cases).every(([key, item]) => {
      if (
        !validKey.test(key) ||
        !object(item) ||
        item.revision !== ACTIVITY_REVISION ||
        !object(item.answers)
      )
        return false;
      if (
        typeof item.physicalChecked !== "boolean" ||
        (item.physicalUpdatedAt !== "" && !date(item.physicalUpdatedAt))
      )
        return false;
      if (Object.keys(item.answers).length > 20) return false;
      return Object.entries(item.answers).every(
        ([id, result]) =>
          validId.test(id) &&
          object(result) &&
          typeof result.answer === "string" &&
          result.answer.length <= 160 &&
          typeof result.passed === "boolean" &&
          Number.isInteger(result.attempts) &&
          Number(result.attempts) >= 1 &&
          Number(result.attempts) <= 10000 &&
          !!date(result.updatedAt),
      );
    });
  } catch {
    return false;
  }
}
export function parseAcademyProgress(raw: string | null): AcademyProgress {
  const empty = emptyAcademyProgress();
  if (!raw || !canReadAcademy(raw)) return empty;
  const value = JSON.parse(raw);
  empty.resetAt = date(value.resetAt);
  for (const [key, item] of Object.entries(value.cases).slice(0, 500)) {
    if (
      !validKey.test(key) ||
      !object(item) ||
      !object(item.answers) ||
      item.revision !== ACTIVITY_REVISION
    )
      continue;
    const answers: CasePractice["answers"] = {};
    for (const [id, answer] of Object.entries(item.answers).slice(0, 20)) {
      if (
        !validId.test(id) ||
        !object(answer) ||
        typeof answer.answer !== "string" ||
        answer.answer.length > 160 ||
        !date(answer.updatedAt)
      )
        continue;
      if (empty.resetAt && String(answer.updatedAt) <= empty.resetAt) continue;
      answers[id] = {
        answer: answer.answer,
        passed: answer.passed === true,
        attempts: Math.min(
          10000,
          Math.max(1, Math.floor(Number(answer.attempts) || 1)),
        ),
        updatedAt: String(answer.updatedAt),
      };
    }
    const physicalUpdatedAt = date(item.physicalUpdatedAt);
    empty.cases[key] = {
      revision: ACTIVITY_REVISION,
      answers,
      physicalChecked:
        item.physicalChecked === true && physicalUpdatedAt > empty.resetAt,
      physicalUpdatedAt:
        physicalUpdatedAt > empty.resetAt ? physicalUpdatedAt : "",
    };
  }
  return empty;
}
export function nextAcademyTimestamp(progress: AcademyProgress): string {
  const all = [
    progress.resetAt,
    ...Object.values(progress.cases).flatMap((item) => [
      item.physicalUpdatedAt,
      ...Object.values(item.answers).map((result) => result.updatedAt),
    ]),
  ];
  return new Date(
    Math.max(Date.now(), ...all.map((value) => (Date.parse(value) || 0) + 1)),
  ).toISOString();
}
export function mergeAcademyProgress(
  local: AcademyProgress,
  backup: AcademyProgress,
): AcademyProgress {
  const result = emptyAcademyProgress();
  result.resetAt =
    local.resetAt > backup.resetAt ? local.resetAt : backup.resetAt;
  for (const key of new Set([
    ...Object.keys(backup.cases),
    ...Object.keys(local.cases),
  ])) {
    const merged: CasePractice = {
      revision: ACTIVITY_REVISION,
      answers: {},
      physicalChecked: false,
      physicalUpdatedAt: "",
    };
    for (const source of [backup.cases[key], local.cases[key]]) {
      if (!source || source.revision !== ACTIVITY_REVISION) continue;
      for (const [id, answer] of Object.entries(source.answers)) {
        if (answer.updatedAt <= result.resetAt) continue;
        if (
          !merged.answers[id] ||
          answer.updatedAt >= merged.answers[id].updatedAt
        )
          merged.answers[id] = answer;
      }
      if (
        source.physicalUpdatedAt > result.resetAt &&
        source.physicalUpdatedAt >= merged.physicalUpdatedAt
      ) {
        merged.physicalChecked = source.physicalChecked;
        merged.physicalUpdatedAt = source.physicalUpdatedAt;
      }
    }
    if (Object.keys(merged.answers).length || merged.physicalUpdatedAt)
      result.cases[key] = merged;
  }
  return result;
}
export function loadAcademyProgress(): AcademyProgress {
  try {
    return parseAcademyProgress(localStorage.getItem(ACADEMY_PROGRESS_KEY));
  } catch {
    return emptyAcademyProgress();
  }
}
export function persistAcademyProgress(progress: AcademyProgress): boolean {
  try {
    if (!canReadAcademy(localStorage.getItem(ACADEMY_PROGRESS_KEY)))
      return false;
    localStorage.setItem(ACADEMY_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
