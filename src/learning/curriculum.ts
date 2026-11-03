import { parseAlgorithm } from "../core/cube.ts";
import type { CourseLesson, LessonCase } from "./types.ts";

/**
 * Original teaching text; method references (checked 2026-11-01):
 * https://www.gancube.com/pages/layer-by-layer-guide-of-gancube
 * https://jperm.net/3x3
 * We keep GAN's stage order and its U R U' R' corner-twisting method.
 * Our corner permutation is written with yellow UP throughout, so its grip
 * must not be substituted with the different grip in GAN's illustration.
 * Every setup is a legal move sequence, independent of the visitor's cube.
 */
const RIGHT = "U R U' R'";
const MIDDLE_RIGHT = "U R U' R' U' F' U F";
const MIDDLE_LEFT = "U' L' U L U F U' F'";
const CROSS = "F R U R' U' F'";
const CORNERS = "R' F R' B2 R F' R' B2 R2";
const EDGES = "R U' R U R U R U' R' U' R2";
const SUNE_FIXTURE = "R U R' U R U2 R'";
const WHITE_DOWN = "z2";
const HOLD = "黄色中心朝上，白色中心朝下。把示范中当前的正面朝向自己；一段公式内保持正面不变。";
const repeat = (algorithm: string, count: number) => Array(count).fill(algorithm).join(" ");
const inverse = (algorithm: string) => parseAlgorithm(algorithm).reverse().map((move) =>
  move.turns === 2 ? move.notation : move.turns === 3 ? move.face : `${move.face}'`,
).join(" ");
// Deliberately leave independent work after each insertion: other white
// corners / middle slots / last-layer pieces are not magically solved.
const LATE = `${WHITE_DOWN} ${EDGES}`;
const OTHER_CORNER = `${LATE} y2 ${RIGHT} y2`;
const OTHER_MIDDLE = `${LATE} y2 ${MIDDLE_RIGHT} y2`;
const DAISY = `${OTHER_CORNER} L2 B2 R2 F2`;

const YELLOW_CORNERS: NonNullable<LessonCase["focusPieces"]> = [
  ["D", "F", "R"], ["D", "F", "L"], ["D", "B", "R"], ["D", "B", "L"],
];
// Fixed sticker colours read from each case's setup, never from its current
// position faces. For example, the white/red edge can start at front-right.
const PIECE_FOCUS: Partial<Record<string, Pick<LessonCase, "focusPieces" | "focusLabel">>> = {
  "daisy-bottom": { focusPieces: [["U", "F"]], focusLabel: "白绿棱 · 送上黄心旁" },
  "daisy-middle-front": { focusPieces: [["U", "R"]], focusLabel: "白红棱 · 从中层抬起" },
  "daisy-middle-right": { focusPieces: [["U", "R"]], focusLabel: "白红棱 · 让白色朝上" },
  "daisy-bottom-side": { focusPieces: [["U", "F"]], focusLabel: "白绿棱 · 先到中层，再抬起" },
  "daisy-top-side": { focusPieces: [["U", "R"]], focusLabel: "白红棱 · 从朝外变为朝上" },
  "daisy-make-room": { focusPieces: [["U", "R"]], focusLabel: "白红棱 · 先让出出口，再抬起" },
  "cross-aligned": { focusPieces: [["U", "F"]], focusLabel: "白绿棱 · 送到白色中心旁" },
  "cross-align-first": { focusPieces: [["U", "F"]], focusLabel: "白绿棱 · 先对齐绿色中心" },
  "corner-white-front": { focusPieces: [["U", "F", "L"]], focusLabel: "白绿橙角 · 送入前右下的家" },
  "corner-white-up": { focusPieces: [["U", "F", "L"]], focusLabel: "白绿橙角 · 送入前右下的家" },
  "corner-white-right": { focusPieces: [["U", "F", "L"]], focusLabel: "白绿橙角 · 送入前右下的家" },
  "corner-take-out": { focusPieces: [["U", "R", "F"]], focusLabel: "白红绿角 · 先从错误槽取出" },
  "middle-insert-right": { focusPieces: [["F", "L"]], focusLabel: "绿橙棱 · 送入前右中层" },
  "middle-insert-left": { focusPieces: [["F", "R"]], focusLabel: "绿红棱 · 送入前左中层" },
  "middle-take-out": { focusPieces: [["F", "L"]], focusLabel: "绿橙棱 · 先取出翻反的棱" },
  "yellow-three-corners": { focusPieces: YELLOW_CORNERS, focusLabel: "四个黄色角 · 翻面后继续跟随" },
  "yellow-two-corners": { focusPieces: YELLOW_CORNERS, focusLabel: "四个黄色角 · 已朝下的角也要检查" },
  "yellow-four-corners": { focusPieces: YELLOW_CORNERS, focusLabel: "四个黄色角 · 固定正面，逐角处理" },
  "yellow-face-ready": { focusPieces: YELLOW_CORNERS, focusLabel: "四个黄色角 · 朝向已对，再看位置" },
  "independent-start": { focusPieces: [["U", "R"]], focusLabel: "白红棱 · 只解决眼前这一块" },
  "f2l-ready-pair": { focusPieces: [["U", "F", "L"], ["F", "L"]], focusLabel: "白绿橙角 + 绿橙棱 · 整对归位" },
  "f2l-separated": { focusPieces: [["U", "F", "L"], ["F", "L"]], focusLabel: "白绿橙角 + 绿橙棱 · 同时接入槽" },
  "f2l-white-up": { focusPieces: [["U", "F", "L"], ["F", "L"]], focusLabel: "白绿橙角 + 绿橙棱 · 先改变关系" },
};

