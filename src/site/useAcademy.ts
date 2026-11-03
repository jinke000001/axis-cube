import { useCallback, useEffect, useRef, useState } from "react";
import {
  readNativePreference,
  writeNativePreference,
} from "../platform/preferences";
import { isNativeApp } from "../platform/runtime";
import {
  ACTIVITY_REVISION,
  canReadAcademy,
  emptyAcademyProgress,
  loadAcademyProgress,
  mergeAcademyProgress,
  nextAcademyTimestamp,
  parseAcademyProgress,
  persistAcademyProgress,
  practiceKey,
} from "./academy-progress";

export function useAcademy() {
  const [progress, setProgress] = useState(loadAcademyProgress);
  const [ready, setReady] = useState(() => !isNativeApp());
  const [saveError, setSaveError] = useState("");
  const changed = useRef(false),
    nativeReadable = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    readNativePreference("academy.v1")
      .then((raw) => {
        if (!active) return;
        nativeReadable.current = canReadAcademy(raw);
        if (!nativeReadable.current) {
          setSaveError(
            "这台手机的练习备份暂时无法读取。原记录已保留，仍可继续练习。",
          );
          return;
        }
        if (raw)
          setProgress((current) =>
            mergeAcademyProgress(current, parseAcademyProgress(raw)),
          );
      })
      .catch(() => {
        if (active) setSaveError("练习备份暂时无法读取，当前仍可练习。");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || !changed.current) return;
    const webSaved = persistAcademyProgress(progress);
    if (!isNativeApp()) {
      setSaveError(webSaved ? "" : "练习结果暂时无法保存，原有记录已保留。");
      return;
    }
    if (!nativeReadable.current) return;
    const encoded = JSON.stringify(progress);
    writes.current = writes.current
      .catch(() => {})
      .then(async () => {
        try {
          await writeNativePreference("academy.v1", encoded);
          setSaveError(
            webSaved ? "" : "练习已备份到手机，本地页面记录暂时无法更新。",
          );
        } catch {
          setSaveError(
            webSaved
              ? "练习已留在当前页面，手机备份暂时未能保存。"
              : "练习结果暂时无法保存，请保留当前页面。",
          );
        }
      });
  }, [progress, ready]);
  const answer = useCallback(
    (
      lessonId: string,
      caseId: string,
      activityId: string,
      value: string,
      passed: boolean,
    ) => {
      changed.current = true;
      setProgress((current) => {
        const key = practiceKey(lessonId, caseId);
        const previous = current.cases[key] ?? {
          revision: ACTIVITY_REVISION,
          answers: {},
          physicalChecked: false,
          physicalUpdatedAt: "",
        };
        const previousAnswer = previous.answers[activityId];
        return {
          ...current,
          cases: {
            ...current.cases,
            [key]: {
              ...previous,
              answers: {
                ...previous.answers,
                [activityId]: {
                  answer: value,
                  passed,
                  attempts: (previousAnswer?.attempts ?? 0) + 1,
                  updatedAt: nextAcademyTimestamp(current),
                },
              },
            },
          },
        };
      });
    },
    [],
  );
  const confirmPhysical = useCallback(
    (lessonId: string, caseId: string, checked: boolean) => {
      changed.current = true;
      setProgress((current) => {
        const key = practiceKey(lessonId, caseId);
        const previous = current.cases[key] ?? {
          revision: ACTIVITY_REVISION,
          answers: {},
          physicalChecked: false,
          physicalUpdatedAt: "",
        };
        return {
          ...current,
          cases: {
            ...current.cases,
            [key]: {
              ...previous,
              physicalChecked: checked,
              physicalUpdatedAt: nextAcademyTimestamp(current),
            },
          },
        };
      });
    },
    [],
  );
  const reset = useCallback(() => {
    changed.current = true;
    setProgress((current) => ({
      ...emptyAcademyProgress(),
      resetAt: nextAcademyTimestamp(current),
    }));
  }, []);
  return { progress, ready, saveError, answer, confirmPhysical, reset };
}
