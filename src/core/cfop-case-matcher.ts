import {
  COLOR_NAMES,
  NORMALS,
  SLOTS,
  SOLVED,
  applyAlgorithm,
  type Face,
  type Move,
  type Palette,
  type Vec3,
} from "./cube";
import type { SessionPhase } from "./session";
import { CFOP_CASES, type CFOPCase } from "../learning/cfop-library";

export interface ExplainableSubstage {
  id: string;
  phase: "cross" | "f2l" | "oll" | "pll";
  title: string;
  detail: string;
  start: number;
  end: number;
  moves: string;
  matchedCase?: {
    id: string;
    code: string;
    name: string;
    category: string;
  };
}

function pieceIndices(colors: readonly Face[]): number[] {
  const pos: Vec3 = [0, 0, 0];
  for (const c of colors) {
    NORMALS[c].forEach((v, i) => {
      pos[i] += v;
    });
  }
  return SLOTS.filter((s) => s.position.every((v, i) => v === pos[i])).map(
    (s) => s.index,
  );
}

function isPieceSolved(state: string, colors: readonly Face[]): boolean {
  const indices = pieceIndices(colors);
  return (
    indices.length === colors.length &&
    indices.every((idx) => state[idx] === SOLVED[idx])
  );
}

const CROSS_EDGES: readonly { id: string; faces: readonly [Face, Face] }[] = [
  { id: "DF", faces: ["D", "F"] },
  { id: "DR", faces: ["D", "R"] },
  { id: "DB", faces: ["D", "B"] },
  { id: "DL", faces: ["D", "L"] },
];

const F2L_SLOTS: readonly {
  id: string;
  yaw: number;
  corner: readonly [Face, Face, Face];
  edge: readonly [Face, Face];
  sideFaces: readonly [Face, Face];
}[] = [
  { id: "FR", yaw: 0, corner: ["D", "F", "R"], edge: ["F", "R"], sideFaces: ["F", "R"] },
  { id: "BR", yaw: 1, corner: ["D", "R", "B"], edge: ["R", "B"], sideFaces: ["R", "B"] },
  { id: "BL", yaw: 2, corner: ["D", "B", "L"], edge: ["B", "L"], sideFaces: ["B", "L"] },
  { id: "FL", yaw: 3, corner: ["D", "L", "F"], edge: ["L", "F"], sideFaces: ["L", "F"] },
];

function rotateY(v: Vec3, turns: number): Vec3 {
  let [x, y, z] = v;
  const n = ((turns % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    [x, z] = [-z, x];
  }
  return [x, y, z];
}

function findStickerOfCubie(
  state: string,
  cubieColors: readonly Face[],
  targetColor: Face,
): { position: Vec3; normal: Vec3 } | undefined {
  const wanted = [...cubieColors].sort().join("");
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const slots = SLOTS.filter(
          (s) => s.position[0] === x && s.position[1] === y && s.position[2] === z,
        );
        if (slots.length !== cubieColors.length) continue;
        const present = slots
          .map((s) => state[s.index])
          .sort()
          .join("");
        if (present === wanted) {
          const sticker = slots.find((s) => state[s.index] === targetColor);
          if (sticker) {
            return { position: sticker.position, normal: sticker.normal };
          }
        }
      }
    }
  }
  return undefined;
}

let _f2lSignatureTable: Map<string, CFOPCase> | undefined;
function getF2lSignatureTable(): Map<string, CFOPCase> {
  if (_f2lSignatureTable) return _f2lSignatureTable;
  _f2lSignatureTable = new Map();
  for (const item of CFOP_CASES.filter((c) => c.stage === "F2L")) {
    const state = applyAlgorithm(SOLVED, item.setup);
    const cSticker = findStickerOfCubie(state, ["U", "F", "R"], "U");
    const eSticker = findStickerOfCubie(state, ["F", "R"], "F");
    if (!cSticker || !eSticker) continue;
    const key = JSON.stringify([
      cSticker.position,
      cSticker.normal,
      eSticker.position,
      eSticker.normal,
    ]);
    if (!_f2lSignatureTable.has(key)) {
      _f2lSignatureTable.set(key, item);
    }
  }
  return _f2lSignatureTable;
}

