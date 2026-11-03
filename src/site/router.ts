import { useEffect, useState } from "react";

function nativeEnvironment() {
  const host = window as Window & { Capacitor?: { isNativePlatform(): boolean } };
  return host.Capacitor?.isNativePlatform() ?? false;
}
export function readRoute() {
  const raw = location.hash.startsWith("#/") ? location.hash.slice(1) : location.pathname;
  return raw.replace(/\/$/, "") || "/";
}
export function routeHref(path: string) { return nativeEnvironment() ? `#${path}` : path; }
export function navigationDepth() {
  const value = history.state?.axisNavigationDepth;
  return Number.isInteger(value) && value >= 0 ? value as number : 0;
}
export function navigate(path: string, replace = false) {
  const href = routeHref(path);
  const current = readRoute() + (location.hash.startsWith("#/") ? "" : location.search);
  if (replace) history.replaceState({ ...history.state, axisNavigationDepth: navigationDepth() }, "", href);
  else if (current !== path) history.pushState({ axisNavigationDepth: navigationDepth() + 1 }, "", href);
  window.dispatchEvent(new Event("axis:navigate"));
}
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    for (const name of ["popstate", "hashchange", "axis:navigate"]) window.addEventListener(name, update);
    return () => { for (const name of ["popstate", "hashchange", "axis:navigate"]) window.removeEventListener(name, update); };
  }, []);
  return route;
}
