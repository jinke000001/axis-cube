import type { Point, Quad, RGB } from "./vision";
import { lab } from "./vision-color";
import type { CellEvidence, FaceAnalysis } from "./vision-contract";
import { loadOpenCV, type CvMat, type OpenCV } from "./opencv-loader";

interface Sticker {
  center: Point;
  area: number;
  size: number;
  corners: Quad;
  shape: number;
  rectangularFill: number;
  region?: {
    outline: Point[];
    x: number;
    y: number;
    width: number;
    height: number;
    mask: Uint8Array;
  };
  kind: "quadrilateral" | "rounded-center" | "closed-boundary";
}
interface Grid {
  quad: Quad;
  score: number;
  residual: number;
  found: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const median = (values: number[]) => quantile(values, 0.5);
function quantile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ] ?? 0
  );
}
function area(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0),
    ) / 2
  );
}
function ordered(points: Point[]): Quad {
  const cx = points.reduce((s, p) => s + p[0], 0) / 4;
  const cy = points.reduce((s, p) => s + p[1], 0) / 4;
  const cyclic = [...points].sort(
    (a, b) =>
      Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
  let first = 0;
  for (let i = 1; i < 4; i++)
    if (cyclic[i][0] + cyclic[i][1] < cyclic[first][0] + cyclic[first][1])
      first = i;
  return Array.from({ length: 4 }, (_, i) => cyclic[(first + i) % 4]) as Quad;
}
/** Smallest enclosing parallelogram along observed boundary directions. Using
 * all boundary pixels keeps circles low-fill; allowing skew handles perspective
 * instead of judging a rotated rounded square by its axis-aligned rectangle. */
function orientedBounds(boundary: Point[], polygon: Point[]): Quad {
  const normals = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length],
      length = distance(p, q);
    return [-(q[1] - p[1]) / length, (q[0] - p[0]) / length] as Point;
  });
  const bounds = normals.map(([nx, ny]) => {
    const values = boundary.map(([x, y]) => x * nx + y * ny);
    return [Math.min(...values), Math.max(...values)] as Point;
  });
  let best: Quad | undefined,
    bestArea = Infinity;
  for (let i = 0; i < normals.length; i++)
    for (let j = i + 1; j < normals.length; j++) {
      const [ax, ay] = normals[i],
        [bx, by] = normals[j],
        d = ax * by - ay * bx;
      if (Math.abs(d) < 0.7) continue;
      const [minU, maxU] = bounds[i],
        [minV, maxV] = bounds[j];
      const boxArea = ((maxU - minU) * (maxV - minV)) / Math.abs(d);
      if (boxArea < bestArea) {
        bestArea = boxArea;
        best = ordered(
          [
            [minU, minV],
            [maxU, minV],
            [maxU, maxV],
            [minU, maxV],
          ].map(([u, v]) => [(u * by - v * ay) / d, (v * ax - u * bx) / d]),
        );
      }
    }
  // The input is convex, but retain a finite fallback for degenerate contours.
  if (best) return best;
  const xs = boundary.map((p) => p[0]),
    ys = boundary.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

function validateImage(image: ImageData) {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 32 ||
    image.height < 32 ||
    image.width * image.height > 20_000_000 ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new Error("照片尺寸或像素不完整，请重新选择原图。");
  }
}
function validateQuad(image: ImageData, quad: Quad) {
  if (
    quad.length !== 4 ||
    quad.some(
      (p) =>
        p.length !== 2 ||
        p.some((v) => !Number.isFinite(v)) ||
        p[0] < 0 ||
        p[1] < 0 ||
        p[0] >= image.width ||
        p[1] >= image.height,
    )
  )
    throw new Error("框选超出了照片，请把四角放在魔方面内。");
  const cross = quad.map((p, i) => {
    const q = quad[(i + 1) % 4],
      r = quad[(i + 2) % 4];
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
  });
  if (
    cross.some((v) => v <= 0) ||
    area(quad) < 30 * 30 ||
    quad.some((p, i) => distance(p, quad[(i + 1) % 4]) < 24)
  )
    throw new Error(
      "请按左上、右上、右下、左下框住完整九格，魔方面需要再大一些。",
    );
}
function rgbMedian(pixels: RGB[]): RGB {
  const middle = [0, 1, 2].map((c) => median(pixels.map((p) => p[c]))) as RGB;
  const ranked = pixels
    .map((rgb) => ({
      rgb,
      d: rgb.reduce((s, v, c) => s + (v - middle[c]) ** 2, 0),
    }))
    .sort((a, b) => a.d - b.d);
  const keep = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.7)));
  return [0, 1, 2].map((c) =>
    Math.round(keep.reduce((s, p) => s + p.rgb[c], 0) / keep.length),
  ) as RGB;
}
const saturation = (rgb: RGB) =>
  (Math.max(...rgb) - Math.min(...rgb)) / Math.max(1, Math.max(...rgb));
