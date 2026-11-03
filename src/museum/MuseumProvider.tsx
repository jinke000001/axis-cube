import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { retainMuseumRuntime, type MuseumRuntime } from "./runtime";
import "./museum.css";

export interface MuseumProviderProps { route: string; reduceMotion?: boolean; children: ReactNode }
/** Wrap the route outlet once. Exhibits register themselves; navigation never owns a canvas. */
export function MuseumProvider({ route, reduceMotion = false, children }: MuseumProviderProps) {
  const host = useRef<HTMLDivElement>(null), runtime = useRef<MuseumRuntime | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [systemReduced, setSystemReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useLayoutEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", change);
    let release: (() => void) | undefined;
    try {
      const retained = retainMuseumRuntime(); release = retained.release; runtime.current = retained.runtime;
      if (host.current) retained.runtime.attach(host.current);
    } catch { setUnavailable(true); }
    return () => { preference.removeEventListener("change", change); runtime.current = null; release?.(); };
  }, []);
  useLayoutEffect(() => { runtime.current?.setRoute(route, reduceMotion || systemReduced); }, [route, reduceMotion, systemReduced]);
  return <div className={`museum-provider${unavailable ? " museum-unavailable" : ""}`}>
    <div ref={host} className="museum-canvas-layer" aria-hidden="true"/>
    {children}
    {unavailable && <p className="museum-fallback-note" role="status">三维展馆暂不可用，课程图示、公式和学习记录仍可使用。</p>}
  </div>;
}
export default MuseumProvider;
