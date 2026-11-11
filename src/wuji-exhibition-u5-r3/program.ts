import{approvedEntry}from'./availability';
import{createContextHandoffProgram}from'../wuji-samples/context-handoff-c109';
import type{FingerProgram}from'../scene/finger-program';
export{sourceBoundary}from'../wuji-exhibition-u4-r2/program';
export function createApprovedProgram(id:string):FingerProgram{if(!approvedEntry(id))throw new Error('本条演示仍在校准');return createContextHandoffProgram(id);}