export function matchF2LSlotCase(
  state: string,
  slot: (typeof F2L_SLOTS)[number],
): CFOPCase | undefined {
  const [bottomFace, frontFace, rightFace] = slot.corner;
  const cSticker = findStickerOfCubie(state, [bottomFace, frontFace, rightFace], bottomFace);
  const eSticker = findStickerOfCubie(state, [frontFace, rightFace], frontFace);
  if (!cSticker || !eSticker) return undefined;
  const cPos = rotateY(cSticker.position, -slot.yaw);
  const cNorm = rotateY(cSticker.normal, -slot.yaw);
  const ePos = rotateY(eSticker.position, -slot.yaw);
  const eNorm = rotateY(eSticker.normal, -slot.yaw);
  const table = getF2lSignatureTable();
  for (let auf = 0; auf < 4; auf++) {
    const cp = cPos[1] === 1 ? rotateY(cPos, auf) : cPos;
    const cn = cPos[1] === 1 ? rotateY(cNorm, auf) : cNorm;
    const ep = ePos[1] === 1 ? rotateY(ePos, auf) : ePos;
    const en = ePos[1] === 1 ? rotateY(eNorm, auf) : eNorm;
    const found = table.get(JSON.stringify([cp, cn, ep, en]));
    if (found) return found;
  }
  return undefined;
}

// Top face (U, y = 1) 9 cells viewed from above: back-left (-1,1,-1) to front-right (1,1,1)
const U_TOP_SLOTS: readonly number[] = (() => {
  const out: number[] = [];
  for (const z of [-1, 0, 1] as const) {
    for (const x of [-1, 0, 1] as const) {
      const slot = SLOTS.find(
        (s) =>
          s.face === "U" &&
          s.position[0] === x &&
          s.position[1] === 1 &&
          s.position[2] === z,
      )!;
      out.push(slot.index);
    }
  }
  return out;
})();

// 12 side stickers around U (y = 1), ordered: back L->R, right B->F, front L->R, left B->F
const U_BAR_SLOTS: readonly number[] = (() => {
  const find = (face: Face, x: number, z: number) =>
    SLOTS.find(
      (s) =>
        s.face === face &&
        s.position[0] === x &&
        s.position[1] === 1 &&
        s.position[2] === z,
    )!.index;
  return [
    // Back L -> R (x = -1, 0, 1 at z = -1)
    find("B", -1, -1),
    find("B", 0, -1),
    find("B", 1, -1),
    // Right B -> F (z = -1, 0, 1 at x = 1)
    find("R", 1, -1),
    find("R", 1, 0),
    find("R", 1, 1),
    // Front L -> R (x = -1, 0, 1 at z = 1)
    find("F", -1, 1),
    find("F", 0, 1),
    find("F", 1, 1),
    // Left B -> F (z = -1, 0, 1 at x = -1)
    find("L", -1, -1),
    find("L", -1, 0),
    find("L", -1, 1),
  ];
})();

function rotateOllPattern(top: string, bars: string): { top: string; bars: string } {
  // 90 deg clockwise viewed from above:
  // top: [6, 3, 0, 7, 4, 1, 8, 5, 2]
  const nextTop = [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => top[i]).join("");
  // bars: back(0,1,2) <- left reversed(11,10,9), right(3,4,5) <- back(0,1,2), front(6,7,8) <- right reversed(5,4,3), left(9,10,11) <- front(6,7,8)
  const nextBars = [11, 10, 9, 0, 1, 2, 5, 4, 3, 6, 7, 8]
    .map((i) => bars[i])
    .join("");
  return { top: nextTop, bars: nextBars };
}

export function matchOLLCase(state: string, topFace: Face = "U"): CFOPCase | undefined {
  let top = U_TOP_SLOTS.map((idx) => (state[idx] === topFace ? "1" : "0")).join("");
  let bars = U_BAR_SLOTS.map((idx) => (state[idx] === topFace ? "1" : "0")).join("");
  if (top === "111111111") return undefined;
  const ollCases = CFOP_CASES.filter((c) => c.stage === "OLL");
  for (let rot = 0; rot < 4; rot++) {
    const found = ollCases.find(
      (c) =>
        c.recognitionFixture.kind === "oll" &&
        c.recognitionFixture.top === top &&
        c.recognitionFixture.bars === bars,
    );
    if (found) return found;
    const rotated = rotateOllPattern(top, bars);
    top = rotated.top;
    bars = rotated.bars;
  }
  return undefined;
}

