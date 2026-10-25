import { FACES, parseAlgorithm } from "./cube";
import { loadSession, readSession, type Session } from "./session";
import { expandExecutionMoves } from "./execution-moves";
import type { PresentationMode } from "./competition";
const KEY = "axis.follow.v1";
const keyFor = (mode: PresentationMode) => mode === "competitive" ? "axis.follow.competitive.v1" : KEY;
const identity = (session: Session, mode: PresentationMode) =>
  session.facelets + "|" + (mode === "competitive" ? session.competition?.execution.algorithm : session.solution);
const persistedSnapshot = (session: Session) => {
  const value = readSession(session);
  return JSON.stringify([value.version, value.facelets, FACES.map(face => value.palette[face]),
    value.solution, value.name, value.createdAt, value.method ?? null, value.phases ?? null, value.competition ?? null]);
};
export interface FollowProgress {
  enabled: boolean;
  completed: number;
}
export function readFollow(session: Session | null, mode: PresentationMode = "cfop"): FollowProgress {
  const empty = { enabled: false, completed: 0 };
  if (!session || (mode === "competitive" && !session.competition)) return empty;
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(mode)) ?? "null");
    const source=parseAlgorithm(mode === "competitive" ? session.competition!.execution.algorithm : session.solution);
    const execution=mode === "competitive" ? { moves: source, boundaries: source.map((_, i) => i).concat(source.length) } : expandExecutionMoves(source);
    if (
      !saved ||
      saved.identity !== identity(session, mode) ||
      typeof saved.enabled !== "boolean" ||
      !Number.isInteger(saved.completed) ||
      saved.completed < 0 ||
      (saved.executionVersion!==undefined && saved.executionVersion!==1) ||
      saved.completed > (saved.executionVersion===1?execution.moves.length:source.length)
    )
      return empty;
    return { enabled: saved.enabled, completed: saved.executionVersion===1?saved.completed:execution.boundaries[saved.completed] };
  } catch {
    return empty;
  }
}
export function saveFollow(
  session: Session,
  progress: FollowProgress,
  mode: PresentationMode = "cfop",
): boolean {
  try {
    // A failed session save must not replace the last durable cube's progress.
    // In-memory playback can continue, but only the persisted identity owns this key.
    const persisted = loadSession();
    if (!persisted || (mode === "competitive" && (!persisted.competition || !session.competition)) ||
      identity(persisted, mode) !== identity(session, mode) ||
      persistedSnapshot(persisted) !== persistedSnapshot(session)) return false;
    const count = mode === "competitive" ? parseAlgorithm(session.competition!.execution.algorithm).length :
      expandExecutionMoves(parseAlgorithm(session.solution)).moves.length;
    if(!Number.isInteger(progress.completed)||progress.completed<0||progress.completed>count)return false;
    localStorage.setItem(
      keyFor(mode),
      JSON.stringify({ identity: identity(session, mode), ...progress,executionVersion:1 }),
    );
    return true;
  } catch {
    return false;
  }
}