const lightness = (rgb: RGB) =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const labDistance = (a: RGB, b: RGB) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Dense, perspective-aware samples across each sticker's interior. */
export function sampleFaceDetailed(
  image: ImageData,
  quad: Quad,
): CellEvidence[] {
  validateImage(image);
  validateQuad(image, quad);
  const map = fitMap(
    (
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as Point[]
    ).map((uv, i) => ({ uv, xy: quad[i] })),
  );
  if (!map) throw new Error("四角不能组成有效的魔方面，请重新框选。");
  return Array.from({ length: 9 }, (_, cell) => {
    const row = Math.floor(cell / 3),
      col = cell % 3;
    const pixels: { rgb: RGB; region: number }[] = [];
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const [px, py] = map(
          (col + 0.17 + ((x + 0.5) * 0.66) / 32) / 3,
          (row + 0.17 + ((y + 0.5) * 0.66) / 32) / 3,
        );
        const ix = Math.round(px),
          iy = Math.round(py);
        if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height)
          throw new Error("取色范围超出照片，请调整框选。");
        const offset = (iy * image.width + ix) * 4;
        if (image.data[offset + 3] < 220) continue;
        pixels.push({
          rgb: [
            image.data[offset],
            image.data[offset + 1],
            image.data[offset + 2],
          ],
          region: (x >= 16 ? 1 : 0) + (y >= 16 ? 2 : 0),
        });
      }
    const lit = pixels.filter(
      ({ rgb }) => Math.max(...rgb) >= 38 && lightness(rgb) >= 20,
    );
    if (lit.length < 60)
      throw new Error(`第 ${cell + 1} 格没有足够可用颜色，请检查遮挡或框选。`);
    const saturated = lit.filter(({ rgb }) => saturation(rgb) > 0.16);
    const glare =
      lit.filter(({ rgb }) => Math.min(...rgb) > 230 && saturation(rgb) < 0.13)
        .length / Math.max(1, lit.length);
    // A colored population must have substantial spatial support before bright
    // neutral pixels can be treated as glare; white stickers otherwise survive.
    let selected =
      saturated.length >= lit.length * 0.22 && glare > 0.12 ? saturated : lit;
    const lows = quantile(
      selected.map(({ rgb }) => lightness(rgb)),
      0.1,
    );
    const highs = quantile(
      selected.map(({ rgb }) => lightness(rgb)),
      0.86,
    );
    selected = selected.filter(
      ({ rgb }) => lightness(rgb) >= lows && lightness(rgb) <= highs,
    );
    if (selected.length < 40) selected = lit;
    const rgb = rgbMedian(selected.map((p) => p.rgb));
    const centerLab = lab(rgb);
    const alternatives: RGB[] = [];
    for (let region = 0; region < 4; region++) {
      const part = selected.filter((p) => p.region === region);
      if (part.length < pixels.length * 0.14) continue;
      const candidate = rgbMedian(part.map((p) => p.rgb));
      if (
        labDistance(centerLab, lab(candidate)) > 3 &&
        alternatives.every((a) => labDistance(lab(a), lab(candidate)) > 3)
      )
        alternatives.push(candidate);
    }
    return {
      rgb,
      alternatives,
      coverage: lit.length / 1024,
      glare,
      spread: median(selected.map((p) => labDistance(centerLab, lab(p.rgb)))),
    };
  });
}

