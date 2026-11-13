import {
  FACES,
  normalizeColors,
  rotateFace,
  validateFacelets,
  type Face,
} from "./cube";
import { recognizeCapture, type FaceSamples, type RGB } from "./vision";
import type { OrientationProposal } from "./capture-orientation";
import type {
  CaptureClassification,
  CaptureEvidence,
  CellEvidence,
  FaceAnalysis,
} from "./vision-contract";

export const CAPTURE_ORDER: Face[] = ["F", "R", "B", "L", "U", "D"];
export const LEGACY_DRAFT_KEY = "axis.capture.draft";
export const CAPTURE_DRAFT_KEY = "axis.capture.v2";
const blank = FACES.map((f) => "????" + f + "????").join("");
const permutation = [6, 3, 0, 7, 4, 1, 8, 5, 2];

export interface CaptureState extends CaptureClassification {
  version: 2;
  samples: FaceSamples;
  evidence: CaptureEvidence;
  locked: number[];
  turns: Partial<Record<Face, number>>;
  fingerprints: Partial<Record<Face, string>>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
/** Only the photo-entry draft is cleared; saved demonstrations and preferences stay intact. */
export function clearCaptureDraft(
  storage?: Pick<Storage, "getItem" | "removeItem">,
): boolean {
  if (!storage) return false;
  const keys = [CAPTURE_DRAFT_KEY, LEGACY_DRAFT_KEY];
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Still try the other record; the caller also replaces the in-memory draft.
    }
  }
  try {
    return keys.every((key) => storage.getItem(key) === null);
  } catch {
    return false;
  }
}
export function emptyCapture(): CaptureState {
  return {
    version: 2,
    colors: blank,
    samples: {},
    evidence: {},
    locked: [],
    turns: {},
    fingerprints: {},
    uncertain: [],
    adjusted: [],
    rotations: {},
    status: "incomplete",
    message: "依次拍摄六个面，照片会自动识别。",
  };
}
const isColors = (value: unknown): value is string =>
  typeof value === "string" && /^[URFDLB?]{54}$/.test(value);
const isRGB = (value: unknown): value is RGB =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 255,
  );
const indices = (value: unknown): number[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((n) => Number.isInteger(n) && n >= 0 && n < 54))]
    : [];
