import {
  FACES,
  SLOTS,
  normalizeColors,
  validateFacelets,
  type Face,
} from "./cube";
import { lab, REFERENCE } from "./vision-color";
import type { FaceSamples, RGB } from "./vision";
import type {
  CaptureClassification,
  CaptureEvidence,
  CellEvidence,
} from "./vision-contract";

type Choice = { color: Face; cost: number };
type ColorModel = { center: RGB; pooled: RGB; hue?: number };
type Candidate = { colors: string; cost: number; turns: number[] };
const ROTATE = [6, 3, 0, 7, 4, 1, 8, 5, 2];
const MAX_COLOR_NODES = 60_000;
const MAX_ASSIGNMENTS = 96;
const MAX_ROTATION_NODES = 180_000;
const MAX_UNCERTAIN_CELLS = 14;
const ROTATION_COST = 4;

/** L has less influence than chroma, but is retained to distinguish dark/white. */
const distance = (a: RGB, b: RGB) =>
  Math.hypot((a[0] - b[0]) * Math.sqrt(0.35), a[1] - b[1], a[2] - b[2]);
const validRgb = (rgb: unknown): rgb is RGB =>
  Array.isArray(rgb) &&
  rgb.length === 3 &&
  Array.from(rgb).every(
    (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 255,
  );
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const centerOf = (values: RGB[]): RGB =>
  [0, 1, 2].map((axis) => median(values.map((v) => v[axis]))) as RGB;
const rank = (costs: number[]): Choice[] =>
  FACES.map((color, i) => ({ color, cost: costs[i] })).sort(
    (a, b) => a.cost - b.cost,
  );
const margin = (choices: Choice[]) =>
  Math.max(
    0,
    (choices[1].cost - choices[0].cost) / Math.max(0.001, choices[1].cost),
  );
const variants = (rgb: RGB, evidence?: CellEvidence): RGB[] => [
  rgb,
  ...(evidence?.alternatives ?? []).filter(validRgb).slice(0, 4),
];

/** Hue is only a secondary observation for saturated, well-lit pixels. It
 * ignores exposure, but cannot name neutral, near-black or badly mixed colors. */
function hueOf(rgb: RGB): number | undefined {
  const high = Math.max(...rgb),
    low = Math.min(...rgb),
    chroma = high - low;
  if (high < 60 || chroma < 40 || chroma / high < 0.45) return;
  const sector =
    high === rgb[0]
      ? (rgb[1] - rgb[2]) / chroma
      : high === rgb[1]
        ? 2 + (rgb[2] - rgb[0]) / chroma
        : 4 + (rgb[0] - rgb[1]) / chroma;
  return (sector * 60 + 360) % 360;
}
const hueDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;

function validateInputs(
  samples: FaceSamples,
  colors: string,
  evidence: CaptureEvidence,
) {
  if (!/^[URFDLB?]{54}$/.test(colors))
    throw new Error("录入草稿格式不完整，请重新选择当前面。");
  for (const face of FACES) {
    const values = samples[face];
    if (
      values &&
      (!Array.isArray(values) ||
        values.length !== 9 ||
        !Array.from(values).every(validRgb))
    )
      throw new Error("当前面没有取得完整的九格颜色，请保留照片并重新识别。");
    const cells = evidence[face];
    if (
      cells &&
      (!Array.isArray(cells) ||
        cells.length !== 9 ||
        Array.from(cells).some(
          (cell) =>
            !cell ||
            !validRgb(cell.rgb) ||
            !Array.isArray(cell.alternatives) ||
            cell.alternatives.length > 4 ||
            !cell.alternatives.every(validRgb) ||
            !Number.isFinite(cell.coverage) ||
            cell.coverage < 0 ||
            cell.coverage > 1 ||
            !Number.isFinite(cell.glare) ||
            cell.glare < 0 ||
            cell.glare > 1 ||
            !Number.isFinite(cell.spread) ||
            cell.spread < 0,
        ))
    )
      throw new Error("当前面的图像质量数据不完整，请重新识别。");
  }
}

/** A complete center assignment never merges two physical color classes. */
function matchCenters(
  samples: FaceSamples,
  colors: string,
  locked: ReadonlySet<number>,
  evidence: CaptureEvidence,
) {
  const refs = FACES.map((f) => lab(REFERENCE[f]));
  const centers = FACES.map((face, fi) => {
    if (locked.has(fi * 9 + 4)) return colors[fi * 9 + 4];
    const rgb = samples[face]?.[4];
    if (!rgb) return colors[fi * 9 + 4];
    return rank(refs.map((reference) => distance(lab(rgb), reference)))[0]
      .color;
  });
  if (!FACES.every((f) => samples[f])) return centers;
  const costs = FACES.map((face) =>
    refs.map((reference) =>
      Math.min(
        ...variants(samples[face]![4], evidence[face]?.[4]).map(
          // Squared costs preserve relative color order when both observed
          // centers lie on the same side of a washed-out reference pair.
          (rgb, i) => (distance(lab(rgb), reference) + (i ? 2 : 0)) ** 2,
        ),
      ),
    ),
  );
  let bestCost = Infinity;
  let best: Face[] | null = null;
  function visit(order: Face[], remaining: Face[], cost: number) {
    if (cost >= bestCost) return;
    if (!remaining.length) {
      bestCost = cost;
      best = [...order];
      return;
    }
    const fi = order.length;
    for (const color of remaining) {
      if (locked.has(fi * 9 + 4) && colors[fi * 9 + 4] !== color) continue;
      visit(
        [...order, color],
        remaining.filter((x) => x !== color),
        cost + costs[fi][FACES.indexOf(color)],
      );
    }
  }
  visit([], [...FACES], 0);
  return best ?? centers;
}

function fitModels(
  samples: FaceSamples,
  centers: string[],
  evidence: CaptureEvidence,
): Record<Face, ColorModel> {
  const models = Object.fromEntries(
    FACES.map((color) => [
      color,
      { center: lab(REFERENCE[color]), pooled: lab(REFERENCE[color]) },
    ]),
  ) as Record<Face, ColorModel>;
  const observedCenters: Partial<Record<Face, RGB>> = {};
  FACES.forEach((face, fi) => {
    const rgb = samples[face]?.[4];
    const color = centers[fi] as Face;
    if (rgb && FACES.includes(color)) {
      const reference = lab(REFERENCE[color]);
      const observed = variants(rgb, evidence[face]?.[4]);
      const selected = observed
        .map((value, i) => ({
          value,
          cost: distance(lab(value), reference) + (i ? 2 : 0),
        }))
        .sort((a, b) => a.cost - b.cost)[0].value;
      models[color] = { center: lab(selected), pooled: lab(selected) };
      observedCenters[color] = selected;
    }
  });
  const pool = Object.fromEntries(
    FACES.map((color) => [color, [] as RGB[]]),
  ) as Record<Face, RGB[]>;
  const huePool = Object.fromEntries(
    FACES.map((color) => [color, [] as { face: Face; hue: number }[]]),
  ) as Record<Face, { face: Face; hue: number }[]>;
  // Learn from clear non-center observations. A doubtful center is not allowed to
  // drag every other sticker toward its exposure, nor can ambiguous pixels train themselves.
  for (const face of FACES)
    samples[face]?.forEach((rgb, cell) => {
      if (cell === 4 || (evidence[face]?.[cell]?.coverage ?? 1) < 0.5) return;
      const v = lab(rgb);
      const ranked = rank(
        FACES.map((color) => distance(v, models[color].center)),
      );
      if (
        margin(ranked) >= 0.45 &&
        ranked[0].cost <= Math.max(10, ranked[1].cost * 0.5)
      ) {
        pool[ranked[0].color].push(v);
        const hue = hueOf(rgb),
          quality = evidence[face]?.[cell];
        if (
          hue !== undefined &&
          (!quality || (quality.coverage >= 0.65 && quality.spread <= 18))
        )
          huePool[ranked[0].color].push({ face, hue });
      }
    });
  for (const color of FACES) {
    if (pool[color].length >= 3) models[color].pooled = centerOf(pool[color]);
    const center = observedCenters[color],
      centerHue = center && hueOf(center);
    if (centerHue === undefined) continue;
    const points = huePool[color];
    if (points.length < 3 || new Set(points.map((p) => p.face)).size < 2)
      continue;
    const deviations = points.map((p) => hueDelta(p.hue, centerHue));
    const middle = median(deviations);
    // Require agreement with the observed center and a compact majority of
    // independently measured stickers, not a reference-table hue assumption.
    if (
      Math.abs(middle) <= 10 &&
      median(deviations.map((d) => Math.abs(d - middle))) <= 6
    )
      models[color].hue = (centerHue + middle + 360) % 360;
  }
  return models;
}

function shadowAlternatives(
  rgb: RGB,
  primary: Face,
  models: Record<Face, ColorModel>,
  quality?: CellEvidence,
): Face[] {
  if (quality && (quality.coverage < 0.65 || quality.spread > 18)) return [];
  const hue = hueOf(rgb),
    primaryHue = models[primary].hue;
  if (hue === undefined || primaryHue === undefined) return [];
  const primaryGap = Math.abs(hueDelta(hue, primaryHue)),
    lightness = lab(rgb)[0];
  return FACES.filter((color) => {
    const target = models[color],
      targetHue = target.hue;
    if (
      color === primary ||
      targetHue === undefined ||
      lightness > target.pooled[0] - 8
    )
      return false;
    const gap = Math.abs(hueDelta(hue, targetHue));
    return (
      gap <= 12 &&
      gap < primaryGap &&
      Math.abs(hueDelta(targetHue, primaryHue)) >= 12
    );
  });
}

function score(
  rgb: RGB,
  models: Record<Face, ColorModel>,
  evidence?: CellEvidence,
): Choice[] {
  const observed = variants(rgb, evidence).map(lab);
  return rank(
    FACES.map((color) => {
      const model = models[color];
      // Alternatives have substantial pixel support. Their order alone cannot
      // establish which color is real; a competing legal interpretation must remain ambiguous.
      return Math.min(
        ...observed.map((v) => {
          const a = distance(v, model.center),
            b = distance(v, model.pooled);
          return 0.65 * Math.min(a, b) + 0.35 * b;
        }),
      );
    }),
  );
}

/** Estimate only gains supported by several shared, confidently matched colors.
 * A cube photograph is not a gray card. Clipped channels and single-color fits
 * cannot establish a color cast, so they never supply a gain estimate.
 */
function calibrateLighting(
  samples: FaceSamples,
  centers: string[],
  evidence: CaptureEvidence,
) {
  if (!FACES.every((face) => samples[face])) return { samples, evidence };
  const models = fitModels(samples, centers, evidence);
  const anchors: { face: Face; rgb: RGB; color: Face }[] = [];
  for (const face of FACES)
    samples[face]?.forEach((rgb, cell) => {
      if ((evidence[face]?.[cell]?.coverage ?? 1) < 0.65) return;
      const ranked = score(rgb, models);
      if (margin(ranked) > 0.65 && ranked[0].cost < 22)
        anchors.push({ face, rgb, color: ranked[0].color });
    });
  const groups = FACES.flatMap((face) =>
    FACES.flatMap((color) => {
      const values = anchors.filter(
        (a) => a.face === face && a.color === color,
      );
      return values.length
        ? [{ face, color, rgb: centerOf(values.map((a) => a.rgb)) }]
        : [];
    }),
  );
  // Fit exposure and color balance jointly, so a color appearing mostly on one
  // bright face does not become the illumination target for every other face.
  const gainsByChannel = [0, 1, 2].map((axis) => {
    const usable = groups.filter((g) => g.rgb[axis] > 25 && g.rgb[axis] < 240);
    const shared = usable.filter(
      (g) => usable.filter((v) => v.color === g.color).length >= 2,
    );
    const supported = FACES.filter(
      (face) => shared.filter((g) => g.face === face).length >= 2,
    );
    const points = shared.filter((g) => supported.includes(g.face));
    const offset = Object.fromEntries(FACES.map((f) => [f, 0])) as Record<
      Face,
      number
    >;
    const reflectance = Object.fromEntries(
      FACES.map((color) => {
        const values = points
          .filter((g) => g.color === color)
          .map((g) => Math.log(g.rgb[axis]));
        return [color, values.length ? median(values) : 0];
      }),
    ) as Record<Face, number>;
    for (let iteration = 0; iteration < 8; iteration++) {
      for (const face of supported)
        offset[face] = median(
          points
            .filter((g) => g.face === face)
            .map((g) => reflectance[g.color] - Math.log(g.rgb[axis])),
        );
      const origin = supported.length
        ? median(supported.map((f) => offset[f]))
        : 0;
      for (const face of supported) offset[face] -= origin;
      for (const color of FACES) {
        const values = points
          .filter((g) => g.color === color)
          .map((g) => Math.log(g.rgb[axis]) + offset[g.face]);
        if (values.length) reflectance[color] = median(values);
      }
    }
    return Object.fromEntries(
      FACES.map((face) => {
        const residuals = points
          .filter((g) => g.face === face)
          .map((g) =>
            Math.abs(
              Math.log(g.rgb[axis]) + offset[face] - reflectance[g.color],
            ),
          );
        return [
          face,
          supported.includes(face) && median(residuals) < 0.1
            ? Math.max(0.7, Math.min(1.45, Math.exp(offset[face])))
            : null,
        ];
      }),
    ) as Record<Face, number | null>;
  });
  const corrected: FaceSamples = {},
    details: CaptureEvidence = {};
  for (const face of FACES) {
    const gains = gainsByChannel.map((channel) => channel[face]);
    // An incomplete channel fit can invent a hue; keep the original in that case.
    const usable =
      gains.every((g) => g !== null) &&
      Math.max(...(gains as number[])) / Math.min(...(gains as number[])) < 1.2;
    const adjust = (rgb: RGB): RGB => {
      if (
        !usable ||
        (Math.max(...rgb) > 247 && Math.max(...rgb) - Math.min(...rgb) < 25)
      )
        return [...rgb];
      return rgb.map((value, axis) =>
        Math.min(255, Math.max(0, value * gains[axis]!)),
      ) as RGB;
    };
    corrected[face] = samples[face]!.map(adjust);
    if (evidence[face])
      details[face] = evidence[face]!.map((cell) => ({
        ...cell,
        rgb: adjust(cell.rgb),
        alternatives: cell.alternatives.map(adjust),
      }));
  }
  return { samples: corrected, evidence: details };
}

function hasDuplicateFace(samples: FaceSamples): number[] {
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      if (!samples[FACES[a]] || !samples[FACES[b]]) continue;
      const first = samples[FACES[a]]!.map(lab);
      let second = samples[FACES[b]]!.map(lab);
      for (let turn = 0; turn < 4; turn++) {
        // Tight measurement identity detects repeated input without calling similar
        // centers duplicates; white/yellow centers can legitimately be very close.
        if (first.every((v, i) => distance(v, second[i]) < 0.4)) return [a, b];
        second = ROTATE.map((i) => second[i]);
      }
    }
  return [];
}

