import { useCallback, useEffect, useRef, useState } from "react";
import { readNativePreference, writeNativePreference } from "../platform/preferences";
import { isNativeApp } from "../platform/runtime";
import { canReadProgress, emptyProgress, loadProgress, mergeProgress, nextProgressTimestamp, parseProgress, persistProgress, type LessonProgress } from "./progress";

export function useLearning() {
  const [progress, setProgress] = useState(loadProgress);
  const [ready, setReady] = useState(() => !isNativeApp());
  const [saveError, setSaveError] = useState("");
  const writes = useRef(Promise.resolve());
  const changed = useRef(false);
  const nativeReadable = useRef(false);
  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    readNativePreference("learning.v1").then(raw => {
      if (!active) return;
      nativeReadable.current = canReadProgress(raw);
      if (!nativeReadable.current) { setSaveError("手机中的旧学习记录暂时无法读取，原始记录已保留。当前仍可继续学习。"); return; }
      if (raw) setProgress(current => mergeProgress(current, parseProgress(raw)));
    }).catch(() => { if (active) setSaveError("暂时无法读取手机中的学习备份，当前页面仍可学习。"); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready || !changed.current) return;
    const webSaved = persistProgress(progress);
    if (!isNativeApp()) { setSaveError(webSaved ? "" : "学习进度暂时无法保存；离开前请记下当前课程。"); return; }
    if (!nativeReadable.current) return;
    const encoded = JSON.stringify(progress);
    writes.current = writes.current.catch(() => {}).then(async () => {
      try { await writeNativePreference("learning.v1", encoded); setSaveError(""); }
      catch { setSaveError(webSaved ? "学习进度已留在当前页面；手机备份暂时未能保存。" : "学习进度暂时无法保存；离开前请记下当前课程。"); }
    });
  }, [progress, ready]);
  const updateLesson = useCallback((id: string, patch: Partial<LessonProgress>) => setProgress(current => {
    const before = current.lessons[id] ?? { caseId: "", step: 0, checks: [], completed: false, updatedAt: "" };
    const next = { ...before, ...patch };
    if (current.lastLesson === id && Object.keys(patch).every(key => JSON.stringify(before[key as keyof LessonProgress]) === JSON.stringify(next[key as keyof LessonProgress]))) return current;
    changed.current = true;
    return { ...current, lastLesson: id, lessons: { ...current.lessons, [id]: { ...next, updatedAt: nextProgressTimestamp(current) } } };
  }), []);
  const setReduceMotion = useCallback((value: boolean) => { changed.current = true; setProgress(current => ({ ...current, reduceMotion: value, preferencesUpdatedAt: nextProgressTimestamp(current) })); }, []);
  const resetLearning = useCallback(() => { changed.current = true; setProgress(current => ({ ...emptyProgress(), reduceMotion: current.reduceMotion, preferencesUpdatedAt: current.preferencesUpdatedAt, resetAt: nextProgressTimestamp(current) })); }, []);
  return { progress, ready, saveError, updateLesson, setReduceMotion, resetLearning };
}
