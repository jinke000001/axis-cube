import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classify,
  classifyCapture,
  homography,
  REFERENCE,
  sampleFace,
  type Quad,
  type FaceSamples,
} from "./vision";
import {
  DEFAULT_PALETTE,
  FACES,
  SOLVED,
  applyAlgorithm,
  normalizeColors,
  validateFacelets,
} from "./cube";
import realPhotos from "../../tests/fixtures/real-3x3/annotation.json";
import { loadSession, newSession, readSession, saveSession } from "./session";
import { readFollow, saveFollow } from "./follow";

afterEach(() => vi.unstubAllGlobals());
describe("photo sampling", () => {
  it("maps perspective corners and samples the interior, avoiding sticker edges", () => {
    const q: Quad = [
        [40, 20],
        [280, 35],
        [260, 280],
        [20, 260],
      ],
      map = homography(q);
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].forEach(([u, v], i) => {
      expect(map(u, v)[0]).toBeCloseTo(q[i][0]);
      expect(map(u, v)[1]).toBeCloseTo(q[i][1]);
    });
    const data = new Uint8ClampedArray(300 * 300 * 4),
      colors = ["U", "R", "F", "D", "L", "B", "F", "U", "L"] as const;
    for (let cell = 0; cell < 9; cell++) {
      const [cx, cy] = map(
        ((cell % 3) + 0.5) / 3,
        (Math.floor(cell / 3) + 0.5) / 3,
      );
      for (let y = Math.floor(cy - 20); y < cy + 20; y++)
        for (let x = Math.floor(cx - 20); x < cx + 20; x++)
          data.set([...REFERENCE[colors[cell]], 255], (y * 300 + x) * 4);
    }
    const sampled = sampleFace(
      { data, width: 300, height: 300 } as ImageData,
      q,
    );
    expect(sampled.map((rgb) => classify(rgb).color)).toEqual(colors);
    expect(() =>
      sampleFace({ data, width: 300, height: 300 } as ImageData, [
        q[0],
        q[2],
        q[1],
        q[3],
      ]),
    ).toThrow("角点");
    expect(() =>
      homography([
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toThrow("重叠");
  });
  it("tolerates modest lighting changes while reporting ambiguous colors", () => {
    for (const f of FACES) {
      const rgb = REFERENCE[f].map((v) => Math.round(v * 0.85 + 7)) as [
        number,
        number,
        number,
      ];
      expect(classify(rgb).color).toBe(f);
    }
    const ambiguous = classify([220, 93, 47]);
    expect(ambiguous.confidence).toBeLessThan(0.5);
  });
  it("calibrates washed-out real photo centers together and preserves a manual correction", () => {
    const samples = realPhotos.rgbSamples as FaceSamples;
    const physical = { W: "U", R: "R", G: "F", Y: "D", O: "L", B: "B" };
    const expected = FACES.map((f) => realPhotos.faces[f].join(""))
      .join("")
      .split("")
      .map((c) => physical[c as keyof typeof physical])
      .join("");
    const result = classifyCapture(samples, "?".repeat(54), new Set());
    expect(FACES.map((_, i) => result.colors[i * 9 + 4])).toEqual([
      "R",
      "D",
      "F",
      "L",
      "U",
      "B",
    ]);
    const wrong = [...result.colors].flatMap((c, i) =>
      c === expected[i] ? [] : [i],
    );
    expect(wrong).toEqual([17]);
    const uncorrected = normalizeColors(result.colors);
    expect(
      validateFacelets(uncorrected.facelets, uncorrected.palette).message,
    ).toBe("黄色有 10 格，需要 9 格。");
    const corrected = result.colors.split("");
    corrected[17] = expected[17];
    const final = classifyCapture(samples, corrected.join(""), new Set([17]));
    expect(final.colors).toBe(expected);
    expect(validateFacelets(normalizeColors(final.colors).facelets).valid).toBe(
      true,
    );
  });
  it("respects explicit center edits instead of silently repairing user input", () => {
    const result = classifyCapture(
      realPhotos.rgbSamples as FaceSamples,
      "U".repeat(54),
      new Set([4, 13, 17]),
    );
    expect(result.colors[4]).toBe("U");
    expect(result.colors[13]).toBe("U");
    expect(result.colors[17]).toBe("U");
    expect(() => normalizeColors(result.colors)).toThrow("中心");
  });
});
describe("local session integrity", () => {
  function storage() {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    return data;
  }
  const session = newSession(
    applyAlgorithm(SOLVED, "R U"),
    "U' R'",
    DEFAULT_PALETTE,
    "test",
  );
  it("accepts only a legal state paired with a verified solution", () => {
    expect(readSession(session)).toEqual(session);
    expect(() => readSession({ ...session, solution: "R" })).toThrow("不一致");
    expect(() => readSession({ ...session, facelets: "U".repeat(54) })).toThrow(
      "状态",
    );
    expect(() =>
      readSession({ ...session, palette: { ...DEFAULT_PALETTE, R: "U" } }),
    ).toThrow("映射");
  });
  it("preserves the current session when backup storage fails", () => {
    const data = storage();
    expect(saveSession(session)).toBe(true);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(saveSession(newSession(SOLVED, ""))).toBe(false);
    expect(loadSession()).toEqual(session);
  });
  it("restores physical progress only for its matching session", () => {
    const data = storage();
    saveSession(session);
    saveFollow(session, { enabled: true, completed: 1 });
    expect(readFollow(session)).toEqual({ enabled: true, completed: 1 });
    expect(readFollow(newSession(SOLVED, ""))).toEqual({
      enabled: false,
      completed: 0,
    });
    data.set("axis.follow.v1", '{"completed":999}');
    expect(readFollow(session).completed).toBe(0);
  });
});
