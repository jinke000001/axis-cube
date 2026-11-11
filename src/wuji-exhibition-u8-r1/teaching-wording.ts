import type{Move}from'../core/cube';import{motionWording}from'../wuji-samples/motion-wording-v3';
/** Keep authoring diagnostics in the motion records; show the observable
 * support/release action to the learner. Original move notation is retained. */
export function teachingWording(phase:string,move?:Move){const action=phase.replace(/^(?:G1(?:适配|上下文|连接)?\s*·\s*)+/,'');const text=motionWording(action,move).replace('按实际全手网格包围在方外上侧换腕','另一手接稳 · 在方外上侧换腕').replace('见证指尖沿方外绕角','指尖沿方外绕角');return text.replace(/^(?:复原 · )?C\d+(?:已验|连接|局部|复位)?[^·]* · /,'').replace(/\bC\d+(?:连接|已验连接)? · /g,'').replace('支撑手接稳静止前层 · 无名指上移6mm',text.startsWith('恢复原稳持')?'左手沿前侧离面':'左手三指接稳静止前层');}
