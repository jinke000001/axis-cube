import { describe, expect, it } from "vitest";
import { FACES, SOLVED, applyAlgorithm, type Face } from "./cube";
import {
  REFERENCE,
  recognizeCapture,
  type FaceSamples,
  type RGB,
} from "./vision";
import type { CaptureEvidence } from "./vision-contract";
import realPhotos from "../../tests/fixtures/real-3x3/annotation.json";
import cameraRgb from "../../tests/fixtures/real-3x3/browser-video-capture-rgb.json";

const UNKNOWN = "?".repeat(54);
const SCRAMBLED = applyAlgorithm(SOLVED, "R U F2 L' D B R2 U2 F'");
const ROTATE = [6, 3, 0, 7, 4, 1, 8, 5, 2];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// Bright, saturated anchors measured in the IMG_4874–4879 session. These
// generated cubes have independent move-derived labels, not classifier labels.
const SHADOW_ANCHORS: Record<Face, RGB> = {
  U: [151, 154, 144],
  R: [195, 2, 5],
  F: [0, 170, 0],
  D: [255, 231, 0],
  L: [254, 109, 0],
  B: [0, 65, 130],
};
function shadowSamples(state: string, orange: RGB, red?: RGB): FaceSamples {
  const samples = Object.fromEntries(
    FACES.map((face, fi) => [
      face,
      Array.from({ length: 9 }, (_, cell) => [
        ...SHADOW_ANCHORS[state[fi * 9 + cell] as Face],
      ]),
    ]),
  ) as FaceSamples;
  for (const [color, rgb] of [
    ["L", orange],
    ["R", red],
  ] as const) {
    if (!rgb) continue;
    const indices = [...state]
      .flatMap((c, i) => (c === color && i % 9 !== 4 ? [i] : []))
      .slice(0, 3);
    indices.forEach((i) => {
      samples[FACES[Math.floor(i / 9)]]![i % 9] = [...rgb];
    });
  }
  return samples;
}
function samplesFor(state: string): FaceSamples {
  return Object.fromEntries(
    FACES.map((face, fi) => [
      face,
      Array.from({ length: 9 }, (_, cell) => [
        ...REFERENCE[state[fi * 9 + cell] as Face],
      ]),
    ]),
  );
}
function evidenceFor(samples: FaceSamples): CaptureEvidence {
  return Object.fromEntries(
    FACES.filter((face) => samples[face]).map((face) => [
      face,
      samples[face]!.map((rgb) => ({
        rgb,
        alternatives: [],
        coverage: 1,
        glare: 0,
        spread: 1,
      })),
    ]),
  );
}
function rotate<T>(values: T[], turns: number): T[] {
  let result = [...values];
  for (let i = 0; i < turns; i++) result = ROTATE.map((index) => result[index]);
  return result;
}
function realTruth() {
  const physical = { W: "U", R: "R", G: "F", Y: "D", O: "L", B: "B" };
  return FACES.flatMap((face) => realPhotos.faces[face])
    .join("")
    .split("")
    .map((color) => physical[color as keyof typeof physical])
    .join("");
}

/** Synthetic labels come from explicit legal cube moves, never the recognizer. */
function generatedCases(
  count: number,
  seed: number,
  exposureRange: [number, number],
) {
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: count }, () => {
    const algorithm = Array.from(
      { length: 24 },
      () =>
        FACES[Math.floor(random() * 6)] +
        ["", "'", "2"][Math.floor(random() * 3)],
    ).join(" ");
    const expected = applyAlgorithm(SOLVED, algorithm);
    const samples = Object.fromEntries(
      FACES.map((face, fi) => {
        const exposure =
          exposureRange[0] + random() * (exposureRange[1] - exposureRange[0]);
        const tint = [0, 1, 2].map(() => 0.94 + random() * 0.12);
        return [
          face,
          Array.from({ length: 9 }, (_, cell) =>
            REFERENCE[expected[fi * 9 + cell] as Face].map((value, axis) =>
              Math.max(
                0,
                Math.min(
                  255,
                  Math.round(
                    value * exposure * tint[axis] + (random() - 0.5) * 3,
                  ),
                ),
              ),
            ),
          ),
        ];
      }),
    ) as FaceSamples;
    return { expected, samples };
  });
}