type Segment = [moves: string, label: string, explanation: string];
function example(
  data: Omit<LessonCase, "algorithm" | "steps" | "orientation"> & { orientation?: string },
  segments: Segment[],
): LessonCase {
  let end = 0;
  return {
    ...PIECE_FOCUS[data.id],
    ...data,
    orientation: data.orientation ?? HOLD,
    algorithm: segments.map(([moves]) => moves).join(" "),
    steps: segments.map(([moves, label, explanation]) => ({
      end: end += parseAlgorithm(moves).length, label, explanation,
    })),
  };
}
function cornerInsertion(id: string, title: string, face: string, count: number): LessonCase {
  return example({
    id, title, when: `白角在右上前方，白色贴片朝${face}，另两色属于正面与右面之间的槽。`,
    setup: `${OTHER_CORNER} ${inverse(repeat(RIGHT, count))}`,
    explanation: [
      "先读角块的三种颜色，找到它真正的家。把这个家放在右下前方，再只转 U，把角块移到家的正上方。",
      `固定握姿，完整做 ${count} 组 U R U′ R′。每四步结束才检查，不能在白色偶然朝下时提前停下。`,
      "这是一块角的处理。完成后转动整颗魔方，把下一个空槽放到右前；已完成的白十字和其他白角应保持。",
    ],
    check: "右下前角的白色朝下，另外两色分别接上正面、右面中心；白十字仍与四个侧面中心对应。继续处理其余白角。",
    focusFace: "D",
  }, Array.from({ length: count }, (_, i): Segment => [RIGHT, `第 ${i + 1} 组四步`, i === count - 1 ? "完整收回右层，再检查三色都归位。" : "这一组结束仍未归位，保持握姿继续下一整组。"]));
}
function yellowCorners(id: string, title: string, setupTail: string, counts: number[]): LessonCase {
  const segments: Segment[] = [["x2", "黄面翻到下面", "整颗绕左右轴翻半圈。记住现在的正面；本轮结束前不再换正面。"]];
  counts.forEach((count, i) => {
    if (count) segments.push([repeat(RIGHT, count), `第 ${i + 1} 个位置 · ${count} 组`, "只处理右下前角。完整做完四步才看黄色是否朝下；上面的白层暂时乱是正常过程。"]);
    segments.push(["D", `底层换到第 ${i + 2 > 4 ? 1 : i + 2} 个位置`, count ? "当前黄角已朝下。只转底层 D，让下一角进入同一工作位置。" : "这一角的黄色本来朝下，跳过转角，只转 D 换下一角。"]);
  });
  segments.push(["x2", "回到黄上白下", "四个位置都检查过，底层累计转过整圈。前两层已恢复，再整颗翻回常用握姿。"]);
  return example({
    id, title, when: "前两层完整，黄十字已经做好，但有黄角没有朝上。先看整套演示，再在自己的魔方逐角判断。",
    setup: `${LATE} ${setupTail}`,
    explanation: [
      "先把黄面朝下，再固定一个正面。工作位置始终是右下前角；黄色朝下的角跳过，其余角重复 U R U′ R′，直到黄色朝下。通常需 2 或 4 整组。",
      "每处理一个位置只转 D 换下一角。不要转整颗魔方来找下一角，也不要为了救白面中途插入别的公式。",
      "本演示固定检查四个位置，每次都 D 一次，合计 D 四次。实物也这样走一整圈：包含已朝下的角，最后一次 D 不能漏。每个角需要的组数由自己的局面决定，不照抄示例次数。",
      "若已忘记做到了第几组，先回看最后一个完整四步；明确的误转可逆转退回。完全失去位置时停止，重新核对局面或用辅助还原，不凭印象继续补动作。",
    ],
    check: "翻回后上面九格全黄；底下白层与中层全部恢复。黄面完成后侧面顶角仍可能错位，下一课才处理它们。",
    focusFace: "D",
  }, segments);
}

