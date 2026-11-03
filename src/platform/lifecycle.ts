import { App } from '@capacitor/app';
import { isNativeApp, nativePlatform } from './runtime';

export async function subscribeToAppState(
  listener: (active: boolean) => void,
): Promise<() => void> {
  if (isNativeApp()) {
    const handle = await App.addListener('appStateChange', ({ isActive }) => listener(isActive));
    return () => { void handle.remove(); };
  }
  const handler = () => listener(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

// Register only when the app shell is ready to own Android back navigation.
// The shell decides whether to navigate, dismiss a dialog, or exit at its root.
export async function subscribeToAndroidBack(
  listener: (canGoBack: boolean) => void,
): Promise<() => void> {
  if (nativePlatform() !== 'android') return () => {};
  const handle = await App.addListener('backButton', ({ canGoBack }) => listener(canGoBack));
  return () => { void handle.remove(); };
}

export async function minimizeAndroidApp(): Promise<void> {
  if (nativePlatform() === 'android') await App.minimizeApp();
}