function balancedAssignments(inputChoices: Choice[][], maxCost = Infinity) {
  const choices = inputChoices.map((options) =>
    options.filter((choice) => choice.cost - options[0].cost <= maxCost),
  );
  const fixed = Array<string>(54).fill("");
  const counts = Array<number>(6).fill(0);
  const variables: number[] = [];
  choices.forEach((options, i) => {
    if (options.length === 1) {
      fixed[i] = options[0].color;
      counts[FACES.indexOf(options[0].color)]++;
    } else variables.push(i);
  });
  if (variables.length > MAX_UNCERTAIN_CELLS)
    return {
      assignments: [] as { colors: string; cost: number }[],
      limited: true,
    };
  variables.sort((a, b) => choices[a].length - choices[b].length);
  const remaining = Array.from({ length: variables.length + 1 }, () =>
    Array<number>(6).fill(0),
  );
  for (let at = variables.length - 1; at >= 0; at--) {
    remaining[at] = [...remaining[at + 1]];
    for (const choice of choices[variables[at]])
      remaining[at][FACES.indexOf(choice.color)]++;
  }
  let nodes = 0,
    limited = false;
  const assignments: { colors: string; cost: number }[] = [];
  function visit(at: number, cost: number) {
    if (cost > maxCost) return;
    if (++nodes > MAX_COLOR_NODES || assignments.length >= MAX_ASSIGNMENTS) {
      limited = true;
      return;
    }
    if (
      counts.some(
        (count, color) => count > 9 || count + remaining[at][color] < 9,
      )
    )
      return;
    if (at === variables.length) {
      assignments.push({ colors: fixed.join(""), cost });
      return;
    }
    const index = variables[at];
    for (const choice of choices[index]) {
      const color = FACES.indexOf(choice.color);
      if (counts[color] >= 9) continue;
      counts[color]++;
      fixed[index] = choice.color;
      visit(at + 1, cost + choice.cost - choices[index][0].cost);
      counts[color]--;
      if (limited) return;
    }
  }
  visit(0, 0);
  return { assignments: assignments.sort((a, b) => a.cost - b.cost), limited };
}

