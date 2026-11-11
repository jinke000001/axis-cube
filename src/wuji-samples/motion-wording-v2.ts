import type{Move}from'../core/cube';import{motionWording as previousWording}from'./motion-wording';
/** The frozen diagnostic D-wide placement flips the old U-prime rear plane
 * onto the real front side. Correct display wording without editing its data. */
export function motionWording(phase:string,move?:Move){const text=previousWording(phase,move);return move?.kind==='wide'&&move.face==='D'&&move.turns===3?text.replaceAll('后侧','前侧'):text;}
