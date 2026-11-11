import type{Move}from'../core/cube';import{motionWording as previousWording}from'./motion-wording-v2';
/** The preserved Rx180 back-wide data inherits front-plane phrases. Match
 * the actual normal of index(-Y) and thumb(+Y) without editing frozen motion. */
export function motionWording(phase:string,move?:Move){const text=previousWording(phase,move);return move?.kind==='wide'&&move.face==='B'?text.replace('指尖侧垫接触后侧两层后侧','指尖侧垫接触后侧两层下侧').replace('右拇指接近前侧','右拇指接近后层上侧'):text;}