// Derive cubie membership from the existing geometry instead of a second table
// of corner/edge indices. Final orientation and parity remain cube.ts's concern.
const GROUPS = [
  ...SLOTS.reduce((map, slot) => {
    const key = slot.position.join(",");
    const group = map.get(key) ?? [];
    group.push(slot.index);
    map.set(key, group);
    return map;
  }, new Map<string, number[]>()).values(),
].filter((group) => group.length > 1);
const CLOSING_GROUPS = FACES.map((_, fi) =>
  GROUPS.filter(
    (group) => Math.max(...group.map((index) => Math.floor(index / 9))) === fi,
  ),
);

function legalCandidates(
  assignments: { colors: string; cost: number }[],
  centers: string[],
  locked: ReadonlySet<number>,
  samples: FaceSamples,
) {
  const allowed = [new Set<string>(), new Set<string>()];
  for (const group of GROUPS)
    allowed[group.length - 2].add(
      group
        .map((index) => centers[Math.floor(index / 9)])
        .sort()
        .join(""),
    );
  let best: Candidate | undefined, runner: Candidate | undefined;
  let nodes = 0,
    limited = false;
  function retain(candidate: Candidate) {
    if (best?.colors === candidate.colors) {
      if (candidate.cost < best.cost) best = candidate;
      return;
    }
    if (!best || candidate.cost < best.cost) {
      runner = best;
      best = candidate;
      return;
    }
    if (!runner || candidate.cost < runner.cost) runner = candidate;
  }
  for (const assignment of assignments) {
    if (runner && assignment.cost > runner.cost) break;
    const faces = FACES.map((_, fi) => {
      const variants: { text: string; turns: number }[] = [];
      let value = assignment.colors.slice(fi * 9, fi * 9 + 9);
      const canRotate =
        !!samples[FACES[fi]] &&
        !Array.from({ length: 9 }, (_, cell) => fi * 9 + cell).some((index) =>
          locked.has(index),
        );
      for (let turns = 0; turns < (canRotate ? 4 : 1); turns++) {
        if (!variants.some((variant) => variant.text === value))
          variants.push({ text: value, turns });
        value = ROTATE.map((i) => value[i]).join("");
      }
      return variants.sort(
        (a, b) =>
          Math.min(a.turns, 4 - a.turns) - Math.min(b.turns, 4 - b.turns),
      );
    });
    const value = Array<string>(54),
      turns = Array<number>(6).fill(0);
    const used = [new Set<string>(), new Set<string>()];
    function visit(fi: number, cost: number) {
      if (++nodes > MAX_ROTATION_NODES) {
        limited = true;
        return;
      }
      if (runner && cost > runner.cost) return;
      if (fi === 6) {
        const colors = value.join("");
        try {
          const normalized = normalizeColors(colors);
          if (validateFacelets(normalized.facelets, normalized.palette).valid)
            retain({ colors, cost, turns: [...turns] });
        } catch {
          /* Invalid centers are reported by the caller. */
        }
        return;
      }
      for (const variant of faces[fi]) {
        for (let cell = 0; cell < 9; cell++)
          value[fi * 9 + cell] = variant.text[cell];
        const additions: { kind: number; key: string }[] = [];
        let valid = true;
        for (const group of CLOSING_GROUPS[fi]) {
          const kind = group.length - 2,
            key = group
              .map((index) => value[index])
              .sort()
              .join("");
          if (!allowed[kind].has(key) || used[kind].has(key)) {
            valid = false;
            break;
          }
          used[kind].add(key);
          additions.push({ kind, key });
        }
        turns[fi] = variant.turns;
        if (valid)
          visit(
            fi + 1,
            cost + ROTATION_COST * Math.min(variant.turns, 4 - variant.turns),
          );
        for (const { kind, key } of additions) used[kind].delete(key);
        if (limited) return;
      }
    }
    visit(0, assignment.cost);
    if (limited) break;
  }
  return { best, runner, limited };
}

