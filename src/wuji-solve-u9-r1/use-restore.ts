import { useEffect, useState, useSyncExternalStore } from "react";
import { Solver } from "../wuji-solve-v1/solver";
import { localSolveStore } from "../wuji-solve-v1/storage";
import { PersonalRestoreFlow } from "./flow";

export function useRestore(active = true) {
  const [flow] = useState(() => new PersonalRestoreFlow(localSolveStore(), new Solver(), active));
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  useEffect(() => {
    if (active) flow.activate();
  }, [active, flow]);
  useEffect(() => () => flow.dispose(), [flow]);
  return { flow, state };
}
