import { useId } from "react";
import { COLORS, type Face } from "../core/cube";
import type { CFOPCase } from "../learning/cfop-library";

/** Redrawn from the independently transcribed source diagram, not from inverse algorithms. */
export function CFOPDiagram({ example }: { example: CFOPCase }) {
  const marker = `arrow-${useId().replace(/[^a-z0-9-]/gi, "")}`;
  const fixture = example.recognitionFixture;
  if (fixture.kind === "f2l") {
    const faces = [
      { values: fixture.U, origin: [54, 11], across: [14, 8], down: [-14, 8] },
      { values: fixture.F, origin: [12, 35], across: [14, 8], down: [0, 16] },
      { values: fixture.R, origin: [54, 59], across: [14, -8], down: [0, 16] },
    ];
    return (
      <svg
        className="as-cfop-diagram"
        viewBox="0 0 108 116"
        role="img"
        aria-label={`${example.sourceName}，目标角棱识别图，灰色块无需匹配`}
      >
        {faces.flatMap(({ values, origin, across, down }, face) =>
          Array.from({ length: 9 }, (_, index) => {
            const x = index % 3,
              y = Math.floor(index / 3);
            const point = (a: number, b: number) =>
              `${origin[0] + (x + a) * across[0] + (y + b) * down[0]},${origin[1] + (x + a) * across[1] + (y + b) * down[1]}`;
            return (
              <polygon
                key={`${face}-${index}`}
                points={[
                  point(0.045, 0.045),
                  point(0.955, 0.045),
                  point(0.955, 0.955),
                  point(0.045, 0.955),
                ].join(" ")}
                fill={COLORS[values[index] as Face] ?? "#34414b"}
                stroke="#10191e"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            );
          }),
        )}
      </svg>
    );
  }
  const cell = (index: number) => [
    31 + (index % 3) * 24,
    31 + Math.floor(index / 3) * 24,
  ];
  return (
    <svg
      className="as-cfop-diagram"
      viewBox="0 0 110 110"
      role="img"
      aria-label={`${example.sourceName}，${fixture.kind === "oll" ? "黄色顶面和四周侧条" : "顶层色块移动方向"}，图上方是后侧，下方是前侧`}
    >
      <defs>
        <marker
          id={marker}
          markerWidth="5"
          markerHeight="5"
          refX="4"
          refY="2.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L5,2.5 L0,5 Z" fill="#122029" />
        </marker>
      </defs>
      {Array.from({ length: 9 }, (_, index) => (
        <rect
          key={index}
          x={cell(index)[0] - 11}
          y={cell(index)[1] - 11}
          width="22"
          height="22"
          rx="1"
          fill={
            fixture.kind === "pll" || fixture.top[index] === "1"
              ? COLORS.D
              : "#34414b"
          }
        />
      ))}
      {fixture.kind === "oll" &&
        Array.from({ length: 12 }, (_, index) => {
          const side = Math.floor(index / 3),
            offset = index % 3;
          const x = side === 1 ? 94 : side === 3 ? 10 : 20 + offset * 24;
          const y = side === 0 ? 10 : side === 2 ? 94 : 20 + offset * 24;
          return (
            <rect
              key={`bar-${index}`}
              x={x}
              y={y}
              width={side % 2 ? 6 : 22}
              height={side % 2 ? 22 : 6}
              rx="1"
              fill={fixture.bars[index] === "1" ? COLORS.D : "#34414b"}
            />
          );
        })}
      {fixture.kind === "pll" &&
        fixture.cycles.flatMap((cycle, group) =>
          cycle.map((from, index) => {
            const a = cell(from),
              b = cell(cycle[(index + 1) % cycle.length]);
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const dx = (b[0] - a[0]) / length,
              dy = (b[1] - a[1]) / length;
            const offset = cycle.length === 2 ? 2.5 : 0;
            return (
              <path
                key={`${group}-${index}`}
                d={`M${a[0] + dx * 5 - dy * offset},${a[1] + dy * 5 + dx * offset} L${b[0] - dx * 7 - dy * offset},${b[1] - dy * 7 + dx * offset}`}
                stroke="#122029"
                strokeWidth="1.7"
                fill="none"
                markerEnd={`url(#${marker})`}
              />
            );
          }),
        )}
      <text x="55" y="108" textAnchor="middle" fill="#a8b9c7" fontSize="6">
        前
      </text>
    </svg>
  );
}
