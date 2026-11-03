import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  analyzeFace,
  rescaleDetectedQuad,
  sampleFaceDetailed,
} from "./vision-image";
import {
  homography,
  recognizeCapture,
  type FaceSamples,
  type Point,
  type Quad,
  type RGB,
} from "./vision";
import { FACES, type Face } from "./cube";
import type { CaptureEvidence } from "./vision-contract";
import { lab } from "./vision-color";
import {
  fixtureOpenCV,
  readFixturePng,
} from "../../tests/helpers/vision-fixtures";

const colors: RGB[] = [
  [235, 38, 40],
  [247, 247, 245],
  [28, 180, 75],
  [255, 135, 30],
  [24, 95, 225],
  [240, 219, 40],
  [28, 180, 75],
  [235, 38, 40],
  [247, 247, 245],
];
const delta = (a: RGB, b: RGB) =>
  Math.hypot(...lab(a).map((n, i) => n - lab(b)[i]));
function blank(width = 640, height = 520, rgb: RGB = [80, 91, 105]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}
function polygon(image: ImageData, quad: Point[], rgb: RGB) {
  const minX = Math.max(0, Math.floor(Math.min(...quad.map((p) => p[0])))),
    maxX = Math.min(
      image.width - 1,
      Math.ceil(Math.max(...quad.map((p) => p[0]))),
    );
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((p) => p[1])))),
    maxY = Math.min(
      image.height - 1,
      Math.ceil(Math.max(...quad.map((p) => p[1]))),
    );
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      if (
        quad.every((p, i) => {
          const q = quad[(i + 1) % quad.length];
          return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= 0;
        })
      )
        image.data.set([...rgb, 255], (y * image.width + x) * 4);
    }
}
function synthetic(
  quad: Quad,
  options: {
    logo?: boolean;
    glare?: boolean;
    stickerless?: boolean;
    monochrome?: boolean;
    center?: "round" | "missing";
    rounded?: number[];
    missing?: number;
  } = {},
) {
  const image = blank(),
    map = homography(quad);
  const rect = (u: number, v: number, w: number, h: number, rgb: RGB) =>
    polygon(
      image,
      [map(u, v), map(u + w, v), map(u + w, v + h), map(u, v + h)],
      rgb,
    );
  polygon(image, quad, options.stickerless ? [170, 172, 175] : [16, 18, 20]);
  for (let i = 0; i < 9; i++) {
    if (i === options.missing) continue;
    const row = Math.floor(i / 3),
      col = i % 3,
      inset = options.stickerless ? 0.015 : 0.065;
    const color = options.monochrome ? colors[1] : colors[i];
    if (i === 4 && options.center === "round") {
      polygon(
        image,
        Array.from({ length: 48 }, (_, point) => {
          const angle = (point * Math.PI * 2) / 48;
          return map(
            (col + 0.5 + 0.43 * Math.cos(angle)) / 3,
            (row + 0.5 + 0.43 * Math.sin(angle)) / 3,
          );
        }),
        color,
      );
    } else if (options.rounded?.includes(i)) {
      const radius = 0.4,
        span = 1 - 2 * inset;
      const points: Point[] = [];
      for (const [cx, cy, start] of [
        [1 - radius, radius, -90],
        [1 - radius, 1 - radius, 0],
        [radius, 1 - radius, 90],
        [radius, radius, 180],
      ]) {
        for (let step = 0; step <= 8; step++) {
          const angle = ((start + (step * 90) / 8) * Math.PI) / 180;
          points.push(
            map(
              (col + inset + span * (cx + radius * Math.cos(angle))) / 3,
              (row + inset + span * (cy + radius * Math.sin(angle))) / 3,
            ),
          );
        }
      }
      polygon(image, points, color);
    } else if (i !== 4 || options.center !== "missing") {
      rect(
        (col + inset) / 3,
        (row + inset) / 3,
        (1 - 2 * inset) / 3,
        (1 - 2 * inset) / 3,
        color,
      );
    }
    if (options.glare && i === 0)
      rect(
        (col + 0.17) / 3,
        (row + 0.17) / 3,
        0.39 / 3,
        0.66 / 3,
        [255, 255, 255],
      );
    if (options.logo && i === 4)
      rect((col + 0.37) / 3, (row + 0.37) / 3, 0.26 / 3, 0.26 / 3, [8, 8, 8]);
  }
  return image;
}

