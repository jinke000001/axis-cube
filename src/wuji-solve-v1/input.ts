import{applyAlgorithm,parseAlgorithm,snapshots,SOLVED,type Palette}from'../core/cube';import{readSession,type Session}from'../core/session';import type{FormulaGroup,FormulaStep}from'../demonstrator/types';import{compileRestoreProgram,type RestoreProgram}from'../wuji-samples/solve-program-c113';
export interface RestoreSource{id:'personal-solve';key:string;initialState:string;palette:Palette;steps:readonly FormulaStep[];groups:readonly FormulaGroup[];program:RestoreProgram;states:readonly string[];session:Session;}
export type RestoreState=Omit<RestoreSource,'program'>;
export function prepareRestoreState(raw:Session):RestoreState{
 const session=readSession(raw),moves=parseAlgorithm(session.solution);if(applyAlgorithm(session.facelets,moves)!==SOLVED)throw Error('解序没有还原输入局面，已阻止机械播放。');
 const groups:FormulaGroup[]=session.phases?.map((p,index)=>({index,text:p.name,start:p.start,end:p.end}))??[{index:0,text:'完整复原',start:0,end:moves.length}],steps:FormulaStep[]=moves.map((move,index)=>({index,move,printedIndex:index,group:Math.max(0,groups.findIndex(g=>index>=g.start&&index<g.end))})),states=snapshots(session.facelets,moves);
 if(states.at(-1)!==SOLVED)throw Error('机械动作与真实解序不一致，已停止。');
 return{id:'personal-solve',key:JSON.stringify([session.facelets,session.solution,session.palette,session.createdAt]),initialState:session.facelets,palette:session.palette,steps,groups,states,session};
}
/** Real normalized facelets and the user's center palette cross this boundary.
 * A matching final state and all supplied CFOP phase boundaries are required. */
export function prepareRestore(raw:Session):RestoreSource{
 const base=prepareRestoreState(raw),moves=base.steps.map(s=>s.move),program=compileRestoreProgram(moves);
 if(program.steps.length!==moves.length||program.steps.some((s,i)=>JSON.stringify(s.move)!==JSON.stringify(moves[i])))throw Error('机械动作与真实解序不一致，已停止。');
 return{...base,program};
}