function rotateIndex(index: number, turns: number) {
  let local = index % 9;
  for (let t = 0; t < turns; t++) local = ROTATE.indexOf(local);
  return Math.floor(index / 9) * 9 + local;
}

/** Cubie validity is invariant to a global renaming of physical colors.
 * Recheck close center classes using their original non-center observations,
 * independently of cube rules and of the exposure correction learned above.
 */
function resolveCloseColorNames(
  candidate: Candidate,
  samples: FaceSamples,
  evidence: CaptureEvidence,
  locked: ReadonlySet<number>,
  centers: string[],
  models: Record<Face, ColorModel>,
): { colors: string; uncertain: number[] } {
  const weighted = (value: RGB): RGB => [
    value[0] * Math.sqrt(0.35),
    value[1],
    value[2],
  ];
  const centerIsManual = (color: Face) =>
    centers.some((c, fi) => c === color && locked.has(fi * 9 + 4));
  const pairs = FACES.flatMap((a, i) =>
    FACES.slice(i + 1).flatMap((b) =>
      distance(models[a].center, models[b].center) < 10 &&
      !centerIsManual(a) &&
      !centerIsManual(b)
        ? [[a, b] as const]
        : [],
    ),
  );
  let colors = candidate.colors;
  const uncertain = new Set<number>();
  for (const [a, b] of pairs) {
    const affected = FACES.flatMap((face, fi) =>
      (samples[face] ?? []).flatMap((_, cell) => {
        const source = fi * 9 + cell;
        const color = colors[rotateIndex(source, candidate.turns[fi])];
        return (color === a || color === b) && !locked.has(source)
          ? [source]
          : [];
      }),
    );
    // Three overlapping classes need more evidence than a pairwise name swap.
    if (
      pairs.some(
        ([c, d]) =>
          (c !== a || d !== b) && [c, d].some((x) => x === a || x === b),
      )
    ) {
      affected.forEach((index) => uncertain.add(index));
      continue;
    }
    const first = weighted(lab(REFERENCE[a])),
      second = weighted(lab(REFERENCE[b]));
    const delta = second.map((v, axis) => v - first[axis]) as RGB;
    const length = Math.hypot(...delta);
    const points = FACES.flatMap((face, fi) =>
      (samples[face] ?? []).flatMap((rgb, cell) => {
        const source = fi * 9 + cell;
        const color = colors[rotateIndex(source, candidate.turns[fi])];
        const quality = evidence[face]?.[cell];
        if (
          cell === 4 ||
          locked.has(source) ||
          (color !== a && color !== b) ||
          (quality && (quality.coverage < 0.65 || quality.spread > 18))
        )
          return [];
        const value = weighted(lab(rgb));
        return [
          {
            face,
            color,
            projection: value.reduce(
              (sum, v, axis) => sum + (v * delta[axis]) / length,
              0,
            ),
            spread: quality?.spread ?? 0,
          },
        ];
      }),
    );
    const groupA = points.filter((p) => p.color === a),
      groupB = points.filter((p) => p.color === b);
    const withinFace = FACES.flatMap((face) => {
      const aa = groupA.filter((p) => p.face === face),
        bb = groupB.filter((p) => p.face === face);
      return aa.length && bb.length
        ? [
            median(bb.map((p) => p.projection)) -
              median(aa.map((p) => p.projection)),
          ]
        : [];
    });
    const supported = (reverse: boolean) => {
      const lower = reverse ? groupB : groupA,
        upper = reverse ? groupA : groupB;
      if (lower.length < 4 || upper.length < 4) return false;
      const lowerMiddle = median(lower.map((p) => p.projection));
      const upperMiddle = median(upper.map((p) => p.projection));
      const differences = withinFace.map((value) => (reverse ? -value : value));
      // A consistent tiny JPEG difference alone cannot establish a physical name.
      // Require a clearer original region as well as agreement across photographs.
      return (
        upperMiddle - lowerMiddle > 0.25 &&
        differences.filter((value) => value > 0.25).length >= 2 &&
        !differences.some((value) => value < -0.25) &&
        (upper.some(
          (p) => p.projection - lowerMiddle > Math.max(3, p.spread * 2),
        ) ||
          lower.some(
            (p) => upperMiddle - p.projection > Math.max(3, p.spread * 2),
          ))
      );
    };
    if (supported(false)) continue;
    const hasManualMember = [...locked].some((index) => {
      const color =
        colors[rotateIndex(index, candidate.turns[Math.floor(index / 9)] ?? 0)];
      return color === a || color === b;
    });
    if (supported(true) && !hasManualMember) {
      colors = [...colors]
        .map((color) => (color === a ? b : color === b ? a : color))
        .join("");
    } else affected.forEach((index) => uncertain.add(index));
  }
  return { colors, uncertain: [...uncertain] };
}

