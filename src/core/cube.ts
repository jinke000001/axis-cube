export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];
export type Vec3 = [number, number, number];
export type Palette = Record<Face, Face>;
export const DEFAULT_PALETTE: Palette = {
  U: "U",
  R: "R",
  F: "F",
  D: "D",
  L: "L",
  B: "B",
};
export const COLORS: Record<Face, string> = {
  U: "#e9e9df",
  R: "#d84435",
  F: "#389b7b",
  D: "#eec94d",
  L: "#eb8d3e",
  B: "#4388cb",
};
export const COLOR_NAMES: Record<Face, string> = {
  U: "白",
  R: "红",
  F: "绿",
  D: "黄",
  L: "橙",
  B: "蓝",
};
export const FACE_NAMES: Record<Face, string> = {
  U: "上",
  R: "右",
  F: "前",
  D: "下",
  L: "左",
  B: "后",
};
export const SOLVED = FACES.map((f) => f.repeat(9)).join("");
export const NORMALS: Record<Face, Vec3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};
export interface StickerSlot {
  face: Face;
  row: number;
  col: number;
  position: Vec3;
  normal: Vec3;
  index: number;
}
export const SLOTS: StickerSlot[] = FACES.flatMap((face, fi) =>
  Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3),
      col = i % 3;
    const positions: Record<Face, Vec3> = {
      U: [col - 1, 1, row - 1],
      R: [1, 1 - row, 1 - col],
      F: [col - 1, 1 - row, 1],
      D: [col - 1, -1, 1 - row],
      L: [-1, 1 - row, col - 1],
      B: [1 - col, 1 - row, -1],
    };
    return {
      face,
      row,
      col,
      position: positions[face],
      normal: NORMALS[face],
      index: fi * 9 + i,
    };
  }),
);
const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
const key = (p: Vec3, n: Vec3) => p.join(",") + "/" + n.join(",");
const slotByKey = new Map(
  SLOTS.map((s) => [key(s.position, s.normal), s.index]),
);
function quarter(v: Vec3, n: Vec3): Vec3 {
  const d = dot(v, n),
    cross: Vec3 = [
      n[1] * v[2] - n[2] * v[1],
      n[2] * v[0] - n[0] * v[2],
      n[0] * v[1] - n[1] * v[0],
    ];
  return n.map((x, i) => Math.round(x * d - cross[i])) as Vec3;
}
const PERMUTATIONS = Object.fromEntries(
  FACES.map((face) => [
    face,
    SLOTS.map((s) =>
      dot(s.position, NORMALS[face]) === 1
        ? slotByKey.get(
            key(
              quarter(s.position, NORMALS[face]),
              quarter(s.normal, NORMALS[face]),
            ),
          )!
        : s.index,
    ),
  ]),
) as Record<Face, number[]>;
export interface Move {
  /** Direction reference: M follows L, E follows D, S follows F. */
  face: Face;
  turns: 1 | 2 | 3;
  notation: string;
  kind?: "slice" | "wide" | "rotation";
  /** Coordinates along NORMALS[face]. Ordinary outer turns select +1. */
  layers?: readonly (-1 | 0 | 1)[];
  /** A half turn has two equivalent states but two different finger paths. */
  direction?: 1 | -1;
}
export function parseMove(notation: string): Move {
  notation = notation.replace(/[’′]/g, "'");
  const match = /^([URFDLB]w?|[urfdlbMESxyz])(2'?|')?$/.exec(notation);
  if (!match)
    throw new Error("不支持的转动指令：" + notation);
  const [, symbol, suffix = ""] = match;
  const slice = { M: "L", E: "D", S: "F" } as const;
  const rotations = { x: "R", y: "U", z: "F" } as const;
  const kind = symbol in slice ? "slice" : symbol in rotations ? "rotation"
    : symbol.endsWith("w") || /^[urfdlb]$/.test(symbol) ? "wide" : undefined;
  const face = kind === "slice" ? slice[symbol as keyof typeof slice]
    : kind === "rotation" ? rotations[symbol as keyof typeof rotations]
    : symbol[0].toUpperCase() as Face;
  return {
    face,
    turns: suffix.startsWith("2") ? 2 : suffix === "'" ? 3 : 1,
    notation,
    ...(kind ? { kind, layers: kind === "slice" ? [0] as const
      : kind === "wide" ? [0, 1] as const : [-1, 0, 1] as const } : {}),
    ...(suffix === "2'" ? { direction: -1 as const } : {}),
  };
}
export function parseAlgorithm(text: string): Move[] {
  const tokens = text.replace(/[’′]/g, "'").match(/[()]|[^\s()]+/g) ?? [];
  let at = 0;
  const read = (depth: number): Move[] => {
    if (depth > 8) throw new Error("公式括号嵌套过深。");
    const moves: Move[] = [];
    while (at < tokens.length && tokens[at] !== ")") {
      if (tokens[at] === "(") {
        at++;
        const group = read(depth + 1);
        if (tokens[at++] !== ")") throw new Error("公式括号不完整。");
        const repeat = /^[2-9]$/.test(tokens[at] ?? "") ? Number(tokens[at++]) : 1;
        for (let i = 0; i < repeat; i++) moves.push(...group);
      } else moves.push(parseMove(tokens[at++]));
      if (moves.length > 1024) throw new Error("公式过长，请分段查看。");
    }
    return moves;
  };
  const moves = read(0);
  if (at !== tokens.length) throw new Error("公式括号不完整。");
  return moves;
}
export function moveAffects(move: Move, position: Vec3): boolean {
  const layer = Math.round(dot(position, NORMALS[move.face]));
  return (move.layers ?? [1]).some((value) => value === layer);
}
export function moveAngle(move: Move): number {
  const turns = move.turns === 3 ? -1 : move.turns;
  return (-Math.PI / 2) * turns * (move.turns === 2 ? move.direction ?? 1 : 1);
}
const extendedPermutations = new Map<string, number[]>();
function permutation(move: Move): number[] {
  if (!move.layers) return PERMUTATIONS[move.face];
  const id = move.face + move.layers.join(",");
  if (!extendedPermutations.has(id)) {
    const normal = NORMALS[move.face];
    extendedPermutations.set(id, SLOTS.map((slot) => moveAffects(move, slot.position)
      ? slotByKey.get(key(quarter(slot.position, normal), quarter(slot.normal, normal)))!
      : slot.index));
  }
  return extendedPermutations.get(id)!;
}
export function applyMove(state: string, move: Move | string): string {
  const m = typeof move === "string" ? parseMove(move) : move;
  let out = state;
  for (let t = 0; t < m.turns; t++) {
    const next = out.split("");
    permutation(m).forEach((to, from) => {
      next[to] = out[from];
    });
    out = next.join("");
  }
  return out;
}
export function applyAlgorithm(state: string, alg: string | Move[]): string {
  return (typeof alg === "string" ? parseAlgorithm(alg) : alg).reduce(
    (s, m) => applyMove(s, m),
    state,
  );
}
export function snapshots(state: string, moves: Move[]): string[] {
  const result = [state];
  moves.forEach((m) => result.push(applyMove(result[result.length - 1], m)));
  return result;
}
export function randomScramble(count = 22): string {
  const moves: string[] = [];
  let previous = -1;
  for (let i = 0; i < count; i++) {
    let next = Math.floor(Math.random() * 6);
    while (next === previous) next = Math.floor(Math.random() * 6);
    previous = next;
    moves.push(FACES[next] + ["", "'", "2"][Math.floor(Math.random() * 3)]);
  }
  return moves.join(" ");
}
export function rotateFace(state: string, face: Face): string {
  const start = FACES.indexOf(face) * 9,
    chars = state.split(""),
    old = state.slice(start, start + 9);
  [6, 3, 0, 7, 4, 1, 8, 5, 2].forEach(
    (from, to) => (chars[start + to] = old[from]),
  );
  return chars.join("");
}
export interface Validation {
  valid: boolean;
  message: string;
  indices: number[];
}
const corners = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51],
];
const cornerColors = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
const edges = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14],
];
const edgeColors = [
  "UR",
  "UF",
  "UL",
  "UB",
  "DR",
  "DF",
  "DL",
  "DB",
  "FR",
  "FL",
  "BL",
  "BR",
];
const parity = (a: number[]) =>
  a.reduce((n, v, i) => n + a.slice(i + 1).filter((x) => x < v).length, 0) % 2;
