import type { FormulaRecord } from "../demonstrator/types";

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
  const activeGroup = formula.steps[active]?.group;
  const repeatedKeys = [...new Set(formula.groups.filter(group =>
    formula.groups.some(other => other.index !== group.index && formula.steps[other.start].printedIndex === formula.steps[group.start].printedIndex)
  ).map(group => formula.steps[group.start].printedIndex))];
  const repetitions = repeatedKeys.map(key => formula.groups.filter(group => formula.steps[group.start].printedIndex === key));
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
  return (<>
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
          const occurrences = formula.steps.filter(item => item.printedIndex === printedIndex);
          const step = occurrences.find(item => item.group === activeGroup)
            ?? occurrences.find(item => item.group === loopGroup) ?? occurrences[0];
          const highlighted =
            playable && activePrinted === printedIndex && completed < formula.steps.length;
          return (
            <button
              key={printedIndex}
              className={`${highlighted ? "is-active" : ""} ${step.hint?.color ? `cd-${step.hint.color}` : ""}`}
              aria-current={highlighted ? "step" : undefined}
              aria-label={`定位到原表第 ${step.index + 1} 个动作 ${token.replaceAll("'", "′")} 前`}
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
    {repetitions.length > 0 && <div className="cd-repeat-navigation" style={{display:'flex',flexWrap:'wrap',gap:'6px 12px',alignItems:'center',fontSize:12,color:'#a9bac5',padding:'0 0 7px'}}>
      {repetitions.map((groups,index) => <label key={groups[0].index} style={{display:'inline-flex',gap:6,alignItems:'center'}}>
        <span>{repetitions.length > 1 ? `重复组 ${index+1}` : '重复组'}</span>
        <select aria-label={`重复组 ${index+1} 轮次`} disabled={!playable}
          value={groups.some(group => group.index === activeGroup) ? activeGroup : groups[0].index}
          onChange={event => onSeek(formula.groups[Number(event.target.value)].start)}
          style={{font:'inherit',color:'#d1e0e8',background:'#162630',border:'1px solid #354b59',borderRadius:5,minHeight:28,padding:'2px 6px'}}>
          {groups.map((group,round) => <option key={group.index} value={group.index}>第 {round+1} 轮（第 {group.start+1} 步起）</option>)}
        </select>
      </label>)}
    </div>}
  </>);
}