function regularGrid(
  count: number,
  size: number,
  missing = -1,
  rounded = false,
) {
  const image = blank(640, 640),
    pitch = size + 20;
  const start = (640 - count * pitch + 20) / 2;
  for (let cell = 0; cell < count * count; cell++) {
    if (cell === missing) continue;
    const x = start + (cell % count) * pitch,
      y = start + Math.floor(cell / count) * pitch;
    const corners: Point[] = [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ];
    const radius = size * 0.4;
    const roundedCorners = [
      [x + size - radius, y + radius, -90],
      [x + size - radius, y + size - radius, 0],
      [x + radius, y + size - radius, 90],
      [x + radius, y + radius, 180],
    ].flatMap(([cx, cy, start]) =>
      Array.from({ length: 9 }, (_, i) => {
        const angle = ((start + (i * 90) / 8) * Math.PI) / 180;
        return [
          cx + radius * Math.cos(angle),
          cy + radius * Math.sin(angle),
        ] as Point;
      }),
    );
    polygon(
      image,
      rounded ? roundedCorners : corners,
      colors[cell % colors.length],
    );
  }
  return image;
}

/** A colored seam joins the final facelet and moves its contour bounding-box
 * center. Geometry must use observed facelet content, not invent a ninth tile. */
function connectedSeamGrid(seamX: number, seamY: number, missing = false) {
  const image = synthetic(
    [
      [60, 50],
      [420, 50],
      [420, 410],
      [60, 410],
    ],
    { missing: 8 },
  );
  const rgb: RGB = [255, 105, 0],
    x = 300,
    y = 290,
    width = 110;
  if (!missing)
    polygon(
      image,
      [
        [x, y],
        [x + width, y],
        [x + width, y + width],
        [x, y + width],
      ],
      rgb,
    );
  polygon(
    image,
    [
      [x - seamX, y],
      [x + 1, y - seamY],
      [x + 1, y + 30],
    ],
    rgb,
  );
  return image;
}

beforeAll(fixtureOpenCV, 20_000);