export function validateFacelets(
  s: string,
  palette = DEFAULT_PALETTE,
): Validation {
  const fail = (message: string, indices: number[] = []): Validation => ({
    valid: false,
    message,
    indices,
  });
  if (s.length !== 54 || /[^URFDLB]/.test(s))
    return fail("请为六个面填满 54 个色块。");
  for (const f of FACES) {
    const n = [...s].filter((c) => c === f).length;
    if (n !== 9)
      return fail(
        COLOR_NAMES[palette[f]] + "色有 " + n + " 格，需要 9 格。",
        [...s].flatMap((c, i) => (c === f ? [i] : [])),
      );
  }
  for (let i = 0; i < 6; i++)
    if (s[i * 9 + 4] !== FACES[i])
      return fail("中心颜色与面方向不一致，请检查六面的对应关系。", [
        i * 9 + 4,
      ]);
  const cp: number[] = [],
    co: number[] = [],
    ep: number[] = [],
    eo: number[] = [];
  for (const indices of corners) {
    const colors = indices.map((i) => s[i]);
    const ori = colors.findIndex((c) => c === "U" || c === "D");
    const id = cornerColors.findIndex(
      (c) =>
        c[0] === colors[ori] &&
        c[1] === colors[(ori + 1) % 3] &&
        c[2] === colors[(ori + 2) % 3],
    );
    if (ori < 0 || id < 0 || cp.includes(id))
      return fail("角块颜色组合或面朝向不正确，请核对高亮位置。", indices);
    cp.push(id);
    co.push(ori);
  }
  for (const indices of edges) {
    const colors = indices.map((i) => s[i]).join("");
    let id = edgeColors.indexOf(colors),
      ori = 0;
    if (id < 0) {
      id = edgeColors.indexOf(colors[1] + colors[0]);
      ori = 1;
    }
    if (id < 0 || ep.includes(id))
      return fail("棱块颜色组合重复或不正确，请核对高亮位置。", indices);
    ep.push(id);
    eo.push(ori);
  }
  if (co.reduce((a, b) => a + b, 0) % 3)
    return fail("角块方向不合法：可能有角块被扭转，或照片方向有误。");
  if (eo.reduce((a, b) => a + b, 0) % 2)
    return fail("棱块方向不合法：可能有棱块被翻转，或识别有误。");
  if (parity(cp) !== parity(ep))
    return fail(
      "块的排列无法通过正常转动还原，请检查颜色、面朝向或是否拆装过魔方。",
    );
  return {
    valid: true,
    message:
      s === SOLVED ? "已经还原，可直接欣赏场景。" : "局面有效，可以生成解法。",
    indices: [],
  };
}
export function normalizeColors(colors: string): {
  facelets: string;
  palette: Palette;
} {
  if (colors.length !== 54) throw new Error("需要完整的六面颜色。");
  const centers = FACES.map((_, i) => colors[i * 9 + 4]);
  if (
    new Set(centers).size !== 6 ||
    centers.some((c) => !FACES.includes(c as Face))
  )
    throw new Error("六个中心需要各不相同，请检查面对应关系。");
  const palette = Object.fromEntries(
    FACES.map((f, i) => [f, centers[i]]),
  ) as Palette;
  const facelets = [...colors]
    .map((c) => FACES[centers.indexOf(c)] ?? "?")
    .join("");
  return { facelets, palette };
}
