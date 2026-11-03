import type { FingerHint } from './types';
import data from './chart-hints.json';

export type ChartColor = 'blue' | 'red' | 'orange';
/** Printed-token indices, before expanding parenthesized repetitions. */
export const CHART_HINTS = data as Readonly<Record<string, Readonly<Record<number, ChartColor>>>>;

export function chartHint(id: string, printedIndex: number): FingerHint | undefined {
  const color = CHART_HINTS[id]?.[printedIndex];
  if (!color) return undefined;
  if (color === 'blue') return { hand: 'left', finger: 'index', source: 'chart', color, reason: '原表蓝字：左食指拨动。' };
  if (color === 'red') return { hand: 'right', finger: 'thumb', source: 'chart', color, reason: '原表红字：右拇指拨动。' };
  return { finger: 'ring', source: 'chart', color, reason: '原表橙字中文指定无名指；左右手依连续握姿编排。' };
}
