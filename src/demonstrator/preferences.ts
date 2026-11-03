import {
  readNativePreference,
  writeNativePreference,
} from "../platform/preferences";
import { isNativeApp } from "../platform/runtime";

export const DEMO_PREFERENCE_KEY = "axis.cfop-demonstrator.v1";
const NATIVE_KEY = "cfop-demonstrator.v1";
export interface DemoPreferences {
  version: 1;
  speed: number;
  ghostHands: boolean;
}
export const DEFAULT_PREFERENCES: DemoPreferences = {
  version: 1,
  speed: 1,
  ghostHands: false,
};

export function decodePreferences(raw: string | null): DemoPreferences | null {
  if (raw === null) return { ...DEFAULT_PREFERENCES };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const p = data as Partial<DemoPreferences>;
    if (
      p.version !== 1 ||
      ![0.35, 0.6, 1].includes(p.speed ?? 0) ||
      typeof p.ghostHands !== "boolean"
    )
      return null;
    return { version: 1, speed: p.speed!, ghostHands: p.ghostHands };
  } catch {
    return null;
  }
}

export async function readDemoPreferences(): Promise<DemoPreferences | null> {
  const raw = isNativeApp()
    ? await readNativePreference(NATIVE_KEY)
    : localStorage.getItem(DEMO_PREFERENCE_KEY);
  return decodePreferences(raw);
}

let pendingWrite: Promise<void> = Promise.resolve();
export function saveDemoPreferences(
  preferences: DemoPreferences,
): Promise<void> {
  const raw = JSON.stringify(preferences);
  const write = pendingWrite
    .catch(() => undefined)
    .then(async () => {
      if (isNativeApp()) {
        if (!decodePreferences(await readNativePreference(NATIVE_KEY)))
          throw new Error("当前偏好已由其他版本更新，保留原值。");
        await writeNativePreference(NATIVE_KEY, raw);
      } else {
        if (!decodePreferences(localStorage.getItem(DEMO_PREFERENCE_KEY)))
          throw new Error("当前偏好已由其他版本更新，保留原值。");
        localStorage.setItem(DEMO_PREFERENCE_KEY, raw);
      }
    });
  pendingWrite = write;
  return write;
}
