import { FACES, type Face } from "./cube";
import type { RGB } from "./vision";

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
