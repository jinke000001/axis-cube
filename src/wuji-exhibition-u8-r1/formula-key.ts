import type{FormulaRecord}from'../demonstrator/types';
/** Runtime equality check against the independently verified original chart. */
export const formulaKey=(f:FormulaRecord)=>JSON.stringify([f.id,f.algorithm,f.steps,f.groups,f.initialState,f.case.recognitionFixture]);
