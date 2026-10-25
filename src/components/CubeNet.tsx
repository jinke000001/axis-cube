import {
  COLORS,
  FACES,
  FACE_NAMES,
  type Face,
  type Palette,
  DEFAULT_PALETTE,
} from "../core/cube";
export function CubeNet({
  state,
  palette = DEFAULT_PALETTE,
  active,
  onSticker,
  errors = [],
}: {
  state: string;
  palette?: Palette;
  active?: Face;
  onSticker?: (index: number) => void;
  errors?: number[];
}) {
  return (
    <div
      className={"cube-net" + (onSticker ? " editable" : "")}
      aria-label="魔方六面展开图"
    >
      {FACES.map((face, fi) => (
        <div
          key={face}
          className={
            "net-face face-" + face + (active === face ? " highlighted" : "")
          }
        >
          <span className="net-label">{face}</span>
          <div className="net-grid">
            {Array.from({ length: 9 }, (_, i) => {
              const index = fi * 9 + i,
                color = palette[state[index] as Face],
                style = { background: COLORS[color] ?? "#333e43" };
              return onSticker ? (
                <button
                  key={i}
                  type="button"
                  style={style}
                  className={errors.includes(index) ? "cell-error" : ""}
                  aria-label={FACE_NAMES[face] + "面第" + (i + 1) + "格"}
                  onClick={() => onSticker(index)}
                >
                  {i === 4 ? face : null}
                </button>
              ) : (
                <span key={i} style={style} />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
