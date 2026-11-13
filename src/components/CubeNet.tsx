import {
  COLORS,
  FACES,
  FACE_NAMES,
  type Face,
  type Palette,
  DEFAULT_PALETTE,
} from "../core/cube";
const EDIT_ORDER: Face[] = ["F", "R", "B", "L", "U", "D"];
const TOP_NEIGHBOR: Record<Face, Face> = {
  F: "U",
  R: "U",
  B: "U",
  L: "U",
  U: "B",
  D: "F",
};
const RIGHT_NEIGHBOR: Record<Face, Face> = {
  F: "R",
  R: "B",
  B: "L",
  L: "F",
  U: "R",
  D: "R",
};
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
      {(onSticker ? EDIT_ORDER : FACES).map((face) => (
        <div
          key={face}
          className={
            "net-face face-" + face + (active === face ? " highlighted" : "")
          }
        >
          <span className="net-label">
            {onSticker ? (
              <>
                <b>{FACE_NAMES[face]}面</b>
                <small className="net-neighbors">
                  ↑{FACE_NAMES[TOP_NEIGHBOR[face]]} · →
                  {FACE_NAMES[RIGHT_NEIGHBOR[face]]}
                </small>
              </>
            ) : (
              face
            )}
          </span>
          <div className="net-grid">
            {Array.from({ length: 9 }, (_, i) => {
              const index = FACES.indexOf(face) * 9 + i,
                color = palette[state[index] as Face],
                style = { background: COLORS[color] ?? "#333e43" };
              return onSticker ? (
                <button
                  key={i}
                  type="button"
                  style={style}
                  className={errors.includes(index) ? "cell-error" : ""}
                  aria-label={FACE_NAMES[face] + "面第" + (i + 1) + "格"}
                  aria-description={
                    errors.includes(index) ? "请核对这一格" : undefined
                  }
                  onClick={() => onSticker(index)}
                >
                  {i === 4 ? face : null}
                </button>
              ) : (
                <span
                  key={i}
                  style={style}
                  className={errors.includes(index) ? "cell-error" : ""}
                  aria-label={
                    FACE_NAMES[face] +
                    "面第" +
                    (i + 1) +
                    "格" +
                    (errors.includes(index) ? "，请核对" : "")
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
