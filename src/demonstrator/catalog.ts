import { applyAlgorithm, parseMove, SOLVED } from '../core/cube';
import { CFOP_CASES } from '../learning/cfop-library';
import { chartHint } from './chart-hints';
import type { FormulaGroup, FormulaRecord, FormulaStep } from './types';

/** Preserve printed tokens and groups; only an explicit ()2 repeats a group. */
export function parsePrintedFormula(algorithm: string, id: string): Pick<FormulaRecord, 'steps' | 'groups'> {
  const tokens = algorithm.replace(/[’′]/g, "'").match(/[()]|[^\s()]+/g) ?? [];
  let cursor = 0, printed = 0;
  const steps: FormulaStep[] = [], groups: FormulaGroup[] = [];
  const add = (items: { text: string; printedIndex: number }[], text: string) => {
    const index = groups.length, start = steps.length;
    for (const item of items) steps.push({ index: steps.length, move: parseMove(item.text), group: index,
      printedIndex: item.printedIndex, ...(chartHint(id, item.printedIndex) ? { hint: chartHint(id, item.printedIndex) } : {}) });
    groups.push({ index, text, start, end: steps.length });
  };
  while (cursor < tokens.length) {
    if (tokens[cursor] === '(') {
      cursor++;
      const items: { text: string; printedIndex: number }[] = [];
      while (cursor < tokens.length && tokens[cursor] !== ')') {
        if (tokens[cursor] === '(') throw new Error('Nested source groups require explicit review.');
        items.push({ text: tokens[cursor++], printedIndex: printed++ });
      }
      if (tokens[cursor++] !== ')') throw new Error('Unclosed source group.');
      const repeat = /^[2-9]$/.test(tokens[cursor] ?? '') ? Number(tokens[cursor++]) : 1;
      for (let i = 0; i < repeat; i++) add(items, `(${items.map(item => item.text).join(' ')})`);
    } else {
      const items: { text: string; printedIndex: number }[] = [];
      while (cursor < tokens.length && tokens[cursor] !== '(') {
        if (tokens[cursor] === ')') throw new Error('Unexpected source group end.');
        items.push({ text: tokens[cursor++], printedIndex: printed++ });
      }
      add(items, items.map(item => item.text).join(' '));
    }
  }
  return { steps, groups };
}

export const FORMULAS: readonly FormulaRecord[] = CFOP_CASES.flatMap(item => [item.algorithm, ...(item.alternateAlgorithms ?? [])].map((algorithm, variant) => {
  const id = variant === 0 ? item.id : `${item.id}-alt-${variant}`;
  return { id, case: item, variant, label: variant === 0 ? '原表主公式' : `原表替代公式 ${variant}`, algorithm,
    ...parsePrintedFormula(algorithm, id), initialState: applyAlgorithm(SOLVED, item.setup),
    sources: [{ url: item.sourceUrl, title: 'GAN CFOP 原表', reviewed: true,
      note: '公式、分组及编号以用户提供的本地四张原表为准；公开链接仅作来源入口，网页版本不覆盖原表。' }],
  };
}));

const byId = new Map(FORMULAS.map(item => [item.id, item]));
export const getFormula = (id: string): FormulaRecord | undefined => byId.get(id);
export const getCaseFormulas = (caseId: string): readonly FormulaRecord[] => FORMULAS.filter(item => item.case.id === caseId);
