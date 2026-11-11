import{createApprovedProgram as baseline}from'../wuji-exhibition-u5-r3/program';
import{createLocalMiddleDoubleProgram}from'./middle-double-local-c110';
import{createLocalBottomDoubleProgram}from'./bottom-double-local-c110';
import{createLocalU2Program}from'./compact-relay-local-c111';
import{createRetainedWidePairProgram}from'./retained-wide-pair-c112';
import type{FingerProgram,FingerSegment}from'../scene/finger-program';

/** Substitute only the two primitive stroke ranges, retaining accepted entry
 * and exit hands. Timeline and original-step boundaries derive from new parts. */
export function createDoubleStrokeProgram(id:string):FingerProgram{
 const old=id==='gan-oll-18'?createRetainedWidePairProgram(id):baseline(id),replacements=new Map<number,{end:number;parts:FingerSegment[];reference:number}>();
 for(const[stepIndex,step]of old.steps.entries()){
  if(!["M2'",'D2','U2'].includes(step.move.notation))continue;
  const isU2=step.move.notation==='U2';
  const indexes=old.segments.flatMap((s,i)=>s.index===stepIndex&&(isU2?['PREPARE','CONTACT','TURN','RELEASE'].includes(s.stage)||s.phase==='食指保持屈收 · 中指近距接力':/^(第一拨|第二拨)/.test(s.phase))?[i]:[]);
  if(!indexes.length)throw new Error('Missing original double-stroke primitive '+id);
  const start=indexes[0],end=indexes.at(-1)!,p=isU2?createLocalU2Program():step.move.notation==="M2'"?createLocalMiddleDoubleProgram():createLocalBottomDoubleProgram();
  replacements.set(start,{end,parts:p.segments.filter(s=>s.stage!=='HOLD').map(s=>({...s,index:stepIndex})),reference:old.segments[start].start});
 }
 if(!replacements.size)return old;
 const segments:FingerSegment[]=[],references:((p:number)=>number)[]=[];let duration=0;
 const append=(part:FingerSegment,reference:(p:number)=>number)=>{segments.push({...part,start:duration});references.push(reference);duration+=part.duration;};
 for(let i=0;i<old.segments.length;i++){
  const replacement=replacements.get(i);
  if(replacement){for(const s of replacement.parts)append(s,()=>replacement.reference);i=replacement.end;}
  else{const s=old.segments[i];append(s,p=>s.start+p*s.duration);}
 }
 const steps=old.steps.map((s,index)=>{const parts=segments.filter(part=>part.index===index);return{...s,start:parts[0].start,duration:parts.reduce((total,p)=>total+p.duration,0)};});
 return{...old,duration,cost:duration,segments,steps,sample(t){
  if(t>=duration)return old.sample(old.duration);
  const i=segments.findIndex(s=>t<s.start+s.duration),s=segments[i<0?segments.length-1:i],progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress),reference=old.sample(references[i<0?segments.length-1:i](progress));
  return{...reference,...f,index:s.index,complete:false,phase:s.phase,stage:s.stage,active:s.active,activeFinger:s.finger,support:s.active==='left'?'right':'left',progress};
 }};
}