function canonicalRingSignature(ring: readonly string[]): string {
  const map = new Map<string, number>();
  let next = 0;
  return ring
    .map((c) => {
      let id = map.get(c);
      if (id === undefined) {
        id = next++;
        map.set(c, id);
      }
      return id;
    })
    .join("");
}

// Ring around U in cyclic perimeter order (clockwise from above):
// Back(-1..1), Right(-1..1), Front(1..-1), Left(1..-1)
const U_CYCLIC_RING_SLOTS: readonly number[] = [
  U_BAR_SLOTS[0],
  U_BAR_SLOTS[1],
  U_BAR_SLOTS[2],
  U_BAR_SLOTS[3],
  U_BAR_SLOTS[4],
  U_BAR_SLOTS[5],
  U_BAR_SLOTS[8],
  U_BAR_SLOTS[7],
  U_BAR_SLOTS[6],
  U_BAR_SLOTS[11],
  U_BAR_SLOTS[10],
  U_BAR_SLOTS[9],
];

let _pllSignatureTable: Map<string, CFOPCase> | undefined;
function getPllSignatureTable(): Map<string, CFOPCase> {
  if (_pllSignatureTable) return _pllSignatureTable;
  _pllSignatureTable = new Map();
  for (const item of CFOP_CASES.filter((c) => c.stage === "PLL")) {
    const state = applyAlgorithm(SOLVED, item.setup);
    const ringCW = U_CYCLIC_RING_SLOTS.map((idx) => state[idx]);
    for (let shift = 0; shift < 12; shift += 3) {
      const rotated = [...ringCW.slice(shift), ...ringCW.slice(0, shift)];
      const sig = canonicalRingSignature(rotated);
      if (!_pllSignatureTable.has(sig)) {
        _pllSignatureTable.set(sig, item);
      }
    }
  }
  return _pllSignatureTable;
}

export function matchPLLCase(state: string): CFOPCase | undefined {
  const ring = U_CYCLIC_RING_SLOTS.map((idx) => state[idx]);
  // Check if already solved up to U-turn
  const solvedUpToAUF = [0, 3, 6, 9].every(
    (i) => ring[i] === ring[i + 1] && ring[i + 1] === ring[i + 2],
  );
  if (solvedUpToAUF) return undefined;
  const table = getPllSignatureTable();
  for (let shift = 0; shift < 12; shift += 3) {
    const rotated = [...ring.slice(shift), ...ring.slice(0, shift)];
    const found = table.get(canonicalRingSignature(rotated));
    if (found) return found;
  }
  return undefined;
}

