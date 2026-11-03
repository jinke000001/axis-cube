import type { FormulaRecord } from "./types";

/** Render the printed formula, including its repetition marks. Repeated moves
 * keep one printed letter while the player's logical steps remain distinct. */
export function SourceAlgorithm({
  formula,
  active,
  completed,
  loopGroup,
  onSeek,
  playable = true,
}: {
  formula: FormulaRecord;
  active: number;
  completed: number;
  loopGroup: number | null;
  onSeek: (step: number) => void;
  playable?: boolean;
}) {
  let printed = 0;
  const activePrinted = formula.steps[active]?.printedIndex;
  const loop = loopGroup === null ? undefined : formula.groups[loopGroup];
  const loopPrinted = loop
    ? new Set(
        formula.steps
          .slice(loop.start, loop.end)
          .map((step) => step.printedIndex),
      )
    : undefined;
  const chunks = formula.algorithm.match(/\([^()]*\)[2-9]?|[^()]+/g) ?? [];
  return (
    <div
      className="cd-formula"
      aria-label={`原表公式 ${formula.algorithm.replaceAll("'", "′")}`}
    >
      {chunks.map((chunk, group) => {
        const tokens =
          chunk.match(
            /[()]|[URFDLB]w?(?:2'?|')?|[urfdlbMESxyz](?:2'?|')?|[2-9]/g,
          ) ?? [];
        const firstPrinted = printed;
        const content = tokens.map((token, index) => {
          if (/^[()2-9]$/.test(token))
            return (
              <span
                key={`punct-${index}`}
                className={/^\d$/.test(token) ? "cd-repeat" : "cd-bracket"}
                aria-hidden="true"
              >
                {token}
              </span>
            );
          const printedIndex = printed++;
          const step = formula.steps.find(
            (item) => item.printedIndex === printedIndex,
          )!;
          const highlighted =
            playable && activePrinted === printedIndex && completed < formula.steps.length;
          return (
            <button
              key={printedIndex}
              className={`${highlighted ? "is-active" : ""} ${step.hint?.color ? `cd-${step.hint.color}` : ""}`}
              aria-current={highlighted ? "step" : undefined}
              aria-label={`定位到原表第 ${printedIndex + 1} 个动作 ${token.replaceAll("'", "′")} 前`}
              onClick={() => onSeek(step.index)}
              disabled={!playable}
            >
              {token.replaceAll("'", "′")}
            </button>
          );
        });
        return (
          <div
            key={group}
            className={`cd-move-group ${loopPrinted?.has(firstPrinted) ? "is-looping" : ""}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
