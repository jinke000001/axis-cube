import { applyAlgorithm, DEFAULT_PALETTE, parseAlgorithm, SOLVED } from "./cube";
import type { Session } from "./session";

export interface FingerStudy {
  id: string;
  name: string;
  algorithm: string;
  description: string;
  focus: string;
  mode?: "competitive";
}

/** Small, deliberately chosen phrases; these never replace a saved cube. */
export const FINGER_STUDIES: readonly FingerStudy[] = [
  { id: "u", name: "右食指拨层", algorithm: "U", description: "从后向前，一指完成四分之一圈。", focus: "观察主动指与静止层支撑的分工" },
  { id: "u-prime", name: "左食指拨层", algorithm: "U'", description: "左右交换角色，前方朝向保持。", focus: "观察左食指的镜像轨迹" },
  { id: "u-double", name: "右手双拨", algorithm: "U2", description: "食指先拨，中指接续。", focus: "观察第二指提前准备与第一指退出" },
  { id: "u-double-prime", name: "左手反向双拨", algorithm: "U2'", description: "相同终点，换一条更合手的路径。", focus: "U2与U2′的方向和手指分配不同" },
  { id: "ru", name: "RU 触发块", algorithm: "R U R' U'", description: "腕转之后接拨层，再顺势返回。", focus: "观察R后的腕姿态怎样留给下一步" },
  { id: "left-trigger", name: "左手触发块", algorithm: "L' U' L U", description: "让左手承担主转，右手接应。", focus: "左右协作遵循接触位置，不固定主从" },
  { id: "f2l-insert", name: "F2L 短插入", algorithm: "U R U' R'", description: "将一组角棱配对连贯送入槽位。", focus: "观察拨层、腕转和回握组成一个短句" },
  { id: "sune", name: "Sune 连续手法", algorithm: "R U R' U R U2' R'", description: "连续RU衔接，收尾接左手双拨。", focus: "观察长句中的另一只手提前准备" },
];

export const EXTENDED_STUDIES: readonly FingerStudy[] = [
  { id:"front-double",name:"正面双拨",algorithm:"F2",description:"正面保持朝前，食指、中指接力拨层。",focus:"观察另一只手改变支点，让开前层并持续承托" },
  { id:"down-finger",name:"底层指拨",algorithm:"D",description:"手指到达底层，魔方整体朝向不变。",focus:"观察承托手释放下层、主动手完成拨动" },
  { id:"back-finger",name:"背面指拨",algorithm:"B'",description:"左食指接管背层，右手承托前方。",focus:"切换俯视或透视手部，可以看清背面指腹接触" },
  { id:"two-f2l",name:"两组 F2L 连接",algorithm:"U R U' R' U' L' U L",description:"一组结束，另一只手接续插入。",focus:"观察左右短句之间的预备和承托交接" },
  { id:"middle-combination",name:"M 中层组合",algorithm:"M",description:"通过 x′、R、L′ 完成中层的等价变化。",focus:"当前机械手采用转体组合完成 M；逐步显示实际执行动作" },
  { id:"wide-combination",name:"宽层组合",algorithm:"Rw U Rw'",description:"宽层操作与食指拨层连接。",focus:"Rw 以 x、L 组合执行，保留真实转体和回握" },
  { id:"whole-rotation",name:"必要的转面",algorithm:"x U x'",description:"双手转面、拨层，再回到原朝向。",focus:"观察两手共同转体及轮流回接，不丢失承托" },
];
export const COMPETITIVE_STUDIES: readonly FingerStudy[] = [
  { id:"thumb-front",name:"拇指正面推拨",algorithm:"F F'",mode:"competitive",description:"拇指贴住前层，小幅腕随动完成推拨。",focus:"观察正反拨层间保留的握姿和另一只手的支点" },
  { id:"ring-down",name:"无名指底层拨动",algorithm:"D D'",mode:"competitive",description:"左右无名指接管底层，腕部在拨动时保持稳定。",focus:"观察无名指主动拨层与支撑手的分工" },
  { id:"ring-pinky-double",name:"无名指与小指双拨",algorithm:"D2 D2'",mode:"competitive",description:"小指提前预备，接续无名指完成半圈。",focus:"观察小指半预备、无名指让位和第二次拨动" },
  { id:"five-finger-phrase",name:"五指连续手法",algorithm:"F' D2 U2 R U R' F",mode:"competitive",description:"拇指、无名指、小指、食指与中指共同参与。",focus:"观察手指职责与握姿随整段动作变化" },
  { id:"yaw-handoff",name:"顺势换面与插入",algorithm:"y R U R' y'",mode:"competitive",description:"一手持握转体，另一手提前准备接回。",focus:"转体后的中心色随实物变化，收尾恢复原朝向" },
];
export const ALL_FINGER_STUDIES=[...FINGER_STUDIES,...EXTENDED_STUDIES,...COMPETITIVE_STUDIES];

export function studySession(study: FingerStudy): Session {
  const inverse = parseAlgorithm(study.algorithm).reverse().map((move) => {
    const symbol = move.notation.replace(/[2']+$/, "");
    return symbol + (move.turns === 1 ? "'" : move.turns === 3 ? "" : "2");
  }).join(" ");
  return {
    version: 1, name: study.name, facelets: applyAlgorithm(SOLVED, inverse),
    solution: study.algorithm, palette: { ...DEFAULT_PALETTE },
    createdAt: "2026-10-25T00:00:00.000Z",
  };
}