export function buildExplainableSubstages(
  states: readonly string[],
  moves: readonly Move[],
  phases: readonly SessionPhase[] | undefined,
  palette: Palette,
): ExplainableSubstage[] {
  if (!phases?.length || !moves.length) return [];
  const out: ExplainableSubstage[] = [];
  const colorName = (f: Face) => COLOR_NAMES[palette[f]];

  for (const phase of phases) {
    if (phase.end <= phase.start) continue;
    if (phase.name === "cross") {
      const solvedBefore = new Set(
        CROSS_EDGES.filter((e) => isPieceSolved(states[phase.start], e.faces)).map(
          (e) => e.id,
        ),
      );
      let cursor = phase.start;
      let index = 1;
      for (let k = phase.start + 1; k <= phase.end; k++) {
        const newlySolved = CROSS_EDGES.filter(
          (e) => !solvedBefore.has(e.id) && isPieceSolved(states[k], e.faces),
        );
        if (newlySolved.length > 0 || k === phase.end) {
          newlySolved.forEach((e) => solvedBefore.add(e.id));
          const labelPieces = newlySolved
            .map((e) => `${colorName(e.faces[0])}${colorName(e.faces[1])}棱`)
            .join("、");
          const sliceMoves = moves
            .slice(cursor, k)
            .map((m) => m.notation)
            .join(" ");
          out.push({
            id: `cross-${index}`,
            phase: "cross",
            title: `十字 ${index}`,
            detail: labelPieces ? `归位 ${labelPieces}` : `完成底十字收尾`,
            start: cursor,
            end: k,
            moves: sliceMoves,
          });
          cursor = k;
          index++;
        }
      }
    } else if (phase.name === "f2l") {
      const solvedBefore = new Set(
        F2L_SLOTS.filter(
          (s) =>
            isPieceSolved(states[phase.start], s.corner) &&
            isPieceSolved(states[phase.start], s.edge),
        ).map((s) => s.id),
      );
      let cursor = phase.start;
      let pairIdx = 1;
      for (let k = phase.start + 1; k <= phase.end; k++) {
        const newlySolved = F2L_SLOTS.filter(
          (s) =>
            !solvedBefore.has(s.id) &&
            isPieceSolved(states[k], s.corner) &&
            isPieceSolved(states[k], s.edge),
        );
        if (newlySolved.length > 0 || k === phase.end) {
          newlySolved.forEach((s) => solvedBefore.add(s.id));
          const slotDesc = newlySolved
            .map(
              (s) =>
                `${colorName(s.sideFaces[0])}${colorName(s.sideFaces[1])}槽`,
            )
            .join("、");
          const matchedF2L =
            newlySolved.length > 0
              ? matchF2LSlotCase(states[cursor], newlySolved[0]) ??
                (cursor + 1 < k
                  ? matchF2LSlotCase(states[cursor + 1], newlySolved[0])
                  : undefined)
              : undefined;
          const sliceMoves = moves
            .slice(cursor, k)
            .map((m) => m.notation)
            .join(" ");
          out.push({
            id: `f2l-${pairIdx}`,
            phase: "f2l",
            title: `F2L 第 ${pairIdx} 槽`,
            detail: slotDesc ? `配对并入槽：${slotDesc}` : `完成前两层收尾`,
            start: cursor,
            end: k,
            moves: sliceMoves,
            ...(matchedF2L
              ? {
                  matchedCase: {
                    id: matchedF2L.id,
                    code: `${matchedF2L.stage} ${String(matchedF2L.sourceNumber).padStart(2, "0")}`,
                    name: matchedF2L.name,
                    category: matchedF2L.category,
                  },
                }
              : {}),
          });
          cursor = k;
          pairIdx++;
        }
      }
    } else if (phase.name === "oll") {
      const matched =
        matchOLLCase(states[phase.start]) ??
        (phase.start + 1 < phase.end
          ? matchOLLCase(states[phase.start + 1])
          : undefined);
      const sliceMoves = moves
        .slice(phase.start, phase.end)
        .map((m) => m.notation)
        .join(" ");
      out.push({
        id: "oll-1",
        phase: "oll",
        title: "OLL 顶面定向",
        detail: matched
          ? `匹配 ${matched.stage} ${String(matched.sourceNumber).padStart(2, "0")}（${matched.name}）`
          : `将 ${colorName("U")} 顶面全部翻正`,
        start: phase.start,
        end: phase.end,
        moves: sliceMoves,
        ...(matched
          ? {
              matchedCase: {
                id: matched.id,
                code: `${matched.stage} ${String(matched.sourceNumber).padStart(2, "0")}`,
                name: matched.name,
                category: matched.category,
              },
            }
          : {}),
      });
    } else if (phase.name === "pll") {
      const matched =
        matchPLLCase(states[phase.start]) ??
        (phase.start + 1 < phase.end
          ? matchPLLCase(states[phase.start + 1])
          : undefined);
      const sliceMoves = moves
        .slice(phase.start, phase.end)
        .map((m) => m.notation)
        .join(" ");
      out.push({
        id: "pll-1",
        phase: "pll",
        title: "PLL 顶层换位",
        detail: matched
          ? `匹配 ${matched.stage} ${String(matched.sourceNumber).padStart(2, "0")}（${matched.name}）`
          : `顶层角棱换位并对齐四侧中心`,
        start: phase.start,
        end: phase.end,
        moves: sliceMoves,
        ...(matched
          ? {
              matchedCase: {
                id: matched.id,
                code: `${matched.stage} ${String(matched.sourceNumber).padStart(2, "0")}`,
                name: matched.name,
                category: matched.category,
              },
            }
          : {}),
      });
    }
  }
  return out;
}
