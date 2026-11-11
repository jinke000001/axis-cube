import{createLowerWidePhrase}from'./lower-wide-phrase';import type{FingerProgram}from'../scene/finger-program';
/** Keep the already-sampled physical trajectory verbatim. The authoring
 * prototype defaulted unmarked d-prime step labels to right; its real segment
 * and drive contacts correctly use the left. Expose consistent step metadata. */
export function createLowerWideProgram(id:string):FingerProgram{
 const p=createLowerWidePhrase(id);return{...p,steps:p.steps.map((s,index)=>({...s,active:p.segments.find(part=>part.index===index&&part.stage==='TURN')!.active!}))};
}
