import { FACES, normalizeColors, validateFacelets, type Face } from "./cube";

const clockwise = [6, 3, 0, 7, 4, 1, 8, 5, 2];
export type OrientationProposal =
  | { status: "unchanged" | "incomplete" | "none" | "ambiguous" }
  | {
      status: "unique";
      source: string;
      colors: string;
      rotations: Partial<Record<Face, number>>;
    };

/** Only rotates the nine recorded stickers of each face; never changes a color.
 * Distinct orientations of a symmetric face are the same proposal. */
export function proposeCaptureOrientation(colors: string): OrientationProposal {
  if (!/^[URFDLB]{54}$/.test(colors)) return { status: "incomplete" };
  let normalized: ReturnType<typeof normalizeColors>;
  try {
    normalized = normalizeColors(colors);
  } catch {
    return { status: "none" };
  }
  if (
    FACES.some(
      (face) => [...normalized.facelets].filter((c) => c === face).length !== 9,
    )
  )
    return { status: "none" };
  if (validateFacelets(normalized.facelets, normalized.palette).valid)
    return { status: "unchanged" };

  const variants = FACES.map((_, fi) => {
    let value = colors.slice(fi * 9, fi * 9 + 9);
    const found: { colors: string; turns: number }[] = [];
    for (let turns = 0; turns < 4; turns++) {
      if (!found.some((item) => item.colors === value))
        found.push({ colors: value, turns });
      value = clockwise.map((index) => value[index]).join("");
    }
    return found;
  });
  let best: Extract<OrientationProposal, { status: "unique" }> | undefined;
  let ambiguous = false;
  const turns = Array<number>(6).fill(0);
  function visit(fi: number, value: string) {
    if (ambiguous) return;
    if (fi === 6) {
      const candidate = normalizeColors(value);
      if (!validateFacelets(candidate.facelets, candidate.palette).valid)
        return;
      if (best) {
        ambiguous = true;
        return;
      }
      best = {
        status: "unique",
        source: colors,
        colors: value,
        rotations: Object.fromEntries(
          FACES.flatMap((face, index) =>
            turns[index] ? [[face, turns[index]]] : [],
          ),
        ),
      };
      return;
    }
    for (const variant of variants[fi]) {
      turns[fi] = variant.turns;
      visit(fi + 1, value + variant.colors);
      if (ambiguous) return;
    }
  }
  visit(0, "");
  return ambiguous ? { status: "ambiguous" } : (best ?? { status: "none" });
}