function contourStickers(
  cv: OpenCV,
  binary: CvMat,
  candidates: Sticker[],
  colorRegion = false,
) {
  const contours = new cv.MatVector(),
    hierarchy = new cv.Mat(),
    polygon = new cv.Mat();
  try {
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const total = binary.rows * binary.cols;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const a = cv.contourArea(contour);
        // A close-up facelet may occupy ~1/9 of a square photo. Do not impose
        // a camera-distance limit here; the complete grid constrains its size.
        if (a < Math.max(32, total * 0.00018)) continue;
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, polygon, perimeter * 0.035, true);
        if (polygon.rows < 4 || polygon.rows > 16) continue;
        const convex = cv.isContourConvex(polygon);
        const circularity = (4 * Math.PI * a) / (perimeter * perimeter);
        const kind: Sticker["kind"] =
          polygon.rows === 4 && convex
            ? "quadrilateral"
            : convex && polygon.rows <= 10 && circularity >= 0.78
              ? "rounded-center"
              : "closed-boundary";
        // Compact contours can support marked/rounded cells. Only quadrilaterals
        // and sufficiently rectangular convex rounded contours may anchor axes.
        // No missing cell is accepted merely because eight others predict it.
        const points = Array.from(
          { length: polygon.rows },
          (_, j) =>
            [polygon.data32S[j * 2], polygon.data32S[j * 2 + 1]] as Point,
        );
        const minX = Math.min(...points.map((p) => p[0])),
          maxX = Math.max(...points.map((p) => p[0])),
          minY = Math.min(...points.map((p) => p[1])),
          maxY = Math.max(...points.map((p) => p[1]));
        const boundary = Array.from(
          { length: contour.rows },
          (_, j) =>
            [contour.data32S[j * 2], contour.data32S[j * 2 + 1]] as Point,
        );
        const corners: Quad =
          kind === "rounded-center"
            ? orientedBounds(boundary, points)
            : kind !== "quadrilateral"
              ? [
                  [minX, minY],
                  [maxX, minY],
                  [maxX, maxY],
                  [minX, maxY],
                ]
              : ordered(points);
        const sides = corners.map((p, j) => distance(p, corners[(j + 1) % 4]));
        const smallest = Math.min(...sides),
          largest = Math.max(...sides);
        if (
          smallest < 7 ||
          largest / smallest > 2.7 ||
          area(corners) < a * 0.72
        )
          continue;
        const fill = Math.min(1, a / area(corners));
        const shape = (fill * smallest) / largest;
        if (shape < 0.35 || (kind === "closed-boundary" && fill < 0.65))
          continue;
        // Polygon simplification can omit a circle's extrema and overstate
        // its rectangular fill. Keep the actual contour bounds for deciding
        // whether a convex rounded shape may anchor the surrounding grid.
        let boundaryMinX = Infinity,
          boundaryMinY = Infinity,
          boundaryMaxX = -Infinity,
          boundaryMaxY = -Infinity;
        for (let point = 0; point < contour.rows; point++) {
          const x = contour.data32S[point * 2],
            y = contour.data32S[point * 2 + 1];
          boundaryMinX = Math.min(boundaryMinX, x);
          boundaryMaxX = Math.max(boundaryMaxX, x);
          boundaryMinY = Math.min(boundaryMinY, y);
          boundaryMaxY = Math.max(boundaryMaxY, y);
        }
        const rectangularFill =
          a /
          (kind === "rounded-center"
            ? area(corners)
            : Math.max(
                1,
                (boundaryMaxX - boundaryMinX) * (boundaryMaxY - boundaryMinY),
              ));
        // Rounded corners contribute uneven numbers of simplified vertices;
        // their average can move the grid origin despite unchanged boundaries.
        const center: Point =
          kind === "rounded-center"
            ? [
                corners.reduce((sum, p) => sum + p[0], 0) / 4,
                corners.reduce((sum, p) => sum + p[1], 0) / 4,
              ]
            : kind === "closed-boundary"
              ? [(minX + maxX) / 2, (minY + maxY) / 2]
              : [
                  points.reduce((s, p) => s + p[0], 0) / points.length,
                  points.reduce((s, p) => s + p[1], 0) / points.length,
                ];
        const candidate: Sticker = {
          center,
          area: a,
          size: Math.sqrt(a),
          corners,
          shape,
          rectangularFill,

          kind,
        };
        const duplicate = candidates.findIndex(
          (p) =>
            distance(p.center, center) <
              Math.min(p.size, candidate.size) * 0.22 &&
            Math.max(p.area, a) / Math.min(p.area, a) < 2.2,
        );
        const priority = {
          quadrilateral: 2,
          "rounded-center": 1,
          "closed-boundary": 0,
        };
        const previous = candidates[duplicate];
        // Existing edge-derived grid anchors remain usable despite highlights
        // splitting their hue mask; the fallback supplements missing regions.
        if (
          colorRegion &&
          previous &&
          !previous.region &&
          anchorsGrid(previous)
        )
          continue;
        if (
          previous &&
          !(
            priority[kind] > priority[previous.kind] ||
            (kind === previous.kind && shape > previous.shape)
          )
        )
          continue;
        if (colorRegion) {
          const x = boundaryMinX,
            y = boundaryMinY,
            width = boundaryMaxX - x + 1,
            height = boundaryMaxY - y + 1;
          const mask = new Uint8Array(width * height);
          for (let row = 0; row < height; row++)
            mask.set(
              binary.data.subarray(
                (y + row) * binary.cols + x,
                (y + row) * binary.cols + x + width,
              ),
              row * width,
            );
          candidate.region = { outline: points, x, y, width, height, mask };
        }
        if (duplicate < 0) candidates.push(candidate);
        else candidates[duplicate] = candidate;
      } finally {
        contour.delete();
      }
    }
  } finally {
    polygon.delete();
    hierarchy.delete();
    contours.delete();
  }
}

