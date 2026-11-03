import { COLORS, FACES, type Face } from "../core/cube";

// Orthographic three-face view derived from the actual lesson state.
export function CubeThumbnail({ state, label }: { state: string; label: string }) {
  const faces: { face: Face; origin: [number, number]; across: [number, number]; down: [number, number] }[] = [
    { face: "U", origin: [48, 5], across: [13, 7], down: [-13, 7] },
    { face: "F", origin: [9, 26], across: [13, 7], down: [0, 15] },
    { face: "R", origin: [48, 47], across: [13, -7], down: [0, 15] },
  ];
  return <svg className="as-cube-thumbnail" viewBox="0 0 96 98" role="img" aria-label={label}>
    {faces.flatMap(({ face, origin, across, down }) => Array.from({ length: 9 }, (_, cell) => {
      const row = Math.floor(cell / 3), col = cell % 3;
      const point = (x: number, y: number) => `${origin[0] + (col + x) * across[0] + (row + y) * down[0]},${origin[1] + (col + x) * across[1] + (row + y) * down[1]}`;
      return <polygon key={`${face}-${cell}`} points={[point(.04,.04),point(.96,.04),point(.96,.96),point(.04,.96)].join(" ")} fill={COLORS[state[FACES.indexOf(face) * 9 + cell] as Face]} stroke="#303935" strokeWidth=".8" strokeLinejoin="round"/>;
    }))}
  </svg>;
}
