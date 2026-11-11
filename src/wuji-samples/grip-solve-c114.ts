import { type Move } from '../core/cube';
import type { FingerProgram } from '../scene/finger-program';
import { g1Pose, g1Contacts } from './grip-poses-c114';
import { assembleC114, nativeC114, type C114Instruction } from './grip-native-c114';
import { compileGripSequenceC114 } from './grip-sequence-c114';
import { adaptSourceNativeC114, sourceNativeC114 } from './grip-source-c114';
import { compileRestoreProgram, type RestoreProgram } from './solve-program-c113';
const originals=new Map<string,FingerProgram>(),adapted=new Map<string,FingerProgram>();

export function compileGripSolveC114(moves:readonly Move[]):RestoreProgram {
  if(!moves.length){
    const p=assembleC114([{index:0,start:0,duration:.6,stage:'HOLD',phase:'已经还原 · G1稳持',active:null,sample:()=>({left:g1Pose('left','support'),right:g1Pose('right','support'),contacts:[...g1Contacts('left','support'),...g1Contacts('right','support')],angle:0})}],[]);
    return{...p,geometryStateKey:'c114-already-solved',sample:t=>({...p.sample(t),index:0,complete:true,active:null})};
  }
  const sources=new Map<C114Instruction,FingerProgram>();
  const instructions=moves.map(move=>{let original=originals.get(move.notation);if(!original){original=sourceNativeC114(compileRestoreProgram([move]),0);originals.set(move.notation,original);}const turn=original.segments.find(s=>s.stage==='TURN')!;
    const instruction:C114Instruction={move,hand:turn.active!,finger:turn.finger};sources.set(instruction,original);return instruction;
  });
  const factory:typeof nativeC114=(instruction,before,options)=>{
    const m=instruction.move;if(!m.kind&&(['R','L'].includes(m.face)||m.face==='U'&&(m.notation==='U2'||m.turns!==2&&instruction.finger===2)))return nativeC114(instruction,before,options);
    let p=adapted.get(m.notation);if(!p){p=adaptSourceNativeC114(sources.get(instruction)!,m);adapted.set(m.notation,p);}return p;
  };
  const p=compileGripSequenceC114(instructions,{native:factory});
  return p;
}
