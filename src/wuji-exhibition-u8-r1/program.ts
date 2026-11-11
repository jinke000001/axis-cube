import{approvedEntry}from'./availability';
import{createGripLibraryC114}from'../wuji-samples/grip-library-c114';
import type{FingerProgram}from'../scene/finger-program';
export{sourceBoundary}from'../wuji-exhibition-u4-r2/program';
export function createApprovedProgram(id:string):FingerProgram{if(!approvedEntry(id))throw new Error('本条演示仍在校准');return createGripLibraryC114(id);}
