import type{Move}from'../core/cube';
/** Wording for rigidly placed variants. Geometry producers remain frozen. */
export function motionWording(phase:string,move?:Move){
 if(move?.notation==='U')return phase.replace('从上层右侧靠近','从上层背侧靠近');
 if(move?.notation==="F'")return phase.replace('左食指侧垫接触上层后侧','左食指侧垫接触前层上侧');
 return phase;
}
