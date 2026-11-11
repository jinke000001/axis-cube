import {useMemo} from 'react';
import {useRestore as useOriginalRestore} from '../wuji-solve-v1/use-restore';
import {compileGripSolveC114} from '../wuji-samples/grip-solve-c114';
/** Recognition, input, solution, palette, phases and all storage writes stay
 * with the unchanged accepted flow. Only its in-memory motion provider changes. */
export function useRestore(){
  const original=useOriginalRestore();
  const adapted=useMemo(()=>{
    if(!original.state.source)return{source:null,error:''};
    try{const source=original.state.source,program=compileGripSolveC114(source.steps.map(s=>s.move));return{source:{...source,program},error:''};}
    catch(e){console.warn('G1 motion adaptation failed',e);return{source:null,error:'这段复原动作暂时无法显示。原局面与解序已保留，请重新打开或导出局面。'};}
  },[original.state.source]);
  return{flow:original.flow,state:{...original.state,source:adapted.source,error:adapted.error||original.state.error}};
}
