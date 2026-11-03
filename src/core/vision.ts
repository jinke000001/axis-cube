import type { Face } from "./cube";
import { recognizeCapture } from "./vision-classifier";
export { classify, lab, REFERENCE } from "./vision-color";
export { recognizeCapture } from "./vision-classifier";
export type RGB = [number, number, number];
export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export type FaceSamples = Partial<Record<Face, RGB[]>>;

/** Compatibility surface for older callers; detailed consumers use recognizeCapture. */
export function classifyCapture(
  samples: FaceSamples,
  colors: string,
  locked: ReadonlySet<number>,
): { colors: string; uncertain: number[] } {
  const result = recognizeCapture(samples, colors, locked);
  return { colors: result.colors, uncertain: result.uncertain };
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
