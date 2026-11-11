import { useEffect, useState, useSyncExternalStore } from "react";
import { Solver } from "../wuji-solve-v1/solver";
import { localSolveStore } from "../wuji-solve-v1/storage";
import { PersonalRestoreFlow } from "./flow";

export function useRestore() {
  const [flow] = useState(() => new PersonalRestoreFlow(localSolveStore(), new Solver()));
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  useEffect(() => () => flow.dispose(), [flow]);
  return { flow, state };
}