/** Preserve color boundaries and reconnect short breaks from specular seams. */
function colorBoundaryCandidates(
  cv: OpenCV,
  rgba: Uint8Array,
  width: number,
  height: number,
  channel: CvMat,
  blurred: CvMat,
  binary: CvMat,
  candidates: Sticker[],
) {
  // The fixed official runtime already exposes these morphology operations.
  const morphology = cv as OpenCV & {
    MORPH_RECT: number;
    MORPH_CLOSE: number;
    getStructuringElement(shape: number, size: unknown): CvMat;
    morphologyEx(
      source: CvMat,
      destination: CvMat,
      operation: number,
      kernel: CvMat,
    ): void;
  };
  const edges = new cv.Mat();
  try {
    for (const mode of ["brightness", "chroma"] as const) {
      const values = channel.data;
      for (let i = 0; i < width * height; i++) {
        const r = rgba[i * 4],
          g = rgba[i * 4 + 1],
          b = rgba[i * 4 + 2];
        values[i] =
          mode === "brightness"
            ? Math.max(r, g, b)
            : Math.max(r, g, b) - Math.min(r, g, b);
      }
      cv.GaussianBlur(channel, blurred, new cv.Size(3, 3), 0);
      // Keep the same edge sensitivity as the original luminance detector.
      cv.Canny(blurred, edges, 35, 90);
      for (const size of [3, 5]) {
        const kernel = morphology.getStructuringElement(
          morphology.MORPH_RECT,
          new cv.Size(size, size),
        );
        try {
          morphology.morphologyEx(
            edges,
            binary,
            morphology.MORPH_CLOSE,
            kernel,
          );
          contourStickers(cv, binary, candidates);
        } finally {
          kernel.delete();
        }
      }
    }
  } finally {
    edges.delete();
  }
}

/** Fallback for touching saturated facelets with similar brightness/chroma.
 * Overlapping hue bands preserve their color boundary. Opening removes thin
 * colored bridges through translucent seams, not missing facelet content. */