describe("photo geometry and dense color evidence", () => {
  it.each([
    [20, 20],
    [25, 30],
    [30, 35],
  ])(
    "finds nine observed cells when a colored seam shifts one contour by %i/%i pixels",
    async (seamX, seamY) => {
      const result = await analyzeFace(connectedSeamGrid(seamX, seamY));
      expect(result.quad).not.toBeNull();
      expect(result.cells).toHaveLength(9);
      const expected: RGB[] = [...colors.slice(0, 8), [255, 105, 0]];
      result.cells.forEach((cell, index) =>
        expect(delta(cell.rgb, expected[index])).toBeLessThan(2),
      );
    },
  );
  it("does not let a connected colored seam stand in for a missing facelet", async () => {
    const result = await analyzeFace(connectedSeamGrid(25, 30, true));
    expect(result.quad).toBeNull();
    expect(result.cells).toHaveLength(0);
  });
  it("detects all six original photographs without preset boundaries and returns 54 finite colors", async () => {
    const annotation = JSON.parse(
      readFileSync("tests/fixtures/real-3x3/annotation.json", "utf8"),
    ) as { rgbSamples: Record<string, RGB[]>; faces: Record<string, string[]> };
    const samples: FaceSamples = {},
      evidence: CaptureEvidence = {};
    for (const face of ["F", "R", "B", "L", "U", "D"] as Face[]) {
      const image = readFixturePng(
        `tests/fixtures/real-3x3/rubiks-side-${face}.png`,
      );
      const result = await analyzeFace(image);
      samples[face] = result.cells.map((cell) => cell.rgb);
      evidence[face] = result.cells;
      expect(result.quad, face).not.toBeNull();
      expect(result.cells, face).toHaveLength(9);
      expect(result.confidence, face).toBeGreaterThan(0.85);
      for (const [i, cell] of result.cells.entries()) {
        expect(cell.rgb.every(Number.isFinite), `${face}${i}`).toBe(true);
        expect(cell.coverage, `${face}${i}`).toBeGreaterThan(0.8);
        expect(
          delta(cell.rgb, annotation.rgbSamples[face][i]),
          `${face}${i}`,
        ).toBeLessThan(12);
      }
      for (const [x, y] of result.quad!) {
        expect(x).toBeGreaterThan(650);
        expect(x).toBeLessThan(1360);
        expect(y).toBeGreaterThan(250);
        expect(y).toBeLessThan(950);
      }
    }
    const physical: Record<string, Face> = {
      W: "U",
      R: "R",
      G: "F",
      Y: "D",
      O: "L",
      B: "B",
    };
    const truth = FACES.flatMap((face) => annotation.faces[face])
      .join("")
      .split("")
      .map((color) => physical[color])
      .join("");
    const classified = recognizeCapture(
      samples,
      "?".repeat(54),
      new Set(),
      evidence,
    );
    expect(classified.status).toBe("ready");
    expect(classified.colors).toBe(truth);
  });
  it("finds a real face after the entire photograph is scaled, rotated and moved", async () => {
    const original = readFixturePng(
      "tests/fixtures/real-3x3/rubiks-side-L.png",
    );
    const image = blank(1100, 750),
      radians = (13 * Math.PI) / 180,
      scale = 0.42;
    const c = Math.cos(radians),
      s = Math.sin(radians);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const dx = (x - 550) / scale,
          dy = (y - 375) / scale;
        const ox = Math.round(dx * c + dy * s + original.width / 2),
          oy = Math.round(-dx * s + dy * c + original.height / 2);
        if (ox >= 0 && oy >= 0 && ox < original.width && oy < original.height)
          image.data.set(
            original.data.subarray(
              (oy * original.width + ox) * 4,
              (oy * original.width + ox) * 4 + 4,
            ),
            (y * image.width + x) * 4,
          );
      }
    const result = await analyzeFace(image),
      baseline = await analyzeFace(original);
    expect(result.cells).toHaveLength(9);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, baseline.cells[i].rgb)).toBeLessThan(7);
  });
  it("does not find a cube in the real photograph's machinery-only area", async () => {
    const original = readFixturePng(
      "tests/fixtures/real-3x3/rubiks-side-L.png",
    );
    const crop = blank(600, original.height);
    for (let y = 0; y < crop.height; y++)
      crop.data.set(
        original.data.subarray(
          y * original.width * 4,
          (y * original.width + crop.width) * 4,
        ),
        y * crop.width * 4,
      );
    expect((await analyzeFace(crop)).quad).toBeNull();
  });
  it.each<Quad>([
    [
      [90, 80],
      [470, 120],
      [490, 475],
      [60, 430],
    ],
    [
      [210, 85],
      [590, 25],
      [555, 390],
      [175, 440],
    ],
    [
      [120, 110],
      [430, 170],
      [500, 470],
      [50, 410],
    ],
  ])("fits perspective and shifted grids (%j)", async (...corners) => {
    const quad = corners as Quad;
    const result = await analyzeFace(synthetic(quad, { logo: true }));
    expect(result.quad).not.toBeNull();
    expect(result.cells).toHaveLength(9);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, colors[i])).toBeLessThan(3);
    for (let i = 0; i < 4; i++)
      expect(
        Math.hypot(
          result.quad![i][0] - quad[i][0],
          result.quad![i][1] - quad[i][1],
        ),
      ).toBeLessThan(30);
  });
  it("locates an observed circular center using the surrounding quadrilateral facelets", async () => {
    const quads: Quad[] = [
      [
        [100, 70],
        [490, 90],
        [480, 465],
        [95, 450],
      ],
      [
        [90, 80],
        [470, 120],
        [490, 475],
        [60, 430],
      ],
      [
        [210, 85],
        [590, 25],
        [555, 390],
        [175, 440],
      ],
    ];
    for (const quad of quads) {
      const image = synthetic(quad, { center: "round" });
      const result = await analyzeFace(image);
      expect(result.cells).toHaveLength(9);
      for (let i = 0; i < 9; i++)
        expect(delta(result.cells[i].rgb, colors[i]), `cell ${i}`).toBeLessThan(
          3,
        );
    }
  });
  it("accepts observed rounded edge facelets without treating them as center-only shapes", async () => {
    const quad: Quad = [
      [100, 70],
      [490, 70],
      [490, 460],
      [100, 460],
    ];
    const result = await analyzeFace(
      synthetic(quad, { rounded: [1, 3, 5, 7] }),
    );
    expect(result.cells).toHaveLength(9);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, colors[i]), `cell ${i}`).toBeLessThan(
        3,
      );
  });
  it.each<Quad>([
    [
      [120, 60],
      [500, 130],
      [450, 465],
      [70, 395],
    ],
    [
      [140, 100],
      [460, 65],
      [510, 440],
      [80, 455],
    ],
    [
      [190, 45],
      [530, 170],
      [405, 490],
      [65, 365],
    ],
  ])(
    "automatically fits rounded facelets when the phone or cube is tilted (%j)",
    async (...corners) => {
      const quad = corners as Quad;
      const result = await analyzeFace(
        synthetic(quad, { rounded: [0, 1, 2, 3, 4, 5, 6, 7, 8] }),
      );
      expect(result.cells).toHaveLength(9);
      for (let i = 0; i < 9; i++)
        expect(delta(result.cells[i].rgb, colors[i])).toBeLessThan(3);
      for (let i = 0; i < 4; i++)
        expect(
          Math.hypot(
            result.quad![i][0] - quad[i][0],
            result.quad![i][1] - quad[i][1],
          ),
        ).toBeLessThan(18);
    },
  );
  it("does not fill in any missing rounded facelet on a tilted face", async () => {
    const quad: Quad = [
      [120, 60],
      [500, 130],
      [450, 465],
      [70, 395],
    ];
    for (let missing = 0; missing < 9; missing++) {
      const result = await analyzeFace(
        synthetic(quad, { rounded: [0, 1, 2, 3, 4, 5, 6, 7, 8], missing }),
      );
      expect(result.quad, `missing ${missing}`).toBeNull();
      expect(result.cells, `missing ${missing}`).toHaveLength(0);
    }
  });
  it("locates an unevenly chamfered center independently of contour vertex density", async () => {
    // Generated polygons only: the center has four vertices near its upper
    // corners and two near the bottom. Their average is not its facelet center.
    const outlines: Point[][] = [
      [
        [187, 169],
        [189, 250],
        [108, 254],
        [110, 176],
      ],
      [
        [273, 168],
        [273, 241],
        [199, 245],
        [192, 171],
      ],
      [
        [279, 172],
        [356, 169],
        [364, 249],
        [283, 254],
      ],
      [
        [108, 262],
        [184, 282],
        [171, 345],
        [104, 344],
      ],
      [
        [209, 256],
        [192, 276],
        [197, 330],
        [266, 338],
        [277, 271],
        [256, 254],
      ],
      [
        [288, 264],
        [296, 340],
        [371, 340],
        [366, 255],
      ],
      [
        [187, 346],
        [189, 433],
        [103, 436],
        [101, 349],
      ],
      [
        [272, 354],
        [281, 432],
        [196, 434],
        [197, 362],
      ],
      [
        [369, 345],
        [282, 347],
        [286, 437],
        [373, 434],
      ],
    ];
    const image = blank(480, 640);
    outlines.forEach((points, i) => {
      const signedArea = points.reduce((sum, p, j) => {
        const q = points[(j + 1) % points.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0);
      polygon(
        image,
        signedArea < 0 ? [...points].reverse() : points,
        colors[i],
      );
    });
    const result = await analyzeFace(image);
    expect(result.cells).toHaveLength(9);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, colors[i]), `cell ${i}`).toBeLessThan(
        3,
      );
  });
  it("still rejects missing cells and extra rows beside rounded facelets", async () => {
    const quad: Quad = [
      [100, 70],
      [490, 70],
      [490, 460],
      [100, 460],
    ];
    for (const missing of [0, 4, 5]) {
      const image = synthetic(quad, { rounded: [1, 3, 5, 7], missing });
      expect((await analyzeFace(image)).quad, `missing ${missing}`).toBeNull();
    }
    expect((await analyzeFace(regularGrid(4, 120, -1, true))).quad).toBeNull();
  });
  it("rejects eight peripheral facelets without a center, a circle grid and an isolated circle", async () => {
    const quad: Quad = [
      [100, 70],
      [490, 90],
      [480, 465],
      [95, 450],
    ];
    const missing = synthetic(quad, { center: "missing" });
    const circles = blank(),
      isolated = blank();
    const drawCircle = (image: ImageData, x: number, y: number) =>
      polygon(
        image,
        Array.from(
          { length: 48 },
          (_, i) =>
            [
              x + Math.cos((i * Math.PI) / 24) * 40,
              y + Math.sin((i * Math.PI) / 24) * 40,
            ] as Point,
        ),
        colors[4],
      );
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++)
        drawCircle(circles, 170 + col * 110, 130 + row * 110);
    drawCircle(isolated, 320, 260);
    polygon(
      isolated,
      [
        [160, 100],
        [240, 100],
        [240, 180],
        [160, 180],
      ],
      colors[0],
    );
    polygon(
      isolated,
      [
        [400, 340],
        [480, 340],
        [480, 420],
        [400, 420],
      ],
      colors[1],
    );
    for (const image of [missing, circles, isolated]) {
      const result = await analyzeFace(image);
      expect(result.quad).toBeNull();
      expect(result.cells).toEqual([]);
    }
  });
  it("supports thin seams on a stickerless face and a plain solved white face", async () => {
    const quad: Quad = [
      [100, 70],
      [490, 90],
      [480, 465],
      [95, 450],
    ];
    for (const options of [{ stickerless: true }, { monochrome: true }]) {
      const result = await analyzeFace(synthetic(quad, options));
      expect(result.cells, JSON.stringify(options)).toHaveLength(9);
      for (let i = 0; i < 9; i++)
        expect(
          delta(
            result.cells[i].rgb,
            options.monochrome ? colors[1] : colors[i],
          ),
        ).toBeLessThan(3);
    }
  });
  it("removes strong localized glare and a center logo while retaining genuine white", async () => {
    const quad: Quad = [
        [80, 60],
        [500, 90],
        [480, 460],
        [70, 430],
      ],
      image = synthetic(quad, { logo: true, glare: true });
    const result = await analyzeFace(image, quad);
    expect(result.method).toBe("manual");
    expect(result.cells).toHaveLength(9);
    expect(result.cells[0].glare).toBeGreaterThan(0.5);
    expect(result.cells[4].coverage).toBeGreaterThan(0.75);
    const automatic = await analyzeFace(image);
    expect(automatic.cells).toHaveLength(9);
    expect(delta(automatic.cells[0].rgb, colors[0])).toBeLessThan(3);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, colors[i]), `cell ${i}`).toBeLessThan(
        3,
      );
  });
  it("rejects unrelated images, one large quadrilateral and an incomplete grid", async () => {
    const plain = blank(),
      rectangle = blank(),
      incomplete = synthetic([
        [90, 70],
        [490, 80],
        [480, 450],
        [80, 440],
      ]);
    polygon(
      rectangle,
      [
        [90, 70],
        [490, 80],
        [480, 450],
        [80, 440],
      ],
      colors[0],
    );
    polygon(
      incomplete,
      [
        [50, 300],
        [530, 300],
        [530, 490],
        [50, 490],
      ],
      [80, 91, 105],
    );
    for (const image of [plain, rectangle, incomplete]) {
      const result = await analyzeFace(image);
      expect(result.quad).toBeNull();
      expect(result.cells).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
  it("accepts a complete close-up whose individual facelets occupy over 6.5% of the photograph", async () => {
    const result = await analyzeFace(regularGrid(3, 170));
    expect(result.cells).toHaveLength(9);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, colors[i])).toBeLessThan(3);
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    "never fills missing cell %i from a lit background",
    async (missing) => {
      // Both the original-size regime and close-ups must reject absent cells.
      for (const size of [110, 170]) {
        const result = await analyzeFace(regularGrid(3, size, missing));
        expect(result.quad).toBeNull();
        expect(result.cells).toEqual([]);
      }
    },
  );
  it("rejects a larger regular board instead of selecting a 3 by 3 sub-grid", async () => {
    const result = await analyzeFace(regularGrid(4, 120));
    expect(result.quad).toBeNull();
    expect(result.cells).toEqual([]);
  });
  it("requires a real compact boundary for a center interrupted by a broad mark", async () => {
    const quad: Quad = [
      [100, 70],
      [490, 90],
      [480, 465],
      [95, 450],
    ];
    const image = synthetic(quad),
      map = homography(quad);
    polygon(
      image,
      [
        map(0.475, 0.333),
        map(0.525, 0.333),
        map(0.525, 0.46),
        map(0.475, 0.46),
      ],
      [16, 18, 20],
    );
    const result = await analyzeFace(image);
    expect(result.cells).toHaveLength(9);
    for (let i = 0; i < 9; i++)
      expect(delta(result.cells[i].rgb, colors[i])).toBeLessThan(3);
  });
  it.each([false, true])(
    "keeps rounded-resize boundary coordinates inside the original image (landscape=%s)",
    (landscape) => {
      // Actual Pixel input size after decoding is 1542×2048; the detector is
      // 482×640. The old shared .3125 factor maps x=481.95 to 1542.24.
      const source = landscape
        ? { width: 2048, height: 1542 }
        : { width: 1542, height: 2048 };
      const detected = landscape
        ? { width: 640, height: 482 }
        : { width: 482, height: 640 };
      const portrait: Quad = [
        [5, 80],
        [481.95, 80],
        [481.95, 620],
        [5, 620],
      ];
      const quad = landscape
        ? (portrait.map(([x, y]) => [y, x]).reverse() as Quad)
        : portrait;
      const restored = rescaleDetectedQuad(quad, detected, source);
      for (const [x, y] of restored) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(source.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(source.height);
      }
      const image = blank(source.width, source.height, colors[1]);
      expect(sampleFaceDetailed(image, restored)).toHaveLength(9);
    },
  );
  it("does not turn unusable or invalid manual regions into gray cells", async () => {
    const image = blank(500, 500, [0, 0, 0]),
      quad: Quad = [
        [50, 50],
        [450, 50],
        [450, 450],
        [50, 450],
      ];
    expect(() => sampleFaceDetailed(image, quad)).toThrow("没有足够可用颜色");
    await expect(
      analyzeFace(image, [[-5, 50], ...quad.slice(1)] as Quad),
    ).rejects.toThrow("超出了照片");
    await expect(
      analyzeFace(image, [quad[0], quad[2], quad[1], quad[3]]),
    ).rejects.toThrow("左上");
  });
});
