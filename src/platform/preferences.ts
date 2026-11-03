import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './runtime';

const PREFIX = 'axis.';

// Native backups are separate from the browser's local storage. Callers own
// schema validation and conflict resolution when restoring their domain data.
export async function readNativePreference(key: string): Promise<string | null> {
  if (!isNativeApp()) return null;
  return (await Preferences.get({ key: PREFIX + key })).value;
}

// A failed native write rejects; the caller must not claim that it was saved.
export async function writeNativePreference(key: string, value: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  await Preferences.set({ key: PREFIX + key, value });
  return true;
}

export async function removeNativePreference(key: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  await Preferences.remove({ key: PREFIX + key });
  return true;
}
