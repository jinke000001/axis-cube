import { describe, expect, it } from "vitest";
import { FACES, SOLVED, applyAlgorithm, rotateFace, type Face } from "./cube";
import { REFERENCE, recognizeCapture, type FaceSamples } from "./vision";
import realPhotos from "../../tests/fixtures/real-3x3/annotation.json";
import {
  CAPTURE_DRAFT_KEY,
  LEGACY_DRAFT_KEY,
  applyCaptureOrientation,
  commitFace,
  clearCaptureDraft,
  emptyCapture,
  paintCaptureCell,
  readCaptureDraft,
  rotateCaptureFace,
  saveCaptureDraft,
} from "./capture-state";
import { proposeCaptureOrientation } from "./capture-orientation";
import type { FaceAnalysis } from "./vision-contract";
function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function analysis(face: Face): FaceAnalysis {
  return {
    quad: [
      [0, 0],
      [300, 0],
      [300, 300],
      [0, 300],
    ],
    confidence: 1,
    method: "grid",
    warnings: [],
    cells: Array.from({ length: 9 }, () => ({
      rgb: [...REFERENCE[face]],
      alternatives: [],
      coverage: 1,
      glare: 0,
      spread: 0,
    })),
  };
}
describe("capture transactions and existing user data", () => {
  it("edits only the selected cell without undoing accepted automatic corrections", () => {
    const samples = structuredClone(realPhotos.rgbSamples) as FaceSamples;
    const recognized = recognizeCapture(samples, "?".repeat(54), new Set());
    expect(recognized.status).toBe("ready");
    expect(recognized.adjusted).toContain(17);
    const state = { ...emptyCapture(), ...recognized, samples };
    const before = structuredClone(state);
    const selected = state.colors[0] as Face;
    const wrong = selected === "R" ? "U" : "R";
    const edited = paintCaptureCell(state, 0, wrong);
    expect(edited.colors).toBe(wrong + state.colors.slice(1));
    expect(edited.status).toBe("review");
    expect(edited.samples).toEqual(state.samples);
    expect(edited.evidence).toEqual(state.evidence);
    expect(edited.turns).toEqual(state.turns);
    expect(state).toEqual(before);
    const store = storage();
    saveCaptureDraft(edited, store);
    const restored = readCaptureDraft(store);
    expect(restored.colors).toBe(edited.colors);
    const corrected = paintCaptureCell(restored, 0, selected);
    expect(corrected.colors).toBe(state.colors);
    expect(corrected.status).toBe("ready");
    expect(corrected.locked).toContain(0);
  });

  it("resolves only the manually checked warning and retains other uncertain cells", () => {
    const state = {
      ...emptyCapture(),
      colors: SOLVED,
      status: "review" as const,
      uncertain: [0, 1],
      adjusted: [0, 2],
    };
    const first = paintCaptureCell(state, 0, "U");
    expect(first.uncertain).toEqual([1]);
    expect(first.adjusted).toEqual([2]);
    expect(first.status).toBe("review");
    expect(paintCaptureCell(first, 1, "U").status).toBe("ready");
  });

  it("applies a direction proposal atomically with aligned evidence, locks and persisted metadata", () => {
    const colors = "BFLUBDUULFRDBRBRLBBLDUULDFFLDRBFDUFDRRUULBFRBLFFRDLRDU";
    const state = {
      ...emptyCapture(),
      colors,
      locked: [0, 18, 27],
      uncertain: [0, 6, 27, 28, 18],
      adjusted: [8, 35],
    };
    state.turns = { U: 2, D: 1 };
    for (const [fi, face] of FACES.entries()) {
      state.samples[face] = [...colors.slice(fi * 9, fi * 9 + 9)].map(
        (color) => [...REFERENCE[color as Face]],
      );
      state.evidence[face] = state.samples[face]!.map((rgb, index) => ({
        rgb,
        alternatives: [],
        coverage: 1,
        glare: 0,
        spread: index,
      }));
      state.fingerprints[face] = `original-${face}`;
    }
    const before = JSON.stringify(state);
    const proposal = proposeCaptureOrientation(colors);
    const result = applyCaptureOrientation(state, proposal);
    expect(JSON.stringify(state)).toBe(before);
    expect(result.status).toBe("review");
    expect(result.turns).toEqual({ U: 3, D: 0 });
    expect(result.evidence.U!.map((cell) => cell.spread)).toEqual([
      6, 3, 0, 7, 4, 1, 8, 5, 2,
    ]);
    expect(result.evidence.D!.map((cell) => cell.spread)).toEqual([
      2, 5, 8, 1, 4, 7, 0, 3, 6,
    ]);
    expect(result.samples.U).toEqual(
      result.evidence.U!.map((cell) => cell.rgb),
    );
    expect(result.samples.D).toEqual(
      result.evidence.D!.map((cell) => cell.rgb),
    );
    expect(result.uncertain).toEqual([2, 0, 33, 30, 18]);
    expect(result.adjusted).toEqual([6, 29]);
    expect(result.locked).toHaveLength(19);
    expect(result.locked).toContain(18);
    expect(result.fingerprints).toEqual(state.fingerprints);
    const store = storage();
    expect(saveCaptureDraft(result, store)).toBe(true);
    const restored = readCaptureDraft(store);
    for (const field of [
      "colors",
      "samples",
      "evidence",
      "turns",
      "locked",
      "uncertain",
      "adjusted",
      "fingerprints",
    ] as const)
      expect(restored[field], field).toEqual(result[field]);
    const edited = paintCaptureCell(restored, 18, restored.colors[18] as Face);
    expect(edited.colors.slice(0, 9)).toBe(result.colors.slice(0, 9));
    expect(edited.colors.slice(27, 36)).toBe(result.colors.slice(27, 36));
    expect(edited.turns.U).toBe(3);
    expect(edited.turns.D).toBe(0);
    const replaced = commitFace(edited, "U", analysis("U"), "replacement-u");
    expect(replaced.locked.some((index) => index < 9)).toBe(false);
    expect(replaced.turns.U).toBe(0);
    expect(replaced.fingerprints.U).toBe("replacement-u");
    expect(replaced.locked).toContain(27);
  });
  it("rejects stale or inconsistent direction proposals without altering the draft", () => {
    const colors = "BFLUBDUULFRDBRBRLBBLDUULDFFLDRBFDUFDRRUULBFRBLFFRDLRDU";
    const state = { ...emptyCapture(), colors };
    const proposal = proposeCaptureOrientation(colors);
    expect(
      applyCaptureOrientation({ ...state, colors: SOLVED }, proposal).colors,
    ).toBe(SOLVED);
    expect(applyCaptureOrientation(state, { status: "ambiguous" })).toBe(state);
    if (proposal.status !== "unique")
      throw new Error("Expected unique proposal");
    expect(
      applyCaptureOrientation(state, { ...proposal, rotations: { U: 1 } }),
    ).toBe(state);
  });
  it("clears both draft formats without removing accepted sessions or unrelated preferences", () => {
    const store = storage();
    saveCaptureDraft(commitFace(emptyCapture(), "F", analysis("F")), store);
    store.setItem("axis.session.test", "accepted demonstration");
    store.setItem("axis.presentation.v1", "competitive");
    expect(clearCaptureDraft(store)).toBe(true);
    expect(store.getItem(CAPTURE_DRAFT_KEY)).toBeNull();
    expect(store.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(readCaptureDraft(store)).toEqual(emptyCapture());
    expect(store.getItem("axis.session.test")).toBe("accepted demonstration");
    expect(store.getItem("axis.presentation.v1")).toBe("competitive");
  });
  it("reports a failed removal and still attempts the other draft format", () => {
    const store = storage();
    saveCaptureDraft(commitFace(emptyCapture(), "F", analysis("F")), store);
    const denied = {
      ...store,
      removeItem(key: string) {
        if (key === CAPTURE_DRAFT_KEY) throw new Error("blocked");
        store.removeItem(key);
      },
    };
    expect(clearCaptureDraft(denied)).toBe(false);
    expect(store.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(store.getItem(CAPTURE_DRAFT_KEY)).not.toBeNull();
    expect(clearCaptureDraft()).toBe(false);
  });
  it("commits nine measured cells together and never changes the old state on a failed face", () => {
    const initial = emptyCapture(),
      saved = JSON.stringify(initial);
    const next = commitFace(initial, "F", analysis("F"), "photo-f");
    expect(next.colors.slice(18, 27)).toBe("F".repeat(9));
    expect(JSON.stringify(initial)).toBe(saved);
    const incomplete = analysis("R");
    incomplete.cells.pop();
    const before = JSON.stringify(next);
    expect(() => commitFace(next, "R", incomplete)).toThrow("完整九格");
    expect(JSON.stringify(next)).toBe(before);
    const invalid = analysis("R");
    invalid.cells[2].rgb[1] = NaN;
    expect(() => commitFace(next, "R", invalid)).toThrow("完整九格");
  });
  it("recognizes all six faces with no empty cells, and rejects an identical photograph assigned to another face", () => {
    let state = emptyCapture();
    state = commitFace(state, "F", analysis("F"), "same-photo");
    expect(() => commitFace(state, "R", analysis("R"), "same-photo")).toThrow(
      "已经用于 F",
    );
    for (const face of FACES)
      state = commitFace(state, face, analysis(face), `unique-${face}`);
    expect(state.colors).toBe(SOLVED);
    expect(state.status).toBe("ready");
  });
  it("preserves legacy colors as explicit choices until that face is intentionally replaced", () => {
    const store = storage(),
      original = applyAlgorithm(SOLVED, "R U");
    store.setItem(LEGACY_DRAFT_KEY, original);
    const state = readCaptureDraft(store);
    expect(state.colors).toBe(original);
    expect(state.locked).toHaveLength(54);
    const next = commitFace(state, "F", analysis("F"));
    for (let i = 0; i < 54; i++)
      if (i < 18 || i >= 27) expect(next.colors[i]).toBe(original[i]);
    expect(state.colors).toBe(original);
  });
  it("round-trips measurements and manual edits, including reclassifying another face after reopening", () => {
    const store = storage();
    const state = paintCaptureCell(
      commitFace(emptyCapture(), "F", analysis("F")),
      18,
      "R",
    );
    expect(saveCaptureDraft(state, store)).toBe(true);
    const restored = readCaptureDraft(store);
    expect(restored.colors[18]).toBe("R");
    expect(restored.locked).toContain(18);
    expect(restored.samples.F).toEqual(state.samples.F);
    expect(restored.evidence.F).toEqual(state.evidence.F);
    const next = commitFace(restored, "B", analysis("B"));
    expect(next.colors[18]).toBe("R");
  });
  it("recovers the newest primary record if writing the legacy mirror fails", () => {
    const store = storage();
    const old = emptyCapture();
    saveCaptureDraft(old, store);
    const next = commitFace(old, "F", analysis("F"));
    const blockedMirror = {
      ...store,
      setItem(key: string, value: string) {
        if (key === LEGACY_DRAFT_KEY) throw new Error("quota");
        store.setItem(key, value);
      },
    };
    expect(saveCaptureDraft(next, blockedMirror)).toBe(false);
    expect(readCaptureDraft(store).colors).toBe(next.colors);
  });
  it("does not overwrite the older draft when the primary write is denied", () => {
    const store = storage(),
      old = emptyCapture();
    saveCaptureDraft(old, store);
    const next = commitFace(old, "F", analysis("F"));
    const denied = {
      ...store,
      setItem() {
        throw new Error("quota");
      },
    };
    expect(saveCaptureDraft(next, denied)).toBe(false);
    expect(readCaptureDraft(store).colors).toBe(old.colors);
  });
  it("keeps a subsequent edit made by the old application rather than replacing it from stale metadata", () => {
    const store = storage();
    saveCaptureDraft(commitFace(emptyCapture(), "F", analysis("F")), store);
    const edited = applyAlgorithm(SOLVED, "R U F");
    store.setItem(LEGACY_DRAFT_KEY, edited);
    expect(readCaptureDraft(store).colors).toBe(edited);
    expect(readCaptureDraft(store).locked).toHaveLength(54);
  });
  it("recovers the legacy draft when new metadata is corrupt and tolerates unavailable storage", () => {
    const store = storage();
    store.setItem(LEGACY_DRAFT_KEY, SOLVED);
    store.setItem(CAPTURE_DRAFT_KEY, "{broken");
    expect(readCaptureDraft(store).colors).toBe(SOLVED);
    expect(
      readCaptureDraft({
        getItem() {
          throw new Error("blocked");
        },
        setItem() {},
      }).colors,
    ).toBe(emptyCapture().colors);
  });
  it("does not turn a legal but uncertain recognition into an automatic success after reopening", () => {
    const store = storage();
    const state = {
      ...emptyCapture(),
      colors: SOLVED,
      status: "review" as const,
      uncertain: [0, 9],
    };
    saveCaptureDraft(state, store);
    const restored = readCaptureDraft(store);
    expect(restored.status).toBe("review");
    expect(restored.uncertain).toEqual([0, 9]);
    expect(restored.colors).toBe(SOLVED);
  });
  it("rotates the visible face and stored measurements together, with the explicit orientation preserved", () => {
    const colors = applyAlgorithm(SOLVED, "R U F");
    const state = { ...emptyCapture(), colors };
    state.samples.F = [...colors.slice(18, 27)].map(
      (c) => REFERENCE[c as Face],
    );
    const oldSamples = [...state.samples.F];
    const rotated = rotateCaptureFace(state, "F");
    expect(rotated.colors.slice(18, 27)).toBe(
      rotateFace(colors, "F").slice(18, 27),
    );
    expect(rotated.samples.F).toEqual(
      [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => oldSamples[i]),
    );
    expect(rotated.turns.F).toBe(1);
    expect(
      Array.from({ length: 9 }, (_, i) => rotated.locked.includes(18 + i)),
    ).toEqual(Array(9).fill(true));
  });
});