function validCells(value: unknown): value is CellEvidence[] {
  return (
    Array.isArray(value) &&
    value.length === 9 &&
    value.every(
      (cell) =>
        cell &&
        isRGB(cell.rgb) &&
        Array.isArray(cell.alternatives) &&
        cell.alternatives.length <= 4 &&
        cell.alternatives.every(isRGB) &&
        Number.isFinite(cell.coverage) &&
        cell.coverage >= 0 &&
        cell.coverage <= 1 &&
        Number.isFinite(cell.glare) &&
        cell.glare >= 0 &&
        cell.glare <= 1 &&
        Number.isFinite(cell.spread) &&
        cell.spread >= 0,
    )
  );
}
export function isCompleteFace(colors: string, face: Face): boolean {
  return /^[URFDLB]{9}$/.test(
    colors.slice(FACES.indexOf(face) * 9, FACES.indexOf(face) * 9 + 9),
  );
}
export function captureValidation(
  colors: string,
  state?: Pick<CaptureState, "evidence" | "uncertain">,
) {
  try {
    const normalized = normalizeColors(colors);
    const result = validateFacelets(normalized.facelets, normalized.palette);
    if (!result.valid && result.indices.length > 1 && state) {
      const uncertainSet = new Set(state.uncertain);
      const cellPenalty = (idx: number) => {
        const face = FACES[Math.floor(idx / 9)];
        const cell = state.evidence[face]?.[idx % 9];
        const base = uncertainSet.has(idx) ? 10 : 0;
        if (!cell) return base;
        return base + cell.glare * 3 + (1 - cell.coverage) * 2 + cell.spread / 40;
      };
      result.indices = [...result.indices].sort(
        (a, b) => cellPenalty(b) - cellPenalty(a),
      );
    }
    return {
      ...result,
      normalized,
    };
  } catch (error) {
    return {
      valid: false,
      message: colors.includes("?")
        ? "还需要拍完六个面。"
        : error instanceof Error
          ? error.message
          : "请核对中心颜色。",
      indices: [] as number[],
      normalized: null,
    };
  }
}
/** Read without rewriting or deleting legacy data. A legacy edit wins over a stale v2 mirror. */
export function readCaptureDraft(storage?: StorageLike): CaptureState {
  const initial = emptyCapture();
  if (!storage) return initial;
  try {
    const legacy = storage.getItem(LEGACY_DRAFT_KEY);
    const raw = storage.getItem(CAPTURE_DRAFT_KEY);
    if (raw && raw.length <= 100_000) {
      try {
        const data = JSON.parse(raw);
        if (
          data?.version === 2 &&
          isColors(data.colors) &&
          (!isColors(legacy) ||
            legacy === data.colors ||
            (isColors(data.previousLegacy) && legacy === data.previousLegacy))
        ) {
          const result: CaptureState = {
            ...initial,
            colors: data.colors,
            locked: indices(data.locked),
            uncertain: indices(data.uncertain),
            adjusted: indices(data.adjusted),
          };
          for (const face of FACES) {
            const sample = data.samples?.[face];
            if (
              Array.isArray(sample) &&
              sample.length === 9 &&
              sample.every(isRGB)
            )
              result.samples[face] = sample;
            if (validCells(data.evidence?.[face]))
              result.evidence[face] = data.evidence[face];
            if (
              Number.isInteger(data.turns?.[face]) &&
              data.turns[face] >= 0 &&
              data.turns[face] < 4
            )
              result.turns[face] = data.turns[face];
            if (
              typeof data.fingerprints?.[face] === "string" &&
              data.fingerprints[face].length <= 80
            )
              result.fingerprints[face] = data.fingerprints[face];
          }
          result.status = result.colors.includes("?")
            ? "incomplete"
            : data.status === "ready" && captureValidation(result.colors).valid
              ? "ready"
              : "review";
          result.message =
            result.status === "incomplete"
              ? "已恢复之前录入的颜色，继续拍摄剩余面。"
              : result.status === "ready"
                ? "已恢复完整局面，可以核对后生成演示。"
                : "已恢复颜色，请核对标出的格子。";
          return result;
        }
      } catch {
        /* Corrupt new metadata must not hide a valid legacy draft. */
      }
    }
    if (isColors(legacy)) {
      const known = [...legacy].flatMap((c, i) => (c === "?" ? [] : [i]));
      const valid = captureValidation(legacy).valid;
      return {
        ...initial,
        colors: legacy,
        locked: known,
        status: legacy.includes("?")
          ? "incomplete"
          : valid
            ? "ready"
            : "review",
        message: "已保留之前的颜色记录；重新拍摄某面时只替换该面。",
      };
    }
  } catch {
    /* Private browsing/storage restrictions keep the in-memory flow available. */
  }
  return initial;
}
export function saveCaptureDraft(
  state: CaptureState,
  storage?: StorageLike,
): boolean {
  if (!storage) return false;
  try {
    // Atomic primary record includes manual locks and evidence. Keep the old reader usable.
    storage.setItem(
      CAPTURE_DRAFT_KEY,
      JSON.stringify({
        ...state,
        previousLegacy: storage.getItem(LEGACY_DRAFT_KEY),
      }),
    );
    storage.setItem(LEGACY_DRAFT_KEY, state.colors);
    return true;
  } catch {
    return false;
  }
}
function turnValues<T>(values: T[], turns: number): T[] {
  let out = [...values];
  for (let i = 0; i < turns; i++) out = permutation.map((index) => out[index]);
  return out;
}
/** Apply an explicitly accepted direction-only proposal as a single transaction.
 * Measurements stay aligned with the visible grid; photo coordinates do not move. */
