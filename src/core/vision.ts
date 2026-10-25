import { FACES, type Face } from "./cube";
export type RGB = [number, number, number];
export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export const REFERENCE: Record<Face, RGB> = {
  U: [232, 232, 223],
  R: [216, 68, 53],
  F: [56, 155, 123],
  D: [238, 201, 77],
  L: [235, 141, 62],
  B: [67, 136, 203],
};
export function lab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047),
    y = f(r * 0.2126 + g * 0.7152 + b * 0.0722),
    z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function classify(
  rgb: RGB,
  references: Record<Face, RGB> = REFERENCE,
): { color: Face; confidence: number } {
  const a = lab(rgb);
  const distances = FACES.map((color) => {
    const b = lab(references[color]);
    return {
      color,
      distance: Math.sqrt(
        (a[0] - b[0]) ** 2 * 0.35 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
      ),
    };
  }).sort((a, b) => a.distance - b.distance);
  return {
    color: distances[0].color,
    confidence: Math.max(
      0,
      1 - distances[0].distance / Math.max(1, distances[1].distance),
    ),
  };
}

export type FaceSamples = Partial<Record<Face, RGB[]>>;

// The six fixed centers form a one-to-one color reference. Joint assignment
// prevents an overexposed yellow/orange center from replacing the white sample.
export function classifyCapture(
  samples: FaceSamples,
  colors: string,
  locked: ReadonlySet<number>,
): { colors: string; uncertain: number[] } {
  const centers: Partial<Record<Face, Face>> = {};
  for (const f of FACES) {
    if (!samples[f]) continue;
    const index = FACES.indexOf(f) * 9 + 4;
    centers[f] = locked.has(index)
      ? (colors[index] as Face)
      : classify(samples[f]![4]).color;
  }
  if (FACES.every((f) => samples[f])) {
    let bestCost = Infinity;
    let best: Face[] | undefined;
    const costs = FACES.map((f) => {
      const a = lab(samples[f]![4]);
      return FACES.map((c) => {
        const b = lab(REFERENCE[c]);
        return Math.hypot(
          (a[0] - b[0]) * Math.sqrt(0.35),
          a[1] - b[1],
          a[2] - b[2],
        );
      });
    });
    function assign(order: Face[], remaining: Face[], cost: number) {
      if (cost >= bestCost) return;
      if (!remaining.length) {
        bestCost = cost;
        best = order;
        return;
      }
      const index = order.length;
      for (const color of remaining) {
        if (locked.has(index * 9 + 4) && colors[index * 9 + 4] !== color)
          continue;
        assign(
          [...order, color],
          remaining.filter((f) => f !== color),
          cost + costs[index][FACES.indexOf(color)],
        );
      }
    }
    assign([], [...FACES], 0);
    if (best)
      FACES.forEach((f, i) => {
        centers[f] = best![i];
      });
  }
  const refs = { ...REFERENCE };
  for (const f of FACES) if (samples[f]) refs[centers[f]!] = samples[f]![4];
  const next = colors.split("");
  const uncertain: number[] = [];
  for (const f of FACES) {
    samples[f]?.forEach((rgb, cell) => {
      const index = FACES.indexOf(f) * 9 + cell;
      if (locked.has(index)) return;
      const result = classify(rgb, refs);
      next[index] = cell === 4 ? centers[f]! : result.color;
      if (
        cell === 4
          ? classify(rgb).color !== centers[f]
          : result.confidence < 0.3
      )
        uncertain.push(index);
    });
  }
  return { colors: next.join(""), uncertain };
}
export function homography(quad: Quad): (u: number, v: number) => Point {
  const matrix: number[][] = [];
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].forEach(([u, v], i) => {
    const [x, y] = quad[i];
    matrix.push(
      [u, v, 1, 0, 0, 0, -x * u, -x * v, x],
      [0, 0, 0, u, v, 1, -y * u, -y * v, y],
    );
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let r = i + 1; r < 8; r++)
      if (Math.abs(matrix[r][i]) > Math.abs(matrix[pivot][i])) pivot = r;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const scale = matrix[i][i];
    if (Math.abs(scale) < 1e-9)
      throw new Error("四个角点重叠，请重新框选魔方面。");
    for (let c = i; c <= 8; c++) matrix[i][c] /= scale;
    for (let r = 0; r < 8; r++)
      if (r !== i) {
        const factor = matrix[r][i];
        for (let c = i; c <= 8; c++) matrix[r][c] -= factor * matrix[i][c];
      }
  }
  const h = matrix.map((r) => r[8]);
  return (u, v) => {
    const d = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d];
  };
}
export function sampleFace(image: ImageData, quad: Quad): RGB[] {
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const signs = quad.map((a, i) =>
    cross(a, quad[(i + 1) % 4], quad[(i + 2) % 4]),
  );
  if (signs.some((s) => s <= 0))
    throw new Error("请按左上、右上、右下、左下排列四个角点。");
  const transform = homography(quad);
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3),
      col = i % 3,
      channels: [number[], number[], number[]] = [[], [], []];
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const [x, y] = transform(
          (col + 0.5 + a * 0.055) / 3,
          (row + 0.5 + b * 0.055) / 3,
        );
        const px = Math.round(x),
          py = Math.round(y);
        if (px < 0 || px >= image.width || py < 0 || py >= image.height)
          throw new Error("框选超出了照片范围，请调整角点。");
        const start = (py * image.width + px) * 4;
        for (let c = 0; c < 3; c++) channels[c].push(image.data[start + c]);
      }
    return channels.map((values) => {
      values.sort((a, b) => a - b);
      const mid = values.slice(5, -5);
      return Math.round(mid.reduce((a, b) => a + b, 0) / mid.length);
    }) as RGB;
  });
}
