import { describe, expect, it } from 'vitest';
import { applyAlgorithm, FACES, normalizeColors, parseAlgorithm, SLOTS, SOLVED, validateFacelets } from '../core/cube';
import { CFOP_CASES } from '../learning/cfop-library';
import diagrams from '../../evidence/museum-upgrade-2026-11-01/formulas/source-diagram-fixtures.json';
import arrows from '../../evidence/museum-upgrade-2026-11-01/formulas/pll-arrow-fixtures.json';
import { FORMULAS, getCaseFormulas, getFormula, parsePrintedFormula } from './catalog';
import { CHART_HINTS } from './chart-hints';

const base = applyAlgorithm(SOLVED, 'x2');
const piece = (state: string, topIndex: number) => SLOTS.filter(slot => slot.position.every((v, i) => v === SLOTS[topIndex].position[i]))
  .map(slot => state[slot.index]).sort().join('');
const homes = Array.from({ length: 9 }, (_, i) => piece(base, i));

describe('Original GAN chart demonstrations', () => {
  it('has all 119 original cases and both separately addressable alternatives', () => {
    expect(FORMULAS).toHaveLength(121);
    expect(new Set(FORMULAS.map(f => f.id)).size).toBe(121);
    expect(Object.keys(CHART_HINTS).sort()).toEqual(FORMULAS.map(f => f.id).sort());
    for (const item of CFOP_CASES) {
      const variants = getCaseFormulas(item.id);
      expect(variants).toHaveLength(1 + (item.alternateAlgorithms?.length ?? 0));
      expect(getFormula(item.id)?.variant).toBe(0);
      expect(variants[0].algorithm).toBe(item.algorithm);
    }
    expect(getFormula('gan-pll-01-alt-1')?.algorithm.endsWith("R2')")).toBe(true);
    expect(getFormula('does-not-exist')).toBeUndefined();
  });

  it.each(FORMULAS.map(f => [f.id, f] as const))('%s preserves the source steps and starts in the independently recorded case', (_id, formula) => {
    const item = formula.case, state = formula.initialState;
    expect(formula.steps.map(step => step.move)).toEqual(parseAlgorithm(formula.algorithm));
    expect(formula.steps.map(step => step.index)).toEqual(formula.steps.map((_, index) => index));
    expect(formula.groups.map(group => group.index)).toEqual(formula.groups.map((_, index) => index));
    expect(formula.groups.flatMap(group => formula.steps.slice(group.start, group.end).map(step => step.index)))
      .toEqual(formula.steps.map(step => step.index));
    for (const group of formula.groups) {
      expect(group.end).toBeGreaterThan(group.start);
      for (const step of formula.steps.slice(group.start, group.end)) expect(step.group).toBe(group.index);
    }
    const normalized = normalizeColors(state);
    expect(validateFacelets(normalized.facelets, normalized.palette).valid).toBe(true);
    for (let face = 0; face < 6; face++) expect(state[face * 9 + 4]).toBe(base[face * 9 + 4]);
    // These are source-stage constraints, not a consequence of algorithm inversion.
    const protectedSlots = SLOTS.filter(slot => item.stage === 'F2L'
      ? slot.position[1] < 1 && !(slot.position[0] === 1 && slot.position[2] === 1)
      : slot.position[1] < 1);
    for (const slot of protectedSlots) expect(state[slot.index]).toBe(base[slot.index]);
    if (item.stage === 'F2L') {
      const chart = diagrams.f2l.find(f => f.number === item.sourceNumber)!;
      for (const face of ['U', 'F', 'R'] as const) chart[face].split('').forEach((color, i) => {
        if (color !== '.') expect(state[FACES.indexOf(face) * 9 + i]).toBe(color);
      });
    } else if (item.stage === 'OLL') {
      const chart = diagrams.oll.find(f => f.number === item.sourceNumber)!;
      expect(state.slice(0, 9).split('').map(c => c === 'D' ? '1' : '0').join('')).toBe(chart.top);
      expect([47, 46, 45, 11, 10, 9, 18, 19, 20, 36, 37, 38].map(i => state[i] === 'D' ? '1' : '0').join('')).toBe(chart.bars);
    } else {
      expect(state.slice(0, 9)).toBe('DDDDDDDDD');
      const chart = arrows.cases.find(f => f.number === item.sourceNumber)!;
      const expected = Array.from({ length: 9 }, (_, i) => i);
      for (const cycle of chart.cycles) cycle.forEach((slot, i) => { expected[slot] = cycle[(i + 1) % cycle.length]; });
      expect(expected.map((_, i) => homes.indexOf(piece(state, i)))).toEqual(expected);
    }
    const result = applyAlgorithm(state, formula.steps.map(step => step.move));
    expect(FACES.every((_, i) => result.slice(i * 9, i * 9 + 9) === result[i * 9 + 4].repeat(9))).toBe(true);
    for (const [index, color] of Object.entries(CHART_HINTS[formula.id])) {
      const copies = formula.steps.filter(step => step.printedIndex === Number(index));
      expect(copies.length).toBeGreaterThan(0);
      for (const step of copies) {
        expect(step.hint?.color).toBe(color);
        expect(step.hint?.source).toBe('chart');
        expect(step.hint?.finger).toBe(color === 'blue' ? 'index' : color === 'red' ? 'thumb' : 'ring');
        expect(step.hint?.hand).toBe(color === 'blue' ? 'left' : color === 'red' ? 'right' : undefined);
      }
    }
  });

  it('keeps printed repetitions, separate U-prime gestures and the direction of half turns', () => {
    const f2l12 = getFormula('gan-f2l-12')!;
    expect(f2l12.steps.slice(0, 4).map(s => s.printedIndex)).toEqual([0, 1, 2, 3]);
    expect(f2l12.steps.slice(4, 8).map(s => s.printedIndex)).toEqual([0, 1, 2, 3]);
    expect(f2l12.groups.map(g => [g.start, g.end])).toEqual([[0, 4], [4, 8], [8, 11]]);
    const f2l1 = getFormula('gan-f2l-01')!;
    expect(f2l1.steps.slice(8, 10).map(s => [s.move.notation, s.hint?.color])).toEqual([["U'", 'red'], ["U'", 'blue']]);
    const ua = getFormula('gan-pll-01')!;
    expect(ua.steps).toHaveLength(7);
    expect(ua.steps[0].move).toMatchObject({ notation: "M2'", kind: 'slice', layers: [0], direction: -1 });
    expect(getFormula('gan-pll-01-alt-1')!.steps.at(-1)?.move.direction).toBe(-1);
    expect(getFormula('gan-oll-47')!.steps[0].move.kind).toBe('wide');
    expect(getFormula('gan-pll-12')!.steps[0].move).toMatchObject({ notation: 'z', kind: 'rotation' });
  });

  it('retains source-specific colored exceptions instead of assigning a gesture by letter', () => {
    expect(getFormula('gan-pll-13')!.steps[3].hint).toMatchObject({ color: 'blue', hand: 'left', finger: 'index' });
    expect(getFormula('gan-oll-34')!.steps[10].hint).toMatchObject({ color: 'orange', finger: 'ring' });
    expect(getFormula('gan-oll-31')!.steps.slice(1, 4).map(s => s.hint?.color)).toEqual(['red', 'red', 'red']);
    expect(getFormula('gan-f2l-40')!.steps.every(s => !s.hint)).toBe(true);
  });

  it('rejects unreviewed malformed or nested source groups', () => {
    expect(() => parsePrintedFormula('(R U', 'invalid')).toThrow();
    expect(() => parsePrintedFormula('((R U))', 'invalid')).toThrow();
    expect(() => parsePrintedFormula('R U)', 'invalid')).toThrow();
  });
});