export function applyCaptureOrientation(
  state: CaptureState,
  proposal: OrientationProposal,
): CaptureState {
  if (proposal.status !== "unique" || proposal.source !== state.colors)
    return state;
  let colors = state.colors;
  const samples = { ...state.samples },
    evidence = { ...state.evidence };
  const turns = { ...state.turns };
  const mapping = Array.from({ length: 54 }, (_, index) => index);
  const pinned: number[] = [];
  for (const face of FACES) {
    const count = proposal.rotations[face] ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > 3) return state;
    if (!count) continue;
    for (let step = 0; step < count; step++) colors = rotateFace(colors, face);
    if (samples[face]) samples[face] = turnValues(samples[face]!, count);
    if (evidence[face]) evidence[face] = turnValues(evidence[face]!, count);
    turns[face] = ((turns[face] ?? 0) + count) % 4;
    const start = FACES.indexOf(face) * 9;
    const order = turnValues(
      Array.from({ length: 9 }, (_, index) => start + index),
      count,
    );
    order.forEach((source, index) => {
      mapping[source] = start + index;
    });
    // Same explicit-choice rule as the existing manual rotate control. Replacing
    // this face through commitFace removes these locks and resets its photo turn.
    pinned.push(...order);
  }
  if (colors !== proposal.colors || !captureValidation(colors).valid)
    return state;
  return {
    ...state,
    colors,
    samples,
    evidence,
    turns,
    locked: [
      ...new Set([...state.locked.map((index) => mapping[index]), ...pinned]),
    ],
    uncertain: state.uncertain.map((index) => mapping[index]),
    adjusted: state.adjusted.map((index) => mapping[index]),
    rotations: { ...proposal.rotations },
    status: "review",
    message: "已校正记录的面方向，颜色未改。请对照实物核对后生成演示。",
  };
}
function classifyState(state: CaptureState): CaptureState {
  const result = recognizeCapture(
    state.samples,
    state.colors,
    new Set(state.locked),
    state.evidence,
  );
  const samples = { ...state.samples },
    evidence = { ...state.evidence },
    turns = { ...state.turns };
  for (const face of FACES) {
    const count = result.rotations[face] ?? 0;
    if (!count) continue;
    if (samples[face]) samples[face] = turnValues(samples[face]!, count);
    if (evidence[face]) evidence[face] = turnValues(evidence[face]!, count);
    turns[face] = ((turns[face] ?? 0) + count) % 4;
  }
  return { ...state, ...result, samples, evidence, turns };
}
/** Construct the entire next state before the UI publishes it. Failure leaves prior state intact. */
export function commitFace(
  state: CaptureState,
  face: Face,
  analysis: FaceAnalysis,
  fingerprint?: string,
): CaptureState {
  if (!analysis.quad || !validCells(analysis.cells))
    throw new Error("这张照片没有取得完整九格，请调整取景后重试。");
  if (fingerprint) {
    const duplicate = FACES.find(
      (f) => f !== face && state.fingerprints[f] === fingerprint,
    );
    if (duplicate)
      throw new Error(`这张照片已经用于 ${duplicate} 面，请选择当前面的照片。`);
  }
  const offset = FACES.indexOf(face) * 9;
  return classifyState({
    ...state,
    samples: {
      ...state.samples,
      [face]: analysis.cells.map((cell) => [...cell.rgb] as RGB),
    },
    evidence: { ...state.evidence, [face]: analysis.cells },
    locked: state.locked.filter((i) => i < offset || i >= offset + 9),
    turns: { ...state.turns, [face]: 0 },
    fingerprints: { ...state.fingerprints, [face]: fingerprint ?? "" },
  });
}
export function paintCaptureCell(
  state: CaptureState,
  index: number,
  color: Face,
): CaptureState {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 54 ||
    !FACES.includes(color)
  )
    return state;
  const colors =
    state.colors.slice(0, index) + color + state.colors.slice(index + 1);
  // A manual edit is a local choice. Re-running photo classification during an
  // invalid intermediate state can undo accepted joint corrections elsewhere.
  // New photo measurements still reclassify through commitFace above.
  const uncertain = state.uncertain.filter((item) => item !== index);
  const complete = !colors.includes("?");
  const validation = captureValidation(colors);
  const status = !complete
    ? "incomplete"
    : validation.valid && uncertain.length === 0
      ? "ready"
      : "review";
  return {
    ...state,
    colors,
    locked: [...new Set([...state.locked, index])],
    uncertain,
    adjusted: state.adjusted.filter((item) => item !== index),
    rotations: {},
    status,
    message: !complete
      ? "已保存手动修正，继续录入剩余面。"
      : !validation.valid
        ? validation.message
        : status === "review"
          ? "已保存手动修正，请核对其余高亮格。"
          : "已保存手动修正，局面有效，可以生成演示。",
  };
}
export function rotateCaptureFace(
  state: CaptureState,
  face: Face,
): CaptureState {
  if (!isCompleteFace(state.colors, face)) return state;
  const start = FACES.indexOf(face) * 9;
  const samples = { ...state.samples },
    evidence = { ...state.evidence };
  if (samples[face]) samples[face] = turnValues(samples[face]!, 1);
  if (evidence[face]) evidence[face] = turnValues(evidence[face]!, 1);
  // This is an explicit orientation correction; do not automatically undo it later.
  return classifyState({
    ...state,
    colors: rotateFace(state.colors, face),
    samples,
    evidence,
    turns: { ...state.turns, [face]: ((state.turns[face] ?? 0) + 1) % 4 },
    locked: [
      ...new Set([
        ...state.locked,
        ...Array.from({ length: 9 }, (_, i) => start + i),
      ]),
    ],
  });
}
export function nextCaptureFace(state: CaptureState, after: Face): Face {
  const start = CAPTURE_ORDER.indexOf(after);
  for (let i = 1; i <= 6; i++) {
    const candidate = CAPTURE_ORDER[(start + i) % 6];
    if (!isCompleteFace(state.colors, candidate)) return candidate;
  }
  return after;
}