function colorRegionCandidates(
  cv: OpenCV,
  rgba: Uint8Array,
  width: number,
  height: number,
  binary: CvMat,
  candidates: Sticker[],
) {
  const hues = new Float32Array(width * height).fill(-1000);
  for (let i = 0; i < hues.length; i++) {
    const r = rgba[i * 4],
      g = rgba[i * 4 + 1],
      b = rgba[i * 4 + 2],
      high = Math.max(r, g, b),
      low = Math.min(r, g, b),
      delta = high - low;
    if (high < 45 || delta < high * 0.18) continue;
    const hue =
      high === r
        ? ((g - b) / delta + 6) % 6
        : high === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    hues[i] = hue * 60;
  }
  const morphology = cv as OpenCV & {
    MORPH_RECT: number;
    MORPH_OPEN: number;
    getStructuringElement(shape: number, size: unknown): CvMat;
    morphologyEx(
      source: CvMat,
      destination: CvMat,
      operation: number,
      kernel: CvMat,
    ): void;
  };
  const opened = new cv.Mat();
  const kernels = [3, 5].map((size) =>
    morphology.getStructuringElement(
      morphology.MORPH_RECT,
      new cv.Size(size, size),
    ),
  );
  try {
    for (let center = 0; center < 360; center += 15) {
      // Refresh after OpenCV allocations, which may grow the WASM heap.
      const mask = binary.data;
      for (let i = 0; i < hues.length; i++) {
        const difference = Math.abs(hues[i] - center);
        mask[i] =
          difference < 15 || (difference > 345 && difference < 360) ? 255 : 0;
      }
      contourStickers(cv, binary, candidates, true);
      for (const kernel of kernels) {
        morphology.morphologyEx(binary, opened, morphology.MORPH_OPEN, kernel);
        contourStickers(cv, opened, candidates, true);
      }
    }
  } finally {
    for (const kernel of kernels) kernel.delete();
    opened.delete();
  }
}