/**
 * Returns a measured provisional state even when review is required. The status
 * is essential: structural validity alone is never permission to accept it.
 * All automatic transformations are incremental and leave inputs untouched.
 */
export function recognizeCapture(
  samples: FaceSamples,
  colors: string,
  locked: ReadonlySet<number>,
  evidence: CaptureEvidence = {},
): CaptureClassification {
  validateInputs(samples, colors, evidence);
  const centers = matchCenters(samples, colors, locked, evidence);
  const calibrated = calibrateLighting(samples, centers, evidence);
  const workingSamples = calibrated.samples,
    workingEvidence = calibrated.evidence;
  const models = fitModels(workingSamples, centers, workingEvidence);
  const uncorrectedModels = fitModels(samples, centers, evidence);
  const provisional = colors.split("");
  const uncertain = new Set<number>(),
    qualityProblems = new Set<number>();
  const choices: Choice[][] = Array.from({ length: 54 }, (_, index) =>
    FACES.includes(colors[index] as Face)
      ? [{ color: colors[index] as Face, cost: 0 }]
      : [],
  );
  for (let fi = 0; fi < 6; fi++) {
    const face = FACES[fi];
    workingSamples[face]?.forEach((rgb, cell) => {
      const index = fi * 9 + cell;
      if (locked.has(index)) return;
      const quality = workingEvidence[face]?.[cell];
      const correctedRank = score(rgb, models, quality);
      const originalRank = score(
        samples[face]![cell],
        uncorrectedModels,
        evidence[face]?.[cell],
      );
      const modelDisagreement =
        correctedRank[0].color !== originalRank[0].color;
      const ranked = rank(
        FACES.map(
          (color) =>
            correctedRank.find((v) => v.color === color)!.cost * 0.6 +
            originalRank.find((v) => v.color === color)!.cost * 0.4,
        ),
      );
      if (cell === 4) {
        provisional[index] = centers[fi];
        choices[index] = FACES.includes(centers[fi] as Face)
          ? [{ color: centers[fi] as Face, cost: 0 }]
          : [];
      } else {
        provisional[index] = ranked[0].color;
        const lowMargin = margin(ranked) < 0.45;
        const supportedAlternative =
          quality?.alternatives.some((alternate) => {
            const r = score(alternate, models);
            return r[0].color !== ranked[0].color && r[0].cost < 9;
          }) ?? false;
        const shadows = shadowAlternatives(
          samples[face]![cell],
          ranked[0].color,
          uncorrectedModels,
          evidence[face]?.[cell],
        );
        choices[index] =
          lowMargin ||
          supportedAlternative ||
          modelDisagreement ||
          shadows.length
            ? ranked
                .filter(
                  (choice) =>
                    (lowMargin ||
                      supportedAlternative ||
                      modelDisagreement ||
                      choice.color === ranked[0].color ||
                      shadows.includes(choice.color)) &&
                    choice.cost <= ranked[0].cost + 23 &&
                    choice.cost < 48,
                )
                .slice(0, 3)
            : [ranked[0]];
        if (choices[index].length === 0) choices[index] = [ranked[0]];
        if (
          lowMargin ||
          supportedAlternative ||
          modelDisagreement ||
          shadows.length
        )
          uncertain.add(index);
      }
      if (quality && (quality.coverage < 0.35 || quality.spread > 32))
        qualityProblems.add(index);
      if (
        variants(rgb, quality).every((value) => lab(value)[0] < 12) ||
        ranked[0].cost > 42
      )
        qualityProblems.add(index);
      if (quality && (quality.coverage < 0.65 || quality.spread > 18))
        uncertain.add(index);
    });
  }
  const baseline = provisional.join("");
  const result = (
    status: CaptureClassification["status"],
    message: string,
  ): CaptureClassification => ({
    colors: baseline,
    uncertain: [...new Set([...uncertain, ...qualityProblems])].sort(
      (a, b) => a - b,
    ),
    adjusted: [],
    rotations: {},
    status,
    message,
  });
  if (baseline.includes("?"))
    return result(
      "incomplete",
      "已读入当前面的九格；继续拍摄其余面，六面齐全后会一起核对颜色。",
    );
  if (
    new Set(centers).size !== 6 ||
    centers.some((color) => !FACES.includes(color as Face))
  )
    return result(
      "review",
      "六个中心需要各不相同，请核对中心颜色或是否拍了重复的面。",
    );
  const duplicate = hasDuplicateFace(samples);
  if (duplicate.length) {
    duplicate.forEach((fi) => {
      for (let cell = 0; cell < 9; cell++) uncertain.add(fi * 9 + cell);
    });
    return result(
      "review",
      "有两面的照片内容相同，请核对六张照片是否包含重复面。",
    );
  }
  if (qualityProblems.size)
    return result(
      "review",
      "部分色块的有效颜色不足，请核对高亮格；当前结果尚不能可靠生成解法。",
    );
  const fitted = FACES.map((f) => models[f].pooled);
  if (
    FACES.every((face) => samples[face]) &&
    fitted.some((a, i) => fitted.some((b, j) => j > i && distance(a, b) < 0.12))
  )
    return result(
      "review",
      "有两种颜色在照片中无法区分，请核对中心和高光区域。",
    );
  let baselineIsLegal = false;
  try {
    const normalized = normalizeColors(baseline);
    baselineIsLegal = validateFacelets(
      normalized.facelets,
      normalized.palette,
    ).valid;
  } catch {
    /* Center checks above already cover this case. */
  }
  // If the measured best state is already legal at zero extra cost, only
  // alternatives within the acceptance margin can change the decision.
  const combinations = balancedAssignments(
    choices,
    baselineIsLegal ? 1.5 : Infinity,
  );
  if (combinations.limited)
    return result("review", "还有较多颜色无法确定，请核对高亮格后再生成解法。");
  const found = legalCandidates(
    combinations.assignments,
    centers,
    locked,
    samples,
  );
  if (found.limited)
    return result(
      "review",
      "颜色和面方向存在较多组合，请先核对高亮格及各面的顶边。",
    );
  if (!found.best)
    return result(
      "review",
      uncertain.size
        ? "六面已录入，但颜色或面方向仍有冲突，请核对高亮格与拍摄顺序。"
        : "六面已录入，但局面不一致。请核对拍摄顺序、各面顶边，以及拍摄中是否拧动了魔方。",
    );
  if (
    found.runner &&
    found.runner.cost - found.best.cost < Math.max(1.5, found.best.cost * 0.12)
  )
    return result(
      "review",
      "照片仍对应多个可能的局面，请核对高亮格或面方向，避免生成错误解法。",
    );
  const named = resolveCloseColorNames(
    found.best,
    samples,
    evidence,
    locked,
    centers,
    uncorrectedModels,
  );
  if (named.uncertain.length) {
    named.uncertain.forEach((index) => uncertain.add(index));
    return result(
      "review",
      "部分颜色在照片中太接近，仍无法可靠区分。请核对高亮格及中心颜色。",
    );
  }
  const best = { ...found.best, colors: named.colors };
  const rotations: Partial<Record<Face, number>> = {};
  const adjusted: number[] = [];
  best.turns.forEach((turns, fi) => {
    if (turns) rotations[FACES[fi]] = turns;
    for (let cell = 0; cell < 9; cell++) {
      const source = fi * 9 + cell,
        target = rotateIndex(source, turns);
      if (best.colors[target] !== baseline[source]) adjusted.push(target);
    }
  });
  // A successful unique joint interpretation resolves the listed candidates;
  // retain only non-blocking quality warnings for the optional visual review.
  const remaining = [...uncertain]
    .filter((index) => {
      const q = evidence[FACES[Math.floor(index / 9)]]?.[index % 9];
      return q && (q.coverage < 0.65 || q.spread > 18);
    })
    .map((index) => rotateIndex(index, best.turns[Math.floor(index / 9)]));
  return {
    colors: best.colors,
    uncertain: remaining.sort((a, b) => a - b),
    adjusted: adjusted.sort((a, b) => a - b),
    rotations,
    status: "ready",
    message:
      adjusted.length || Object.keys(rotations).length
        ? "六面已核对，并结合全部颜色与面方向完成自动校正。"
        : "六面颜色和方向已核对，可以生成解法。",
  };
}
