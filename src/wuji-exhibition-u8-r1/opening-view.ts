import type{FormulaRecord}from'../demonstrator/types';
/** G1 and C5 front/right material pads stay visible from the higher front
 * preset. Keep the existing specialized slice and back-wide opening views. */
export const openingView=(f:FormulaRecord):'solver'|'back'|'side'=>f.steps.some(s=>s.move.notation==='M')||f.steps[0]?.move.kind==='slice'?'back':f.steps[0]?.move.kind==='wide'&&f.steps[0]?.move.face==='B'?'side':'solver';