function insideOutline(points: Point[], [x, y]: Point) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i],
      [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** A connected seam can shift a color region's bounding-box center. Require
 * measured coverage of the predicted facelet's central 60%, rather than
 * substituting an inferred ninth color from the other eight. */
function observesInterior(
  sticker: Sticker,
  map: (u: number, v: number) => Point,
  uv: Point,
) {
  const region = sticker.region;
  if (!region) return false;
  // The outer contour alone can enclose a hole. Verify the original segmented
  // pixels too, including every sample inside the central facelet area.
  for (let row = -3; row <= 3; row++)
    for (let col = -3; col <= 3; col++) {
      const point = map(uv[0] + col / 30, uv[1] + row / 30);
      const x = Math.round(point[0]) - region.x,
        y = Math.round(point[1]) - region.y;
      if (
        !insideOutline(region.outline, point) ||
        x < 0 ||
        y < 0 ||
        x >= region.width ||
        y >= region.height ||
        !region.mask[y * region.width + x]
      )
        return false;
    }
  return true;
}

/** Least-squares projective map fitted to all observed sticker centers. */
function fitMap(pairs: { uv: Point; xy: Point }[]) {
  const a = Array.from({ length: 8 }, () => Array(9).fill(0) as number[]);
  for (const {
    uv: [u, v],
    xy: [x, y],
  } of pairs) {
    for (const row of [
      [u, v, 1, 0, 0, 0, -x * u, -x * v, x],
      [0, 0, 0, u, v, 1, -y * u, -y * v, y],
    ]) {
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 9; j++) a[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < 8; i++) {
    let p = i;
    for (let j = i + 1; j < 8; j++)
      if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j;
    [a[i], a[p]] = [a[p], a[i]];
    const d = a[i][i];
    if (Math.abs(d) < 1e-8) return null;
    for (let j = i; j < 9; j++) a[i][j] /= d;
    for (let r = 0; r < 8; r++)
      if (r !== i) {
        const s = a[r][i];
        for (let j = i; j < 9; j++) a[r][j] -= s * a[i][j];
      }
  }
  const h = a.map((row) => row[8]);
  return (u: number, v: number): Point => {
    const d = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d];
  };
}

/** Rounded squares may establish grid axes; circles (fill ≈ π/4) may not.
 * The oriented fill allows a small raster/perspective margin above a circle's
 * maximum fill. Aspect may vary with tilt; all nine observations, projective
 * residual, spacing and extra-row rejection must still pass. */
function anchorsGrid(sticker: Sticker) {
  return (
    sticker.kind === "quadrilateral" ||
    (sticker.kind === "rounded-center" &&
      sticker.shape >= 0.65 &&
      sticker.rectangularFill >= 0.82)
  );
}

function gridCandidates(
  stickers: Sticker[],
  width: number,
  height: number,
): Grid[] {
  const grids: Grid[] = [];
  for (const seed of stickers) {
    const neighbors = stickers
      .filter(
        (p) =>
          p !== seed &&
          anchorsGrid(p) &&
          p.size / seed.size > 0.48 &&
          p.size / seed.size < 2.1 &&
          distance(p.center, seed.center) > seed.size * 0.8 &&
          distance(p.center, seed.center) < seed.size * 2.2,
      )
      .sort(
        (a, b) =>
          distance(a.center, seed.center) - distance(b.center, seed.center),
      )
      .slice(0, 12);
    for (const right of neighbors)
      for (const down of neighbors) {
        if (right === down) continue;
        const u: Point = [
          right.center[0] - seed.center[0],
          right.center[1] - seed.center[1],
        ];
        const v: Point = [
          down.center[0] - seed.center[0],
          down.center[1] - seed.center[1],
        ];
        const ul = Math.hypot(...u),
          vl = Math.hypot(...v),
          pitch = (ul + vl) / 2;
        if (
          u[0] <= 0 ||
          v[1] <= 0 ||
          Math.abs(u[1]) > u[0] ||
          Math.abs(v[0]) > v[1] ||
          Math.abs(u[0] * v[0] + u[1] * v[1]) / ul / vl > 0.45 ||
          Math.max(ul, vl) / Math.min(ul, vl) > 1.9
        )
          continue;
        const pairs: { uv: Point; xy: Point; sticker: Sticker }[] = [];
        const used = new Set<Sticker>();
        for (let row = -1; row <= 1; row++)
          for (let col = -1; col <= 1; col++) {
            const target: Point = [
              seed.center[0] + u[0] * col + v[0] * row,
              seed.center[1] + u[1] * col + v[1] * row,
            ];
            let closest: Sticker | undefined,
              d = pitch * 0.31;
            for (const candidate of stickers) {
              if (!anchorsGrid(candidate) && (row !== 0 || col !== 0)) continue;
              const next = distance(target, candidate.center);
              if (
                next < d &&
                candidate.size / seed.size > 0.45 &&
                candidate.size / seed.size < 2.15 &&
                !used.has(candidate)
              ) {
                closest = candidate;
                d = next;
              }
            }
            if (closest) {
              used.add(closest);
              pairs.push({
                uv: [(col + 1.5) / 3, (row + 1.5) / 3],
                xy: closest.center,
                sticker: closest,
              });
            }
          }
        if (pairs.length < 8) continue;
        const map = fitMap(pairs);
        if (
          !map ||
          pairs.some(
            (p) => p.sticker.region && !observesInterior(p.sticker, map, p.uv),
          )
        )
          continue;
        let quad = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ].map(([x, y]) => map(x, y)) as Quad;
        if (quad.some((p) => p.some((n) => !Number.isFinite(n)))) continue;
        const residual =
          Math.sqrt(
            pairs.reduce((s, p) => s + distance(map(...p.uv), p.xy) ** 2, 0) /
              pairs.length,
          ) / pitch;
        if (residual > 0.1) continue;
        const sizes = pairs.map((p) => p.sticker.size),
          typical = median(sizes);
        const sizeSpread =
          median(sizes.map((s) => Math.abs(s - typical))) / typical;
        if (sizeSpread > 0.24) continue;
        const cover = typical / pitch;
        if (cover < 0.52 || cover > 1.03) continue;
        let supported = true;
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++) {
            const uv: Point = [(col + 0.5) / 3, (row + 0.5) / 3];
            if (pairs.some((p) => distance(p.uv, uv) < 0.01)) continue;
            const target = map(...uv);
            const support = stickers.find(
              (p) =>
                !used.has(p) &&
                (!p.region || observesInterior(p, map, uv)) &&
                (distance(p.center, target) < pitch * 0.22 ||
                  (!!p.region && distance(p.center, target) < pitch * 0.45)) &&
                p.size / typical >= 0.7 &&
                p.size / typical <= 1.4 &&
                p.shape >= 0.5 &&
                p.corners.every(
                  (point, i) =>
                    distance(point, p.corners[(i + 1) % 4]) <= pitch * 1.3,
                ),
            );
            if (!support) {
              supported = false;
              break;
            }
            used.add(support);
          }
        if (!supported) continue;
        // A complete 3×3 patch inside a larger board is not a cube face. Reject
        // an extra aligned row/column instead of choosing one of its sub-grids.
        const hasContinuation = (
          outsideRow: number | null,
          outsideCol: number | null,
        ) => {
          let matches = 0;
          for (let i = 0; i < 3; i++) {
            const target = map(
              ((outsideCol ?? i) + 0.5) / 3,
              ((outsideRow ?? i) + 0.5) / 3,
            );
            if (
              stickers.some(
                (p) =>
                  !used.has(p) &&
                  anchorsGrid(p) &&
                  distance(p.center, target) < pitch * 0.22 &&
                  p.size / typical >= 0.7 &&
                  p.size / typical <= 1.4,
              )
            )
              matches++;
          }
          return matches >= 2;
        };
        if (
          hasContinuation(-1, null) ||
          hasContinuation(3, null) ||
          hasContinuation(null, -1) ||
          hasContinuation(null, 3)
        )
          continue;
        const inFrame = (points: Quad) =>
          points.every(
            (p) => p[0] >= 0 && p[1] >= 0 && p[0] < width && p[1] < height,
          );
        if (!inFrame(quad)) {
          // Center spacing includes half a seam beyond the outermost facelets.
          // Remove only that measured virtual rim (plus contour pixel rounding),
          // never clamp an actually absent/truncated cell into the photograph.
          const inset = Math.max(0, (1 - cover) / 6) + 2 / (3 * pitch);
          quad = [
            [inset, inset],
            [1 - inset, inset],
            [1 - inset, 1 - inset],
            [inset, 1 - inset],
          ].map(([u, v]) => map(u, v)) as Quad;
          if (!inFrame(quad)) continue;
        }
        const score =
          (pairs.length / 9) * 0.6 +
          Math.max(0, 1 - residual / 0.1) * 0.18 +
          Math.max(0, 1 - sizeSpread / 0.24) * 0.12 +
          Math.min(1, area(quad) / (width * height * 0.16)) * 0.1;
        const duplicate = grids.findIndex(
          (g) =>
            g.quad.reduce((s, p, i) => s + distance(p, quad[i]), 0) / 4 <
            pitch * 0.3,
        );
        const value = { quad, score, residual, found: pairs.length };
        if (duplicate < 0) grids.push(value);
        else if (score > grids[duplicate].score) grids[duplicate] = value;
      }
  }
  return grids.sort((a, b) => b.score - a.score);
}

