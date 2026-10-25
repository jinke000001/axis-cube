import {
  DEFAULT_PALETTE,
  FACES,
  applyAlgorithm,
  SOLVED,
  validateFacelets,
  parseAlgorithm,
  snapshots,
  type Palette,
} from "./cube";
import { CFOP_PHASES, isCFOPPhaseSolved, type CFOPPhaseName } from "./cfop-state";
import { readCompetitionVariant, type CompetitionVariant } from "./competition";
export interface SessionPhase {
  name: CFOPPhaseName;
  start: number;
  end: number;
}
export interface SolveMetadata {
  method?: "cfop" | "short";
  phases?: SessionPhase[];
}
export interface Session extends SolveMetadata {
  version: 1;
  facelets: string;
  palette: Palette;
  solution: string;
  name: string;
  createdAt: string;
  competition?: CompetitionVariant;
}
const KEY = "axis.cube.session.v1";
export function readSession(value: unknown): Session {
  if (!value || typeof value !== "object")
    throw new Error("这不是有效的 AXIS 局面文件。");
  const s = value as Partial<Session>;
  if (
    s.version !== 1 ||
    typeof s.facelets !== "string" ||
    !validateFacelets(s.facelets).valid
  )
    throw new Error("局面文件格式或魔方状态不正确。");
  if (
    !s.palette ||
    FACES.some((f) => !FACES.includes(s.palette![f])) ||
    new Set(Object.values(s.palette)).size !== 6
  )
    throw new Error("文件中的颜色映射无效。");
  if (
    typeof s.solution !== "string" ||
    s.solution.length > 1500 ||
    applyAlgorithm(s.facelets, s.solution) !== SOLVED
  )
    throw new Error("文件中的解法与局面不一致。");
  const metadata: SolveMetadata = {};
  if (s.method === "cfop") {
    const moves = parseAlgorithm(s.solution), states = snapshots(s.facelets, moves);
    if (!Array.isArray(s.phases) || s.phases.length !== 4)
      throw new Error("CFOP阶段记录不完整。");
    let boundary = 0;
    const phases = s.phases.map((phase, i) => {
      if (!phase || phase.name !== CFOP_PHASES[i] || phase.start !== boundary ||
        !Number.isInteger(phase.end) || phase.end < phase.start || phase.end > moves.length ||
        !isCFOPPhaseSolved(states[phase.end], phase.name))
        throw new Error("CFOP阶段记录与局面不一致。");
      boundary = phase.end;
      return { name: phase.name, start: phase.start, end: phase.end };
    });
    if (boundary !== moves.length) throw new Error("CFOP阶段未覆盖完整解法。");
    metadata.method = "cfop";
    metadata.phases = phases;
  } else if (s.method === "short") metadata.method = "short";
  else if (s.method !== undefined) throw new Error("未知的求解方法。");
  return {
    version: 1,
    facelets: s.facelets,
    palette: s.palette,
    solution: s.solution,
    name: typeof s.name === "string" ? s.name.slice(0, 60) : "导入的魔方",
    createdAt:
      typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
    ...metadata,
    ...(s.competition === undefined ? {} : { competition: readCompetitionVariant(s.facelets, s.competition) }),
  };
}
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? readSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session): boolean {
  try {
    const previous = localStorage.getItem(KEY);
    if (previous) localStorage.setItem(KEY + ".previous", previous);
    localStorage.setItem(KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
export function exportSession(session: Session) {
  const blob = new Blob([JSON.stringify(session, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "axis-cube-" + session.createdAt.slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function newSession(
  facelets: string,
  solution: string,
  palette = DEFAULT_PALETTE,
  name = "新的演示",
  metadata: SolveMetadata = {},
): Session {
  return {
    version: 1,
    facelets,
    solution,
    palette,
    name,
    createdAt: new Date().toISOString(),
    ...(metadata.method ? { method: metadata.method } : {}),
    ...(metadata.phases ? { phases: metadata.phases.map(({name: phaseName, start, end}) => ({name: phaseName, start, end})) } : {}),
  };
}