export const LESSONS: CourseLesson[] = [
  {
    id: "meet-the-cube", number: 1, title: "认识魔方", kicker: "先认清一块，再看一面",
    summary: "中心告诉你方向，棱与角告诉你每一块的家。", goal: "能指出中心、棱、角，并判断“一面同色”是否已经完成一层。",
    prepare: ["准备一颗普通三阶魔方，不需要智能连接。颜色与示范不同也可以，始终以自己魔方的中心为准。", "先不急着打乱。中心一色、棱两色、角三色；贴片属于同一块，不能独立搬动。"],
    cases: [
      example({ id: "piece-families", title: "三种块，各有自己的家", when: "第一次拿起魔方，或还分不清棱与角。", setup: WHITE_DOWN,
        explanation: ["看正面中心：转一层时，它仍决定这一面的颜色。旁边的棱带两种颜色，归位时必须同时接上两个中心。", "右下前角带白色、正面色、右面色，三种颜色共同决定它的位置。整颗换向后名称会变，块本身的颜色组合不会变。", "先预测：只转上层，右下前角会不会移动？播放后再指认它。答案是不会，因为它不在上层。"],
        check: "能找到 6 个中心、12 条棱、8 个角；能用两色或三色指出一块属于哪个位置。", focusFace: "U",
      }, [["U", "只看一层", "上层的四个棱和四个角一起移动，下两层保持。"], ["U'", "回到起点", "反方向转回，确认每块的颜色组合没有改变。"], ["y", "整颗换方向", "六个中心一起换了朝向。换视角不等于只转上层。"]]),
      example({ id: "face-is-not-layer", title: "白面齐了，第一层却没好", when: "白色面已经同色，但侧面看起来仍不齐。", setup: `${LATE} D`,
        explanation: ["先看下面：九格都是白色。再看四周最下面一行：它们还没有接上各自中心。", "完整的一层包含底面，也包含四个侧面的底行。本例只是整层错开一格；白面同色本身不能证明角、棱都在自己的家。", "预测 D′ 后哪一种颜色会来到正面，再单步检查。其他局面若只错几块，应回到白十字或白角课，不能靠硬转底层修好所有错块。"],
        check: "白面仍同色，四个侧面底行也与中心同色，才算第一层完成。", focusFace: "D",
      }, [["D'", "让一层同时对齐", "这里只需把整层转回；同时看底面和侧面。"]]),
    ],
    checklist: ["我能按颜色组合寻找一块的家。", "我会同时检查底面与四个侧面，不只数同色贴片。"],
    pitfalls: [{ title: "把贴片当作独立小格", body: "一条棱的两张贴片永远一起移动；找白棱时也要看它的另一种颜色。" }, { title: "按示范的红绿硬套", body: "不同魔方的配色可能不同。用相邻中心确定位置，不用死记屏幕左边是哪种颜色。" }],
    practice: "不看提示，指出任意一条棱、一个角和它们的家。再转 U 一次，解释为什么下面两层没变。", relatedStudyIds: ["whole-rotation"],
  },
  {
    id: "read-a-turn", number: 2, title: "看懂一次转动", kicker: "公式是方向说明，不是密码",
    summary: "学会读六个面、逆转、半圈和整颗换向。", goal: "能保持握姿，准确跟做短公式，并知道怎样撤销已知的一步。",
    prepare: ["U 上、D 下、R 右、L 左、F 前、B 后。字母指当下的位置，不永久指某种颜色。", "没有撇是顺时针；带 ′ 是逆时针；2 是半圈。顺逆都要想象自己正对正在转的那一面。"],
    cases: [
      example({ id: "six-faces", title: "逐个找出六个面", when: "能认块，但还会把后面或底面的方向看反。", setup: WHITE_DOWN,
        explanation: ["每个面先顺转一次，再逆转回来。特别看 B 与 D：从正面看它们的运动，直觉可能与正对该面时相反。", "保持绿色中心朝前，仅视线跟随，不在公式中途把整颗魔方转过来。"],
        check: "六组都结束后回到原局面；你能在不转整颗魔方的情况下指出下一个字母对应的层。",
      }, [["U U'", "上层 U", "从上往下看这个面判断顺逆。"], ["R R'", "右层 R", "想象站到魔方右侧，正对右面。"], ["F F'", "前层 F", "正对自己的这一面。"], ["D D'", "下层 D", "想象从下面向上看。"], ["L L'", "左层 L", "想象站到左侧，正对左面。"], ["B B'", "后层 B", "想象站到魔方背后，正对后面。"]]),
      example({ id: "quarter-half-rotation", title: "一格、半圈，与整颗换向", when: "想分清 R、R2 和 x 的区别。", setup: `${LATE} U`,
        explanation: ["R2 是右层转半圈，算一个记号、两个四分之一圈。最后方向相同，可顺着手转。", "x 是整颗魔方沿左右轴，朝 R 的方向换握姿；y 沿上下轴，朝 U 的方向换握姿；z 沿前后轴，朝 F 的方向换握姿。它们会一起改变所有中心的朝向。", "撤销一串动作要倒着读、每步反向：R U 的撤销是 U′ R′，不是 R′ U′。"],
        check: "演示结束与开始状态完全相同；你能说出层转与整颗换向的区别。",
      }, [["R R", "两次四分之一圈", "两次 R 合起来就是 R2。"], ["R2", "半圈回到起点", "半圈的逆动作仍是半圈。"], ["x x' y y' z z'", "中心一起换方向", "每次整颗换向后又换回来；观察中心而不是只追一片颜色。"], ["R U U' R'", "倒序撤销", "先做 R U，再用 U′ R′ 退回。"]]),
    ],
    checklist: ["我知道顺逆时针要正对被转的面判断。", "我能读 U R U′ R′，也知道整颗换向会改变后续字母的含义。"],
    pitfalls: [{ title: "把 R′ 当作左层", body: "R 和 R′ 都转右层，只是方向相反。" }, { title: "一边转屏幕，一边改实物握姿", body: "观察视角可以换，公式的正面参照不能无声改变。先摆正，再执行。" }],
    practice: "先口述 U、R、U′、R′ 的层与方向，再每次只做一步。慢而准确比一次顺完更有用。", relatedStudyIds: ["u", "u-prime", "u-double", "whole-rotation"],
  },
  {
    id: "white-daisy", number: 3, title: "做出小花", kicker: "先收集四条白棱",
    summary: "让四片白色围着黄色中心，不急着处理角。", goal: "从任意合法打乱里找到四条白棱，逐条搬到黄色中心旁边。",
    prepare: ["黄中心朝上、白中心朝下。只找带白色的棱，不理白角。", "每次先看它会到哪个顶层位置；已有花瓣时先转 U 让出空位，再动目标所在的侧面。"],
    cases: [
      example({ id: "daisy-bottom", title: "白色朝下：半圈送上来", when: "白棱在底层前方，白色朝下，顶层前方没有花瓣。", setup: `${WHITE_DOWN} L2 U2`, explanation: ["把目标棱所在侧面朝前。F2 会把底层前棱直接送到顶层前方，白色朝上。", "若顶层前方已有白花瓣，先转 U 把它挪开。只要目标出口是空的，这一转不会挤掉已有花瓣。"], check: "顶面白色花瓣多一片，原有花瓣仍在顶面。继续找另一条白棱。", focusFace: "U" }, [["F2", "半圈上来", "只转正面半圈。白色由下面来到黄色中心前方。"]]),
      example({ id: "daisy-middle-front", title: "在中层，白色朝前", when: "白棱位于前右的中层，白色贴片在正面，顶层右边是空位。", setup: `${WHITE_DOWN} U' L' F' U F2 F U L' L U`, explanation: ["这条棱在右层里。R 会把它抬到顶层右边，白色随之朝上。", "若白棱在其他中层位置，先把整颗魔方横向换向，让它来到前右，再判断白色朝前还是朝右。"], check: "白棱来到顶层右边，花瓣数增加。", focusFace: "U" }, [["R", "从中层抬起", "看准右上出口后，把右层顺转一次。"]]),
      example({ id: "daisy-middle-right", title: "在中层，白色朝右", when: "白棱位于前右中层，但白色贴片在右面，顶层前方是空位。", setup: `${WHITE_DOWN} U' L2 U L F' U F2 U' F U2 L2 F`, explanation: ["位置相同，白色朝向不同，动作也不同。此时用 F′，让白色从右面转到上面。", "不要直接沿用上一情形的 R；先看白贴片在哪一面，再选出口。"], check: "白棱来到顶层前方，白色朝上；原有花瓣未丢失。", focusFace: "U" }, [["F'", "向顶层前方送", "正面逆转四分之一圈。"]]),
      example({ id: "daisy-bottom-side", title: "在底层，白色朝侧面", when: "白棱在底层前方，白色朝前；示例顶层前方和右方都没有花瓣。", setup: `${WHITE_DOWN} F' U F' L F2 U' F2 U L F' U`, explanation: ["直接 F2 会把它送到顶层，但白色仍朝侧面。先 F′ 把它带到前右中层，再用 R 抬起。", "只有一个空位也能做：先转 U 让前上为空，再 F′。目标到了中层后，再转 U 给右上让空，最后 R。每次侧面转动前各自检查出口，不能在前上仍有花瓣时直接 F′。"], check: "目标白色真正朝上。不要把顶层侧面上的白色误算成花瓣。", focusFace: "U" }, [["F'", "先来到中层", "白棱来到前右，白色仍朝前。"], ["R", "再抬到上面", "用已学过的中层朝前情形；示例右上已空，实物若被占先用 U 让位。"]]),
      example({ id: "daisy-top-side", title: "已在顶层，白色却朝外", when: "白棱在顶层前方，白色朝前；示例顶层右边有空位。", setup: `${WHITE_DOWN} U F' U L F' L2 U F`, explanation: ["顶层有白棱不等于已经成为花瓣。F 先把它带到前右中层，再 R 抬起，让白色朝上。", "若右上已有花瓣，先 F 把目标降到中层，再转 U 给右上让空，最后 R。目标在中层时，转 U 不会把它移走。"], check: "目标从顶层侧面翻到顶面，花瓣数增加。", focusFace: "U" }, [["F", "先放到中层", "从顶层前方转到前右中层。"], ["R", "换一个方向抬起", "示例右上已空；实物先核对出口，再把白色抬上去。"]]),
      example({ id: "daisy-make-room", title: "出口被花瓣占了：先让位", when: "前右中层有白色朝前的棱，右上却已经有一片白花瓣；后上为空。", setup: `${WHITE_DOWN} U L' F2 U2 L2 F L U F2 F`, explanation: ["先看旧花瓣的去向。U 把右上的花瓣带到前方，把空的后上位置移到右上。", "然后 R 抬目标。先转 U、后转侧面，可以保住已经收集的花瓣；重复到四片齐全。", "如果顶面已经四片白色围黄心，直接进入白十字课，不要继续转侧面。"], check: "旧花瓣还在顶面，新花瓣也进来了。四片齐全时停止。", focusFace: "U" }, [["U", "给出口腾空", "先移动上层已有花瓣。"], ["R", "加入新花瓣", "右上的空位接住目标白棱。"]]),
    ],
    checklist: ["顶面四条棱的白色都朝上，中心是黄色。", "我没有把顶层白角或朝侧面的白棱算作花瓣。"],
    pitfalls: [{ title: "做好一片又弄掉一片", body: "侧面转动前先看顶层出口。让位只是 U 层移动，不会减少花瓣。若目标在顶层，先移到中层再安排出口也可以。" }, { title: "找不到白棱", body: "依次看顶层、中层、底层，只数两色块。四条白棱全部都在这三层之一，没有额外隐藏情形。" }],
    practice: "把魔方重新打乱，只做小花。每次转之前先指出目标、出口和需要保留的花瓣。不要计时。", relatedStudyIds: ["u", "front-double"],
  },
  {
    id: "white-cross", number: 4, title: "完成白十字", kicker: "每条棱都要同时对上两种颜色",
    summary: "对齐花瓣侧色，再用半圈送到底面。", goal: "白十字朝下，四条白棱的另一色分别与侧面中心一致。",
    prepare: ["先完成小花：四片白棱围着黄色中心。", "黄上白下，找一片花瓣的侧色。只转 U，让这个侧色来到同色中心的正上方。"],
    cases: [
      example({ id: "cross-aligned", title: "侧色已经对齐", when: "前上白棱的侧面颜色与正面中心相同。", setup: DAISY, explanation: ["先比侧色，再看白色。本例前上棱已经对准正面中心，只需 F2。", "半圈把这条白棱送到底面。余下花瓣留在顶层，接着逐条找同色中心。"], check: "下面多一条白棱，正面最下面的中间格与中心同色；顶面其余花瓣仍在。", focusFace: "D" }, [["F2", "对齐后送到底面", "这一步同时确定白色朝下、侧色归位。"]]),
      example({ id: "cross-align-first", title: "先对侧色，再下去", when: "白棱在顶层，但侧色没对准同色中心。", setup: `${DAISY} U`, explanation: ["转 U 不会改变底下已经放好的白棱。沿着顶层寻找，直到目标棱的侧色与面中心一致。", "示例需要 U′。你的实物可能需要 U、U2 或不转；判断标准永远是两种侧色相接，不是固定背一个 U′。"], check: "目标白棱归位，已完成的底层白棱保持；剩余花瓣按同样规则处理。", focusFace: "D" }, [["U'", "让侧色找中心", "看到正面竖直方向的同色连接。"], ["F2", "再转半圈", "先对齐再下去，顺序不能颠倒。"]]),
      example({ id: "cross-all-four", title: "四条都归位后怎样检查", when: "想完整看一遍从小花到白十字。示例四条的侧色已对齐。", setup: DAISY, explanation: ["示例中的四片花瓣恰好都对着自己的中心，因此四个侧面各转半圈就完成。", "实际打乱通常没有这么整齐：每条送下去前都重新对侧色。不要把 F2 R2 B2 L2 当成通用白十字公式。", "白角暂时不需要正确。下课再处理角块，别为了凑满白面破坏已经对好的十字。"], check: "白面中心与四条白棱构成十字；四个侧面的底部中间格也都接上中心。", focusFace: "D" }, [["F2", "前方白棱", "确认侧色，再送下去。"], ["R2", "右方白棱", "这里侧色也已对齐。"], ["B2", "后方白棱", "转背面时仍以正对背面判断；半圈方向不限。"], ["L2", "左方白棱", "最后看底面与四个侧面，共五个检查位置。"]]),
    ],
    checklist: ["白十字完整。", "四条白棱的侧色全部与中心对应。"], pitfalls: [{ title: "白十字有了，侧色对不上", body: "把错位白棱所在侧面转半圈，送回黄心旁。对准它真正的中心，再半圈送下；一次只修一条，保留其他正确白棱。" }],
    practice: "做出白十字后，分别把四个侧面朝向自己检查。说出每条白棱的两种颜色以及它为何放对。", relatedStudyIds: ["front-double"],
  },
  {
    id: "first-layer", number: 5, title: "完成第一层", kicker: "一个角，三个颜色都要回家",
    summary: "先找角的家，再用同一组四步把它送进去。", goal: "白面与四个侧面底行同时完整，白十字始终保留。",
    prepare: ["先检查白十字的四个侧色都正确。", "找顶层白角，读它另外两种颜色。整颗横向换向，把这两种中心夹着的槽放在右下前方；只转 U，把目标角放到右上前方。"],
    cases: [
      cornerInsertion("corner-white-front", "白色朝前 · 一组", "前", 1),
      cornerInsertion("corner-white-up", "白色朝上 · 三组", "上", 3),
      cornerInsertion("corner-white-right", "白色朝右 · 五组", "右", 5),
      example({ id: "corner-take-out", title: "白角卡在底层：先取出", when: "白角在底层，但三色没接上各自中心，或白色没有朝下；顶层找不到待处理白角时也这样做。", setup: `${LATE} x2 ${CORNERS} x2`, explanation: ["只挑一个错误白角。把它放在右下前方，完整做一组 U R U′ R′，它就会来到右上前方。", "现在重新读这个角的三种颜色，找到真正属于它的槽。整颗横向换向，把目标槽放右前，再 U 对齐角块，按白色朝向选上面的 1、3 或 5 组。", "若原本只是在自己的槽里扭错，也先取出再插入。不要直接用手掰角，不要对已经正确的角做取出动作。"], check: "原来的错误角来到顶层，白十字没变；接着判断它的真正槽位和白色朝向。", focusFace: "D" }, [[RIGHT, "把错误角请出来", "完成四步再观察：角块已到顶层，底层腾出工作槽。"]]),
    ],
    checklist: ["白面九格同色。", "四个侧面底行分别与对应中心同色。"], pitfalls: [{ title: "白色下去了，却放错家", body: "一块白角的另外两色也必须属于当前前、右中心。先找家再插入；不正确就用取出情形重来。" }, { title: "重复中途提前收手", body: "U R U′ R′ 是完整四步。只在四步末尾判断；半途停下可能破坏十字或留下右层未收回。" }],
    practice: "每插入一个角，立即检查白十字与其他已完成角。四角全好后，尝试不看次数，只在每组末尾判断是否三色归位。", relatedStudyIds: ["f2l-insert", "left-trigger"],
  },
  {
    id: "middle-layer", number: 6, title: "完成第二层", kicker: "没有黄色的棱，属于中层",
    summary: "先在顶层对齐正面色，再分清向左还是向右。", goal: "四条中层棱正确，已经做好的第一层保持完整。",
    prepare: ["第一层必须完整。保持黄上白下，在顶层找不带黄色的棱。", "只转 U，让它侧面的颜色对上前中心；观察顶面颜色属于左中心还是右中心。"],
    cases: [
      example({ id: "middle-insert-right", title: "顶色属于右面：向右插", when: "前上棱不含黄色，朝前的色对正面中心，朝上的色对右面中心。", setup: `${OTHER_MIDDLE} ${inverse(MIDDLE_RIGHT)}`, explanation: ["目标要进入前右中层。先把顶层棱带离目标槽，再用右侧四步与正面四步配合插入。", "八步执行完才检查白层；中途它会短暂打开。其余三个中层槽的正确块应保持。", "再找下一条无黄色顶棱；不能因为这一条成功就跳过剩余槽。"], check: "前右棱两色分别接上前、右中心，白层恢复；其余已完成中层棱保持。", focusFace: "F" }, [["U R U' R'", "先从右边接住", "先移开目标，再打开和收回右层。"], ["U' F' U F", "正面收拢", "把对应部分送回，完成前右棱。"]]),
      example({ id: "middle-insert-left", title: "顶色属于左面：向左插", when: "前上棱不含黄色，朝前的色对正面中心，朝上的色对左面中心。", setup: `${OTHER_MIDDLE} ${inverse(MIDDLE_LEFT)}`, explanation: ["这是左插情形。先对前中心，再看顶色；不能只凭棱现在靠近哪只手选公式。", "左插与右插动作互为镜像，但记号不能随便左右互换：这里是 U′ L′ U L，再 U F U′ F′。"], check: "前左棱两色归位，白层完整；继续找未完成中棱。", focusFace: "F" }, [["U' L' U L", "先从左边接住", "让出目标槽，用左侧完成第一段。"], ["U F U' F'", "正面收拢", "完整收回正面后检查两层。"]]),
      example({ id: "middle-take-out", title: "顶层没有可用棱：换出错误中棱", when: "顶层四条棱都带黄，但中层仍有放反或放错的棱。", setup: `${LATE} ${MIDDLE_RIGHT} U2 ${MIDDLE_RIGHT}`, explanation: ["中层正确时不需要本步骤。本例前右棱的两色正好反了，顶层也没有不带黄的棱可插。", "把错误中棱放在前右，直接做一次右插，把顶层的临时棱送进去，原来的错误棱便来到顶层。这里临时棱带黄也可以，因为目的只是取出。", "不要连做同一公式盲猜。取出后重新找不带黄的那条棱，转 U 对齐侧色，再判断左插或右插。其他已经好的槽不要动。"], check: "原来卡住的非黄棱已经出现在顶层，白层和另外三个中层槽保持。接下来对齐后再插。", focusFace: "F" }, [[MIDDLE_RIGHT, "用一次右插腾出槽位", "完整八步结束后，回到“找无黄色棱”的判断。"]]),
    ],
    checklist: ["白层完整，四个侧面下面两行均与中心同色。", "顶层剩下的四条棱都含黄色。"], pitfalls: [{ title: "棱放进去了，但两色反了", body: "先用取出情形送上顶层，再以侧色对正面中心重新选择左右插。不是用手翻棱。" }, { title: "上面全是黄棱，就以为第二层好了", body: "仍要检查四条中棱的两色。错误块可能互换了位置，也可能在原槽里翻向。" }],
    practice: "分别完成一次左插与右插，再练一次取出错误中棱。每次都先说出：目标棱、目标槽、需要保留的白层。", relatedStudyIds: ["left-trigger", "f2l-insert"],
  },
  {
    id: "yellow-cross", number: 7, title: "做出黄十字", kicker: "这一课只看四条黄棱",
    summary: "点、折角、直线，最终都汇到一个黄十字。", goal: "顶层四条黄棱都朝上，前两层保持完成。",
    prepare: ["先确认前两层完整。黄上白下，只观察顶层四条棱，忽略角块的黄色。", "本课动作 F R U R′ U′ F′ 只改变顶层；每一轮六步做完再检查形状。"],
    cases: [
      example({ id: "yellow-line", title: "直线：横着放", when: "黄色中心左右两边的棱朝黄，上下两边不朝黄。", setup: `${LATE} ${inverse(CROSS)}`, explanation: ["从顶面看，把两条黄色棱摆成左右横线；如果是前后直线，先转 U 四分之一圈。", "做一轮即可得到黄十字。角块可能同时变化，这一课不需要管它们。"], check: "顶面四条棱全黄，前两层完整；侧色暂时可以不对应。", focusFace: "U" }, [["F", "打开正面", "前面向顺时针打开。"], ["R U R' U'", "中间四步", "保持握姿跟完，注意这里以 R 开头。"], ["F'", "收回正面", "最后一转不能漏；现在才检查黄十字。"]]),
      example({ id: "yellow-elbow", title: "折角：放在左后", when: "两条黄棱相邻；摆成顶面左边和后边的 L 形。", setup: `${LATE} ${inverse(repeat(CROSS, 2))}`, explanation: ["从上面看，黄色棱应在左和后，像一个向前右敞开的折角。若不在这个位置，先转 U。", "第一轮会变成左右直线；保持当前握姿，再完整做一轮，得到黄十字。"], check: "两轮后四条黄棱朝上，前两层恢复。", focusFace: "U" }, [[CROSS, "折角变横线", "一轮结束再认形状。"], [CROSS, "横线变十字", "同一握姿完成第二轮。"]]),
      example({ id: "yellow-dot", title: "只有中心：先做出折角", when: "四条顶棱都不朝黄；可能有黄角，不影响这个判断。", setup: `${LATE} ${inverse(`${CROSS} U2 ${CROSS} ${CROSS}`)}`, explanation: ["没有黄棱朝上就是点形，任意侧面朝前先做一轮。", "本例第一轮得到右前折角，U2 把它搬到左后；实际请按看到的折角重新摆位，不一律照抄 U2。然后按折角情形做两轮。"], check: "点形经过重新摆位，最终变成黄十字；前两层仍完整。", focusFace: "U" }, [[CROSS, "先出现折角", "这一轮只负责从点形离开。"], ["U2", "把折角放左后", "先看形状再转；这是本例所需的摆位。"], [CROSS, "折角变横线", "完成后重新看四条棱。"], [CROSS, "横线变十字", "最终四条黄色棱朝上。"]]),
      example({ id: "yellow-cross-ready", title: "已经是十字：直接过关", when: "顶层四条棱已朝黄，无论角块是否朝黄。", setup: `${LATE} ${SUNE_FIXTURE}`, explanation: ["如果四条棱都朝上，本课已经完成，不要再套公式。演示只横向换视角，帮助你看清边与角。", "合法三阶且前两层正确时，朝黄的顶棱只会是 0、2 或 4 条。看到 1 或 3 条时，先核对前两层和观察方向；若曾拆装或撕贴，请检查魔方状态。"], check: "能指出四条黄色棱，并说明为什么黄色角块暂时不影响本课完成。", focusFace: "U" }, [["y", "只换视角检查", "整颗横转后十字仍在，角块留给下一课。"]]),
    ],
    checklist: ["顶层中心和四条棱组成黄十字。", "前两层没有被破坏。"], pitfalls: [{ title: "把三个黄角看成小鱼，就跳去别的公式", body: "本课只按棱认形状。后面仍采用固定的逐角翻黄面方法，不切换到另一套顺序。" }, { title: "六步漏了最后 F′", body: "漏收正面会让前两层看起来被破坏。先核对完整六步，再判断局面。" }],
    practice: "从不同角度看顶面，只报出四条棱的形状：点、折角、直线或十字，再说出该如何摆。", relatedStudyIds: ["ru"],
  },
  {
    id: "yellow-face", number: 8, title: "完成黄面", kicker: "允许暂时乱，完整一圈才恢复",
    summary: "黄面朝下，在固定工作位置逐角转正。", goal: "四个黄角朝上，黄面完整，前两层最终恢复。",
    prepare: ["必须先完成前两层与黄十字。先看完一次演示，理解为什么白层中途会乱。", "本课先整颗 x2 把黄面朝下，再固定正面。角只在右下前处理；换角只转 D。"],
    cases: [
      yellowCorners("yellow-three-corners", "三个角没朝黄：完整走一圈", SUNE_FIXTURE, [0, 2, 2, 2]),
      yellowCorners("yellow-two-corners", "两个角没朝黄：包含跳过的位置", repeat(SUNE_FIXTURE, 3), [2, 0, 4, 0]),
      yellowCorners("yellow-four-corners", "四个角都没朝黄：两种组数混合", repeat(SUNE_FIXTURE, 2), [2, 4, 2, 4]),
      example({ id: "yellow-face-ready", title: "黄面已完整：不要再翻角", when: "顶面九格全黄，前两层也完整。", setup: `${LATE} ${CORNERS}`, explanation: ["这一步已经完成，直接进入顶角归位。黄面同色只证明朝向正确，不证明每个角都在自己的家。", "演示只绕竖轴看侧面，观察顶行两端是否属于同一个侧面颜色。"], check: "黄面保持完整，但侧面顶角仍可能不匹配；下一课解决位置。", focusFace: "U" }, [["y", "从侧面看位置", "不再执行翻角公式。"]]),
    ],
    checklist: ["黄面九格同色。", "翻回黄上白下后，第一层和中层都恢复，未额外补不确定的动作。"],
    pitfalls: [{ title: "白层乱了就中途救它", body: "这是本方法的暂态。先按完整四步处理当前角，保持正面，只用 D 轮换。四个位置检查完且 D 累计一整圈后才验收前两层。" }, { title: "转整颗来换下一个角", body: "这会改变工作位置与后续动作的含义。固定前中心，只有底层 D 在各角之间轮换。" }, { title: "最后一个黄角朝下就立刻翻回", body: "每个位置检查后都还有一次 D。按本课程的四位置流程把整圈走完，再翻回黄上白下。" }],
    practice: "第一次开启分段慢放，报出“完整四步、检查黄角、只转 D”。第二次由自己判断每个角要 2 组还是 4 组，不记演示里的次数。", relatedStudyIds: ["f2l-insert", "whole-rotation"],
  },
  {
    id: "yellow-corners", number: 9, title: "顶角归位", kicker: "黄面朝向正确，现在让四角回家",
    summary: "找到侧面顶行两端的同色角对，把它放在后面。", goal: "四个黄角的三色都对应中心，黄面与前两层保持。",
    prepare: ["前两层和黄面已完成。黄上白下，本课始终不把黄面翻到前方。", "同色角对：一个侧面顶行的左、右两个角贴片颜色相同，中间棱的颜色不参与判断。四个侧面都检查。"],
    cases: [
      example({ id: "corners-one-pair", title: "有一对同色角：放到后面", when: "只有一个侧面顶行两端同色。整颗横向换向，把这一对放在背面。", setup: `${LATE} ${inverse(CORNERS)}`, explanation: ["同色角对不必先对中心，先把它放在背面。保持黄色朝上，执行本课九个记号的换角动作。", "做完后四个侧面顶行两端都应各自同色。再只转 U，让这些颜色同时对上侧面中心；示例刚好不需要额外 U。", "这套记号使用黄面朝上的固定握姿，不能套用另一份图解里黄面朝前的握姿。"], check: "四个顶角都与三个相邻中心对应，黄面和前两层完整；顶棱可能仍未归位。", focusFace: "U" }, [["R' F R' B2", "把三个角带入交换", "背面的两个同色角是摆位参照；先完整完成第一段。"], ["R F' R' B2 R2", "收回并检查四角", "完整收回后再判断。必要时 U、U′ 或 U2 对齐全部角的侧色。"]]),
      example({ id: "corners-no-pair", title: "四面都没有同色角对", when: "顶角侧色没有任何一面对成一对，黄面仍完整。", setup: `${LATE} ${CORNERS} U ${CORNERS}`, explanation: ["任选一个侧面朝前，做一次换角动作。目的是造出同色角对，这一轮不必直接完成。", "做完重新检查四面。找到同色角对后，用整颗 y 换向把它放到背面，再按上一情形做一次，最后 U 对齐中心。", "示例只演示第一轮，特意停在新的判断点：请在画面里找出刚出现的同色角对。"], check: "已经出现同色角对，黄面与前两层保持；接着放后、再做一次、U 对齐。", focusFace: "U" }, [[CORNERS, "先制造一个角对", "结束后从四个侧面重新寻找同色的两个顶角。"]]),
      example({ id: "corners-align-only", title: "四面都成对：只转顶层对齐", when: "四个侧面的顶行两端都各自同色，但它们还没有对上中心。", setup: `${LATE} U`, explanation: ["四面对成对，说明角的相对位置已经对了。此时不要再用换角公式。", "只转 U，直到任意一个角的两种侧色同时接上相应中心；其他三个角会一起对齐。示例需要 U′。"], check: "四个顶角三色归位。只剩顶层的棱需要处理。", focusFace: "U" }, [["U'", "整体对齐四角", "检查任意一个角的两侧，再绕四面核对。"]]),
    ],
    checklist: ["四个黄角的位置都对，不只是黄色朝上。", "黄面和前两层保持完成。"], pitfalls: [{ title: "把正确顶棱当作同色角对", body: "本课看顶行两端的角，不看中间的棱。三个贴片一起同色是下一课可用的完整侧面。" }, { title: "一轮之后仍没对中心就不断重做", body: "先看四面角对是否已经齐全；如果齐了，只需转 U。继续换角反而会离开正确状态。" }],
    practice: "只看四个侧面顶行两端，分辨 0 对、1 对或 4 对，并说出下一步是先造角对、放后换角，还是只 U 对齐。", relatedStudyIds: ["back-finger", "whole-rotation"],
  },
  {
    id: "yellow-edges", number: 10, title: "顶棱归位", kicker: "最后三条棱，沿着顶层换位置",
    summary: "把完整的一面放背后，剩下三条棱循环归位。", goal: "所有六面同色，完成第一次完整还原。",
    prepare: ["先完成前两层、黄面、四个顶角，并把角的侧色对齐中心。", "检查四个侧面的顶层中间格。已经与中心同色的一面叫正确侧面；整颗横向换向，把它放在背面。"],
    cases: [
      example({ id: "edges-one-cycle", title: "有正确侧面 · 一轮到位", when: "正确侧面在背面；前上棱的侧色属于右面中心。", setup: `${WHITE_DOWN} ${inverse(EDGES)}`, explanation: ["背面保持完整。观察前上棱，它应去右边；这套动作会循环前、右、左三条顶棱。", "完整做一轮后再检查。公式中 R 连续多次出现并不是省略了撇，按记号逐个完成。"], check: "六个面都同色，所有侧面顶行与中心接上。", focusFace: "U" }, [["R U' R", "开启三棱循环", "保持背面是正确侧面。"], ["U R U R", "沿顶层接力", "这里连续两组 U R，方向都没有撇。"], ["U' R' U' R2", "收回两层", "最后 R2 是半圈。做完再检查全部六面。"]]),
      example({ id: "edges-two-cycles", title: "相反循环方向 · 同一动作做两轮", when: "正确侧面在背面；前上棱的侧色属于左面中心。", setup: `${WHITE_DOWN} ${EDGES}`, explanation: ["不再增加一套记忆：沿相反方向的三棱循环，可以用同一套动作完整做两遍。", "第一遍后背面仍正确，其余三条仍在等待。保持握姿，第二遍才还原；不必重新转 U，因为顶角已经对齐。"], check: "两轮后六面还原；每一轮末尾黄面、角块和前两层都保持正确。", focusFace: "U" }, [[EDGES, "第一轮", "到中间检查点时背面仍正确，其他三条棱尚未全部归位。"], [EDGES, "第二轮", "再次完成同一循环，全部归位。"]]),
      example({ id: "edges-no-side", title: "没有任何正确侧面", when: "四个顶角正确，但四条顶棱都未接上侧面中心。", setup: `${WHITE_DOWN} ${EDGES} y ${EDGES} y'`, explanation: ["任选一个侧面朝前，先做一轮。对于这阶段的合法局面，会出现一个正确侧面。", "再把正确侧面放到背面，判断前上棱应去左还是右，做一轮或两轮。示例的换向是 y，且下一轮就完成；实物应根据自己出现的正确面摆位。", "如果做完仍没有正确面，先核对顶角是否已对齐、十一记号是否完整；不要继续盲做。"], check: "示例六面还原。你的魔方也要逐面检查，包括背面和底面。", focusFace: "U" }, [[EDGES, "先做出一个正确侧面", "这次的目标是出现可用参照。"], ["y", "把正确面放到背后", "整颗横向换向，不是只转 U。"], [EDGES, "完成三棱循环", "本例只需再一轮；实际根据前上棱目标方向判断。"]]),
    ],
    checklist: ["六个面分别同色，每个面都看过。", "我能区分只需调整顶层、需要换角、以及只剩换棱。"], pitfalls: [{ title: "正确面在前就开始套公式", body: "先整颗换向，把正确面放到背后；U 不能替代整颗换向，因为 U 会把已归位的角带走。" }, { title: "还差两条棱互换", body: "只两条棱互换且所有其他块都对，在合法三阶中不会单独出现。先检查角、朝向和是否漏步；必要时用状态校验，不要拆块猜测。" }],
    practice: "还原后慢慢看完六个面。休息一下，再从新的打乱重做；一次跟完演示和独立理解还原，是两个不同的进步。", relatedStudyIds: ["u-double", "ru"],
  },
  {
    id: "solve-on-your-own", number: 11, title: "自己完成一次", kicker: "先判断现在在哪一站，再决定下一步",
    summary: "把短动作连成自己的还原流程，遇到偏差有办法退回。", goal: "处理一个未见过的正常打乱，按阶段自查完成，而不是背下整段示范。",
    prepare: ["用普通转动充分打乱，不拆装、不掰角。下面是判断练习，不是可以套在所有魔方上的整段答案。", "按顺序检查：小花 → 白十字 → 第一层 → 第二层 → 黄十字 → 黄面 → 顶角 → 顶棱。已完成且检查通过的阶段可以跳过。", "第一次保留全部提示；第二次先只读目标与情形，卡住才看公式；第三次先自己决定动作，再用演示核对。"],
    cases: [
      example({ id: "independent-start", title: "陌生打乱：只决定第一步", when: "手里是一颗新打乱的魔方，不知道从哪里开始。", setup: `${WHITE_DOWN} U' L' F' U F2 F U L' L U`, explanation: ["不要搜索与整颗魔方完全一样的图。先让黄心朝上，找一条白棱，只判断它的位置、白色朝向和出口是否被占。", "本例的前右白棱属于“小花：中层白色朝前”，所以用 R。动作之后再次观察，而不是继续背一段长公式。", "实物找到的第一条白棱可能不同，回到第 3 课选自己的情形。收齐小花再进入白十字检查点。"], check: "能解释这一动作的目标，而且花瓣数增加；接下来由你寻找第二条白棱。", focusFace: "U" }, [["R", "只处理眼前这一块", "一次只解决一个明确的小目标。"]]),
      example({ id: "independent-checkpoint", title: "看见黄面之前，先检查两层", when: "前两层完整，顶面有黄色，但不确定该用哪一课。", setup: `${LATE} ${inverse(CROSS)}`, explanation: ["先从底面绕四个侧面检查前两层。通过后只数黄棱，不数黄角。", "本例四条黄棱里只有左右两条朝上，所以是第 7 课横线情形。还没到翻黄角，更没到换顶角。", "完成黄十字后再重新判断黄角。每个检查点都要真的看局面，不凭刚才执行了什么公式推定它已经正确。"], check: "前两层保持，黄十字形成；下一步应去第 8 课判断黄角。", focusFace: "U" }, [[CROSS, "根据检查点选动作", "六步完成后停下来，重新判断下一阶段。"]]),
      example({ id: "independent-known-mistake", title: "知道刚才误转了什么：精确撤销", when: "已经完成第二层，却误做了一次 R；你确切记得只有这一步。", setup: `${LATE} R`, explanation: ["已知只多转一个 R，就只用 R′ 撤销。不要再加入其他“看起来能救”的动作。", "若误做了一串已知动作，要倒序、逐个反向撤销。若不记得哪一步错了，先停止，核对握姿、阶段和当前块；回到尚未完成的最早检查点，或进入辅助还原。", "辅助还原可以帮你回到可用局面，但网页并未自动识别你手里的错误，也不会因此认定你已学会。"], check: "第二层与白层恢复到误转前的完整状态，顶层仍待继续处理。", focusFace: "R" }, [["R'", "撤销唯一已知误转", "先恢复可靠的检查点，再继续原来的课程。"]]),
    ],
    checklist: ["我用自己的新打乱完成了六面，而不只复现示例。", "卡住时我能说出当前阶段与不匹配的条件，再找到对应分支。", "我愿意再换一颗打乱，检验是否真正理解，而不急着追求速度。"],
    pitfalls: [{ title: "看不懂就连做同一公式", body: "只有课程明确说可以重复时才完整重复。其他情况先停在检查点，看摆位、目标块、前置条件，找到对应情形再继续。" }, { title: "忘记哪里错了，硬从下一课继续", body: "先找到仍然成立的检查点。白十字或第一层损坏时，应回到相应课程；不要假设已经完成的层一定还在。" }],
    practice: "记录这次最需要提示的一步：摆位、认情形、记动作或检查结果。下次只针对这一个卡点练习，再做一次完整还原。", relatedStudyIds: [],
  },
  {
    id: "smoother-turns", number: 12, title: "想转得更顺", kicker: "可选体验 · 从一块，到一对",
    summary: "放松握持，认识短动作节奏，再体验角棱一起归位。", goal: "理解基础转动配合与三种直观角棱关系，不把速度作为新手毕业门槛。",
    prepare: ["建议先独立完成两次还原。F2L 是把前两层的角和棱配成一对再插入，与先做白角、再做中棱是不同的安排。", "三种 F2L 示例都以白十字正确、目标槽在前右为前提。其余三个角棱槽保持，顶层状态可以变化。", "机械演示帮助观察转层、先后和持握衔接，不代表每一种机械动作都等同于经过校准的人手指法。手指不舒服就减速，先用自己容易控制的握法。"],
    cases: [
      example({ id: "finger-rhythm", title: "四拍协调：转、推、回、推回", when: "已经读懂记号，想减少停顿。此例是节奏练习，不是任何阶段都可用的还原公式。", setup: LATE, explanation: ["试着保持一只手稳定支撑，让另一只手完成 R，随后用方便的食指轻推 U；R′ 收回，再完成 U′。不要追求固定手指压住所有贴片。", "先每步停一次，再每两步连起来。你应该一直知道下一步是哪一层，不能靠捏紧魔方换取安全感。", "这里是 R U R′ U′，与前面从 U 开始的 U R U′ R′ 不是同一段。演示连做六组回到起点，观察它怎样改变再恢复局面。"], check: "六组后回到起始局面。每层转足、没有卡住，手指与手腕感觉放松。", focusFace: "R" }, [["R U R' U'", "先认一组", "四步都做足，先不加速。"], [repeat("R U R' U'", 5), "再重复五组", "保持同一握姿；六组结束应回到原状态。"]]),
      example({ id: "f2l-ready-pair", title: "相邻且配好的角棱：整对送入", when: "目标角在右上前、白色朝前；同一对的棱在右上，两个右面贴片同色。", setup: `${LATE} ${inverse(RIGHT)}`, explanation: ["目标角的三色属于右下前槽，对应棱的两色属于前右中层。两块在顶层相邻，右面两片同色，像连在一起的一小段。", "U 先把这一对带离槽口，R 打开槽，U′ 把一对送回，R′ 收拢。一次同时完成白角和中棱。", "这只适用于画面里这一对的位置与朝向；看到任意相邻角棱，不代表都已经配好。"], check: "前右角和中棱一起归位，白十字与其余三个槽保持。", focusFace: "R" }, [["U R", "先让位，再打开槽", "留意角和棱仍在作为一对一起移动。"], ["U' R'", "把一对送进去", "完成后同时检查角的三色和棱的两色。"]]),
      example({ id: "f2l-separated", title: "角棱分开：用空槽接住", when: "目标角在右上前、白色朝右；对应棱在顶层后方，后侧颜色对右中心。", setup: `${LATE} ${inverse("R U R'")}`, explanation: ["角和棱并没有贴在一起，但它们与目标槽的关系已经适合一次简单插入。不要只盯白色，要同时跟踪两块。", "R 打开前右槽，U 把合适的部分带到槽口，R′ 收回。只有这组精确关系成立时才用这三步。", "和上一情形比较：先观察目标块的朝向与相对位置，才能判断需要先让位还是直接开槽。"], check: "三步后前右一对归位，白十字与其他三个槽保持。", focusFace: "R" }, [["R", "打开目标槽", "观察角和棱如何靠近可插入的位置。"], ["U R'", "接住并收回", "最后检查两块，不只检查白角。"]]),
      example({ id: "f2l-white-up", title: "白色朝上：先改变角棱关系", when: "目标角在右上前、白色朝上；对应棱在右上，棱的右色对右中心，角的另外两色与前右方向相反。", setup: `${LATE} ${inverse("R U2 R' U' R U R'")}`, explanation: ["直接套入槽动作，角的白色仍不朝下。先用 R U2 R′ 改变这两块的相对关系，再 U′ 摆成适合三步插入的状态。", "暂停在第四步，把画面与上一情形比较。你会看到同样的“白色朝右、棱在后面”的关系，可以用 R U R′ 完成。", "这三种体验是理解配对的入口，不是完整 F2L 情形表。遇到未学情况，仍可用白角加中棱的熟悉方法完成。"], check: "前右角棱一起归位；你能在第四步指出为什么后半段与上一情形相同。", focusFace: "R" }, [["R U2 R'", "先改变关系", "用尚未完成的前右槽作暂时空间，其他槽不动。"], ["U'", "摆成已认识的情形", "在这里暂停，重新找到角与棱。"], ["R U R'", "复用三步插入", "同一小动作可以成为不同情形的结尾。"]]),
    ],
    checklist: ["我知道动作节奏与公式用途是两回事。", "我能同时追踪一个角和一条棱，解释两者为何属于同一个槽。", "我知道这只是进阶体验，遇到其他情形仍可用层先法完成。"],
    pitfalls: [{ title: "一开始就追求最快指法", body: "先让每层转足、握持放松、视线能跟上目标块。减少无谓停顿比硬提转速更有帮助。" }, { title: "见到一对就直接插", body: "相邻不等于配对正确。至少核对颜色组合、白色朝向、侧色关系与目标槽，缺一个都可能插错。" }],
    practice: "任选一个角棱示例，慢放一遍，然后用自己的话解释“让位—开槽—接住—收回”。不计时，换一个侧面重复判断。", relatedStudyIds: ["u", "u-prime", "u-double", "ru", "f2l-insert", "two-f2l"],
  },
];

export function getLesson(id: string): CourseLesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}