/** Restore detector coordinates using the actual, integer resize dimensions. */
export function rescaleDetectedQuad(
  quad: Quad,
  detectedSize: { width: number; height: number },
  originalSize: { width: number; height: number },
): Quad {
  return quad.map(([x, y]) => [
    (x * originalSize.width) / detectedSize.width,
    (y * originalSize.height) / detectedSize.height,
  ]) as Quad;
}

async function detectGrid(
  image: ImageData,
): Promise<{ grid?: Grid; alternatives: number }> {
  const cv = await loadOpenCV();
  const source = new cv.Mat(image.height, image.width, cv.CV_8UC4),
    small = new cv.Mat(),
    gray = new cv.Mat(),
    blur = new cv.Mat(),
    binary = new cv.Mat();
  try {
    source.data.set(image.data);
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    const width = Math.round(image.width * scale),
      height = Math.round(image.height * scale);
    cv.resize(source, small, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
    const stickers: Sticker[] = [];
    cv.Canny(blur, binary, 35, 90);
    contourStickers(cv, binary, stickers);
    for (const threshold of [45, 75, 105, 140, 180, 215]) {
      cv.threshold(blur, binary, threshold, 255, cv.THRESH_BINARY);
      contourStickers(cv, binary, stickers);
    }
    // Brightness in any channel keeps deep red/blue stickers distinct from
    // black seams that a grayscale threshold can merge with the sticker.
    const rgba = small.data,
      mask = binary.data;
    for (const threshold of [65, 110, 165, 215]) {
      for (let i = 0; i < width * height; i++) {
        const offset = i * 4;
        mask[i] =
          Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]) > threshold
            ? 255
            : 0;
      }
      contourStickers(cv, binary, stickers);
    }
    // On stickerless cubes the groove can be neutral and brighter than a
    // colored facelet. Chroma segmentation separates it without requiring black.
    for (let i = 0; i < width * height; i++) {
      const offset = i * 4,
        r = rgba[offset],
        g = rgba[offset + 1],
        b = rgba[offset + 2];
      mask[i] = Math.max(r, g, b) - Math.min(r, g, b) > 45 ? 255 : 0;
    }
    contourStickers(cv, binary, stickers);
    colorBoundaryCandidates(
      cv,
      rgba,
      width,
      height,
      gray,
      blur,
      binary,
      stickers,
    );
    let candidates = gridCandidates(
      stickers.sort((a, b) => b.shape - a.shape).slice(0, 160),
      width,
      height,
    );
    if (!candidates[0] || candidates[0].score < 0.79) {
      colorRegionCandidates(cv, rgba, width, height, binary, stickers);
      candidates = gridCandidates(
        stickers.sort((a, b) => b.shape - a.shape).slice(0, 160),
        width,
        height,
      );
    }
    const best = candidates[0];
    if (!best || best.score < 0.79) return { alternatives: candidates.length };
    if (
      candidates[1] &&
      candidates[1].score > best.score - 0.025 &&
      distance(candidates[1].quad[0], best.quad[0]) >
        Math.sqrt(area(best.quad)) * 0.45
    )
      return { alternatives: candidates.length };
    return {
      grid: {
        ...best,
        // Rounding the shorter resize dimension changes its scale. Reusing
        // the long-axis scale can turn an in-frame corner into an overflow.
        quad: rescaleDetectedQuad(best.quad, { width, height }, image),
      },
      alternatives: candidates.length,
    };
  } finally {
    binary.delete();
    blur.delete();
    gray.delete();
    small.delete();
    source.delete();
  }
}

export async function analyzeFace(
  image: ImageData,
  quad?: Quad,
): Promise<FaceAnalysis> {
  validateImage(image);
  let selected = quad;
  let confidence = 1;
  if (!selected) {
    const detected = await detectGrid(image);
    if (!detected.grid)
      return {
        quad: null,
        cells: [],
        confidence: 0,
        warnings: [
          detected.alternatives > 1
            ? "照片里有多个可能的九宫格，请框选要录入的一面。"
            : "没有找到完整九格，请框住魔方面，或让魔方更靠近镜头。",
        ],
        method: "grid",
      };
    selected = detected.grid.quad;
    confidence = detected.grid.score;
  }
  const cells = sampleFaceDetailed(image, selected);
  const warnings: string[] = [];
  if (cells.some((c) => c.coverage < 0.55))
    warnings.push("部分色块有遮挡或阴影，请核对当前面的九格。");
  if (cells.filter((c) => c.glare > 0.65).length > 2)
    warnings.push("这面有明显亮光，六面拍齐后会结合其他色块判断。");
  return {
    quad: selected,
    cells,
    confidence,
    warnings,
    method: quad ? "manual" : "grid",
  };
}