describe("six-photo joint color recognition", () => {
  it("resolves the stored real RGB error against independent visual labels", () => {
    const result = recognizeCapture(
      realPhotos.rgbSamples as FaceSamples,
      UNKNOWN,
      new Set(),
    );
    expect(result.colors).toBe(realTruth());
    expect(result.status).toBe("ready");
    expect(result.adjusted).toEqual([17]);
    expect(result.rotations).toEqual({});
  });

  it("preserves physical white/yellow names through the actual browser video and JPEG path", () => {
    const result = recognizeCapture(
      cameraRgb.samples as FaceSamples,
      UNKNOWN,
      new Set(),
      cameraRgb.evidence as unknown as CaptureEvidence,
    );
    expect(result.colors).toBe(realTruth());
    expect(result.status).toBe("ready");
  });

  it("never accepts a whole-class name swap after one-to-three-level center quantization changes", () => {
    const expected = realTruth();
    const cases: number[][] = [];
    for (const magnitude of [1, 2, 3]) {
      for (let mask = 0; mask < 64; mask++)
        cases.push(
          Array.from(
            { length: 6 },
            (_, axis) => (mask & (1 << axis) ? 1 : -1) * magnitude,
          ),
        );
      for (let axis = 0; axis < 6; axis++)
        for (const sign of [-1, 1])
          cases.push(
            Array.from({ length: 6 }, (_, i) =>
              i === axis ? sign * magnitude : 0,
            ),
          );
    }
    for (const changes of cases) {
      const samples = clone(cameraRgb.samples) as FaceSamples;
      const evidence = clone(cameraRgb.evidence) as unknown as CaptureEvidence;
      ["R", "L"].forEach((face, fi) => {
        samples[face as Face]![4] = samples[face as Face]![4].map(
          (value, axis) =>
            Math.max(0, Math.min(255, value + changes[fi * 3 + axis])),
        ) as RGB;
        evidence[face as Face]![4].rgb = samples[face as Face]![4];
      });
      const result = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
      if (result.status === "ready")
        expect(result.colors, `center changes: ${changes.join(",")}`).toBe(
          expected,
        );
      else expect(result.status).toBe("review");
    }
    expect(cases).toHaveLength(228);
  });

  it("does not override a manual color while resolving an ambiguous whole-class name", () => {
    const samples = clone(cameraRgb.samples) as FaceSamples;
    const evidence = clone(cameraRgb.evidence) as unknown as CaptureEvidence;
    samples.R![4][2] += 2;
    evidence.R![4].rgb = samples.R![4];
    const automatic = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(automatic.status).toBe("ready");
    expect(automatic.colors).toBe(realTruth());
    expect(automatic.adjusted).toContain(13);
    const manuallyEdited = realTruth().split("");
    manuallyEdited[0] = "D";
    const locked = recognizeCapture(
      samples,
      manuallyEdited.join(""),
      new Set([0]),
      evidence,
    );
    expect(locked.colors[0]).toBe("D");
    expect(locked.status).toBe("review");
  });

  it("requires physical-name evidence beyond two consistently different nearly neutral clusters", () => {
    const samples = clone(cameraRgb.samples) as FaceSamples;
    const evidence = clone(cameraRgb.evidence) as unknown as CaptureEvidence;
    const expected = realTruth();
    // Remove the clearer yellow regions while retaining the tiny white/yellow
    // difference, color counts, and a complete valid underlying cubie layout.
    FACES.forEach((face, fi) =>
      samples[face]!.forEach((_, cell) => {
        const color = expected[fi * 9 + cell];
        if (color !== "U" && color !== "D") return;
        const rgb: RGB = color === "U" ? [247, 253, 253] : [247, 251, 250];
        samples[face]![cell] = rgb;
        evidence[face]![cell] = {
          rgb,
          alternatives: [],
          coverage: 1,
          glare: 1,
          spread: 0,
        };
      }),
    );
    const result = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(result.status).toBe("review");
    expect(result.uncertain.length).toBeGreaterThanOrEqual(18);
  });

  it("reads all nine measured cells and never fills a missing face from cube rules", () => {
    const result = recognizeCapture(
      { U: samplesFor(SCRAMBLED).U },
      UNKNOWN,
      new Set(),
    );
    expect(result.colors.slice(0, 9)).toBe(SCRAMBLED.slice(0, 9));
    expect(result.colors.slice(9)).toBe("?".repeat(45));
    expect(result.status).toBe("incomplete");
    const lockedUnknown = recognizeCapture(
      samplesFor(SCRAMBLED),
      UNKNOWN,
      new Set([0]),
    );
    expect(lockedUnknown.colors[0]).toBe("?");
    expect(lockedUnknown.status).toBe("incomplete");
  });

  it("preserves explicit manual colors, including duplicate centers, and supports all-manual entry", () => {
    const edited = SCRAMBLED.split("");
    edited[0] = edited[0] === "R" ? "F" : "R";
    edited[13] = edited[4];
    const result = recognizeCapture(
      samplesFor(SCRAMBLED),
      edited.join(""),
      new Set([0, 4, 13]),
    );
    expect(result.colors[0]).toBe(edited[0]);
    expect(result.colors[4]).toBe(edited[4]);
    expect(result.colors[13]).toBe(edited[13]);
    expect(result.status).toBe("review");
    expect(result.rotations).toEqual({});
    const manual = recognizeCapture({}, SCRAMBLED, new Set());
    expect(manual.colors).toBe(SCRAMBLED);
    expect(manual.status).toBe("ready");
  });

  it("uses several colors to tolerate independent exposure and mild channel casts", () => {
    for (const { samples, expected } of generatedCases(
      80,
      275841,
      [0.86, 1.12],
    )) {
      const result = recognizeCapture(samples, UNKNOWN, new Set());
      expect(result.status).toBe("ready");
      expect(result.colors).toBe(expected);
    }
  });

  it("counts rejected harsh-exposure cases as failures instead of reporting acceptance-only accuracy", () => {
    let complete = 0;
    const cases = generatedCases(300, 91872, [0.72, 1.27]);
    for (const { samples, expected } of cases) {
      const result = recognizeCapture(samples, UNKNOWN, new Set());
      if (result.status === "ready") {
        expect(result.colors).toBe(expected);
        complete++;
      }
    }
    // A bounded synthetic regression floor, not an estimate for phone photos.
    expect(complete).toBeGreaterThanOrEqual(285);
    expect(cases.length).toBe(300);
  });

  it("repairs several image-supported color mistakes, rather than only the stored one-cell fixture", () => {
    const samples = samplesFor(SCRAMBLED);
    const indices = [...SCRAMBLED]
      .flatMap((color, i) => (color === "L" && i % 9 !== 4 ? [i] : []))
      .slice(0, 3);
    for (const index of indices)
      samples[FACES[Math.floor(index / 9)]]![index % 9] = REFERENCE.L.map(
        (value, axis) => value * 0.4 + REFERENCE.R[axis] * 0.6,
      ) as RGB;
    const result = recognizeCapture(samples, UNKNOWN, new Set());
    expect(result.status).toBe("ready");
    expect(result.colors).toBe(SCRAMBLED);
    expect(result.adjusted.length).toBeGreaterThan(1);
  });

  it("retains measured shadow-orange candidates across independent cube states and mild casts", () => {
    for (const { expected } of generatedCases(20, 457871, [1, 1])) {
      for (const orange of [
        [184, 43, 0],
        [196, 51, 0],
        [205, 63, 2],
        [175, 43, 2],
      ] as RGB[]) {
        const samples = shadowSamples(expected, orange, [117, 0, 0]);
        const result = recognizeCapture(samples, UNKNOWN, new Set());
        expect(result.status).toBe("ready");
        expect(result.colors).toBe(expected);
        for (const cast of [
          [1.04, 0.96, 1],
          [0.96, 1.04, 1],
        ]) {
          const tinted = Object.fromEntries(
            FACES.map((face) => [
              face,
              samples[face]!.map((rgb) =>
                rgb.map((v, axis) => Math.min(255, Math.round(v * cast[axis]))),
              ),
            ]),
          ) as FaceSamples;
          const candidate = recognizeCapture(tinted, UNKNOWN, new Set());
          // Unrecoverable tone changes stay review; structural legality may
          // not turn a newly wrong interpretation into an accepted result.
          if (candidate.status === "ready")
            expect(candidate.colors).toBe(expected);
          else expect(candidate.status).toBe("review");
        }
      }
    }
  });

  it("preserves manual shadow colors and refuses a low-quality shadow even if cube rules fit", () => {
    const samples = shadowSamples(SCRAMBLED, [184, 43, 0]);
    const index = [...SCRAMBLED].findIndex(
      (color, i) => color === "L" && i % 9 !== 4,
    );
    const edited = SCRAMBLED.split("");
    edited[index] = "R";
    const locked = recognizeCapture(samples, edited.join(""), new Set([index]));
    expect(locked.colors[index]).toBe("R");
    expect(locked.status).toBe("review");
    const evidence = evidenceFor(samples);
    evidence[FACES[Math.floor(index / 9)]]![index % 9].coverage = 0.2;
    const poor = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(poor.status).toBe("review");
    expect(poor.uncertain).toContain(index);
  });

  it("does not resolve physically ambiguous brown regions using color counts alone", () => {
    const samples = shadowSamples(SCRAMBLED, [184, 43, 0]);
    const evidence = evidenceFor(samples);
    // Both physical red/orange interpretations have observed pixel support.
    // A globally renamed cube remains structurally legal, so neither color
    // counts nor legality establish the physical color names.
    FACES.forEach((face, fi) =>
      samples[face]!.forEach((_, cell) => {
        const color = SCRAMBLED[fi * 9 + cell];
        if (color !== "R" && color !== "L") return;
        const rgb: RGB = [150, 70, 40];
        samples[face]![cell] = rgb;
        evidence[face]![cell] = {
          rgb,
          alternatives: [
            [154, 3, 5],
            [184, 43, 0],
          ],
          coverage: 1,
          glare: 0,
          spread: 17,
        };
      }),
    );
    expect(recognizeCapture(samples, UNKNOWN, new Set(), evidence).status).toBe(
      "review",
    );
  });

  it("uses supported center regions when a logo or glare contaminates the main center sample", () => {
    const samples = samplesFor(SCRAMBLED);
    samples.R![4] = [3, 3, 3];
    samples.F![4] = [253, 253, 253];
    const evidence = evidenceFor(samples);
    evidence.R![4].alternatives = [REFERENCE.R];
    evidence.F![4].alternatives = [REFERENCE.F];
    evidence.F![4].glare = 0.8;
    for (const face of FACES)
      evidence[face]!.forEach((cell, index) => {
        if (SCRAMBLED[FACES.indexOf(face) * 9 + index] === "U") cell.glare = 1;
      });
    const result = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(result.status).toBe("ready");
    expect(result.colors).toBe(SCRAMBLED);
  });

  it("recovers photo rotations as incremental clockwise turns without mutating inputs", () => {
    const turns = [1, 0, 2, 3, 1, 2];
    const original = samplesFor(SCRAMBLED);
    const samples = Object.fromEntries(
      FACES.map((face, fi) => [face, rotate(original[face]!, turns[fi])]),
    ) as FaceSamples;
    const evidence = evidenceFor(samples),
      before = clone({ samples, evidence });
    const result = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(result.status).toBe("ready");
    expect(result.colors).toBe(SCRAMBLED);
    expect(result.rotations).toEqual({ U: 3, F: 2, D: 1, L: 3, B: 2 });
    expect({ samples, evidence }).toEqual(before);
    const aligned = Object.fromEntries(
      FACES.map((face) => [
        face,
        rotate(samples[face]!, result.rotations[face] ?? 0),
      ]),
    ) as FaceSamples;
    expect(
      recognizeCapture(aligned, result.colors, new Set()).rotations,
    ).toEqual({});
    const lockedFace = recognizeCapture(
      samples,
      result.colors,
      new Set([4]),
      evidence,
    );
    expect(lockedFace.status).toBe("review");
    expect(lockedFace.rotations.U).toBeUndefined();
  });

  it("does not accept a legal result when the image evidence supports a second legal cube", () => {
    const alternative = applyAlgorithm(SOLVED, "R U' R U R U R U' R' U' R2");
    const samples = samplesFor(SOLVED),
      evidence = evidenceFor(samples);
    for (let i = 0; i < 54; i++)
      if (SOLVED[i] !== alternative[i])
        evidence[FACES[Math.floor(i / 9)]]![i % 9].alternatives = [
          REFERENCE[alternative[i] as Face],
        ];
    const result = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(result.status).toBe("review");
    expect(result.message).toContain("多个");
  });

  it("does not call a structurally legal but poorly observed cube ready", () => {
    const samples = samplesFor(SCRAMBLED),
      evidence = evidenceFor(samples);
    evidence.F![2].coverage = 0.2;
    evidence.D![3].spread = 40;
    const result = recognizeCapture(samples, UNKNOWN, new Set(), evidence);
    expect(result.colors).toBe(SCRAMBLED);
    expect(result.status).toBe("review");
    expect(result.uncertain).toEqual(expect.arrayContaining([20, 30]));
  });

  it("rejects duplicate photos, duplicate center measurements and severe loss of color information", () => {
    const repeated = samplesFor(SCRAMBLED);
    repeated.B = clone(repeated.U);
    expect(recognizeCapture(repeated, UNKNOWN, new Set()).status).toBe(
      "review",
    );
    const centers = samplesFor(SCRAMBLED);
    centers.R![4] = [...centers.U![4]];
    expect(recognizeCapture(centers, UNKNOWN, new Set()).status).toBe("review");
    const dark = Object.fromEntries(
      FACES.map((face) => [face, Array.from({ length: 9 }, () => [2, 2, 2])]),
    ) as FaceSamples;
    expect(recognizeCapture(dark, UNKNOWN, new Set()).status).toBe("review");
  });

  it("never recolors a contradictory high-confidence observation merely to obtain a legal cube", () => {
    const samples = samplesFor(SCRAMBLED),
      index = 0;
    samples.U![index] = [...REFERENCE[SCRAMBLED[index] === "B" ? "R" : "B"]];
    const result = recognizeCapture(samples, UNKNOWN, new Set());
    expect(result.status).toBe("review");
    expect(result.adjusted).toEqual([]);
  });

  it("rejects incomplete/nonfinite measurements before changing any caller data", () => {
    const original = samplesFor(SCRAMBLED),
      samples = clone(original);
    samples.F!.pop();
    expect(() => recognizeCapture(samples, UNKNOWN, new Set())).toThrow("九格");
    samples.F = clone(original.F);
    samples.R![2] = [NaN, 40, 50];
    expect(() => recognizeCapture(samples, UNKNOWN, new Set())).toThrow("九格");
    expect(() =>
      recognizeCapture({ U: new Array<RGB>(9) }, UNKNOWN, new Set()),
    ).toThrow("九格");
    expect(original).toEqual(samplesFor(SCRAMBLED));
  });
});
