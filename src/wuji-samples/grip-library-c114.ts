import { getFormula } from '../demonstrator/catalog';
import type { FingerProgram } from '../scene/finger-program';
import { createDoubleStrokeProgram } from './double-stroke-c110';
import { createGripPhraseC114, C114_FIRST_IDS } from './grip-phrase-c114';
import { nativeC114, type C114Instruction } from './grip-native-c114';
import { adaptSourceNativeC114, sourceNativeC114 } from './grip-source-c114';
import { compileGripSequenceC114 } from './grip-sequence-c114';

const cache=new Map<string,FingerProgram>();
/** Migration compiler, deliberately separate from the accepted U7 provider. */
export function createGripLibraryC114(id:string):FingerProgram {
  if(cache.has(id))return cache.get(id)!;
  if((C114_FIRST_IDS as readonly string[]).includes(id)){const p=createGripPhraseC114(id);cache.set(id,p);return p;}
  const formula=getFormula(id);if(!formula)throw Error('Unknown source formula '+id);
  const old=createDoubleStrokeProgram(id),sources=new Map<C114Instruction,FingerProgram>();
  const instructions=formula.steps.map((step,index)=>{
    const p=sourceNativeC114(old,index),turn=p.segments.find(s=>s.stage==='TURN');if(!turn?.active)throw Error('Original driver missing');
    const instruction:C114Instruction={move:step.move,hand:turn.active,finger:turn.finger};sources.set(instruction,p);return instruction;
  });
  const factory:typeof nativeC114=(instruction,before,options)=>{
    const m=instruction.move,original=sources.get(instruction)!;
    if(!m.kind&&(['R','L'].includes(m.face)||m.face==='U'&&(m.notation==='U2'||instruction.finger===2||m.turns===3&&instruction.finger===1)))return nativeC114(instruction,before,options);
    return adaptSourceNativeC114(original,m);
  };
  const program=compileGripSequenceC114(instructions,{native:factory});cache.set(id,program);return program;
}
