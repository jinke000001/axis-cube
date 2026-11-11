import { useEffect, useState } from "react";
import { getFormula, FORMULAS } from "../demonstrator/catalog";
import { readRoute } from "../site/router";

export function resolveFormulaRoute(raw: string) {
  const [path, query = ""] = raw.split("?");
  const match = /^\/library\/cfop\/(gan-(?:f2l|oll|pll)-\d{2})$/.exec(path);
  const variant = new URLSearchParams(query).get("variant") === "1" ? 1 : 0;
  const record = match
    ? getFormula(match[1] + (variant ? "-alt-1" : ""))
    : undefined;
  const retired =
    /^\/(?:learn|studio|help)(?:\/|$)/.test(path) ||
    /^\/library\/(?:formulas|fingers)(?:\/|$)/.test(path);
  return {
    formula: record ?? FORMULAS[0],
    retired,
    missing: !!match && !record,
  };
}

export function formulaHref(caseId: string, variant = 0) {
  return `/library/cfop/${caseId}${variant ? "?variant=1" : ""}`;
}

export function useFormulaRoute() {
  const read = () =>
    readRoute() + (location.hash.startsWith("#/") ? "" : location.search);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const update = () => setRoute(read());
    const events = ["popstate", "hashchange", "axis:navigate"];
    events.forEach((name) => window.addEventListener(name, update));
    return () =>
      events.forEach((name) => window.removeEventListener(name, update));
  }, []);
  const personal=/^\/solve(?:\/|$)/.test(route.split("?")[0]);
  const [last,setLast]=useState(()=>resolveFormulaRoute(route).formula);
  useEffect(()=>{if(!personal)setLast(resolveFormulaRoute(route).formula);},[route,personal]);
  return { route, ...resolveFormulaRoute(route),personal,formula:personal?last:resolveFormulaRoute(route).formula };
}
