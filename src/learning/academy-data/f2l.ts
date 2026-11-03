import { applyAlgorithm, SOLVED } from "../../core/cube.ts";
import type { Face } from "../../core/cube.ts";
import type { CourseLesson, LessonCase } from "../types.ts";
import { center, inverse, LATE, makeCase } from "./shared.ts";
import type { Segment } from "./shared.ts";

export const READY_PAIR = "U R U' R'";
export const OPEN_SLOT = "R U R'";
export const WHITE_UP = "R U2 R' U' R U R'";
const PAIR: Face[][] = [["U", "F", "L"], ["F", "L"]];
const CHECK = "前右下角的白色朝下，角和棱的另两色都接上中心；白十字与其余三个已完成槽保持。顶层不需要同时还原。";

function pairCase(id: string, title: string, when: string, explanation: string[], segments: Segment[]): LessonCase {
  const algorithm = segments.map(([moves]) => moves).join(" ");
  return makeCase({ id, title, when, setup: `${LATE} ${inverse(algorithm)}`, explanation,
    focusPieces: PAIR, focusLabel: "白绿橙角 + 绿橙棱 · 同一个家", check: CHECK }, segments);
}

const ready = pairCase("academy-f2l-ready", "已经配好：先让位，再一起入槽", "白绿橙角在右上前，白色朝前；绿橙棱在右上，两块的右侧贴片同为橙色。", [
  "先找角块的三色，再找不带白色的同色棱。绿和橙对应的两个中心决定它们的家：前右槽。仅仅挨着并不足以证明配好了。",
  "这里两个右侧贴片同色，连接关系与还原后相同。U 先让一对离开槽口，R 开槽，U′ 将一对带回来，R′ 收回。",
  "跟做前先说出一对会去哪个槽；跟做后同时检查两块与白十字。只看到白色朝下还不能判定成功。",
], [["U R", "让位与开槽", "看两块一起移动，暂时借用尚未完成的槽。"], ["U' R'", "送入与恢复", "两个侧色都要接上中心，不能只看白角。"]]);
const falsePair = pairCase("academy-f2l-false-pair", "相邻却没有配好", "白绿橙角在右上前，白色朝右；绿橙棱在右上，右侧的两片颜色并不相同。", [
  "与上一例一样，角和棱在相邻位置。但角的右贴片是白色，棱的右贴片是橙色；连接关系错了，不能直接照搬整对插入。",
  "先 U′ 改变摆位，再 R U′ R′ 暂时藏角、移动棱并恢复槽。停下重新找同一对，不靠动作长度猜已经配好。",
  "U 将两块摆成三步插入的关系，最后 R U R′ 完成。观察“改变关系”和“插入”是两件不同的事。",
], [["U'", "先调整顶层", "角和棱相对位置不变，但相对槽口的位置改变。"], ["R U' R' U", "改变角棱关系", "暂时藏角时转顶层，让棱移动到能接合的位置。"], [OPEN_SLOT, "复用三步插入", "结束才检查目标槽与其他已完成部分。"]]);

const separated = pairCase("academy-f2l-open-slot", "分开也能直接接住", "角在右上前、白色朝右；对应棱在上层后方，绿色朝上、橙色朝后。", [
  "F2L 不要求先把两块贴成一条。这里角、棱与空槽之间的关系恰好允许在开槽过程中接合。",
  "R 打开右前槽，U 把棱送到连接位置，R′ 将角和棱一起收回。把注意力分给两块，不要只追踪白色。",
  "停在 R 之后找两块，再预测 U 会带来哪一块。先理解三步的用途，再尝试连贯执行。",
], [["R", "打开空槽", "原来隔开的两块开始接近。"], ["U R'", "接住并收回", "最后一转同时恢复白十字和目标槽。"]]);
const opposite = pairCase("academy-f2l-across", "棱在另一边：藏角后再配", "角在右上前、白色朝右；同对的棱在左上，不能直接照搬上一例。", [
  "先指出绿橙棱在左上，再比较它与“棱在后上”的三步插入。颜色组合相同不代表位置关系相同。",
  "U′ 后执行 R U R′，暂时把角移出顶层，让顶层的棱改变位置。收回右层后重新观察，不在半步中追求槽全部正确。",
  "再 U 调整，后面是熟悉的 R U R′。把长动作记成“先转换，再插入”，遇到变式也能重新判断。",
], [["U' R U R'", "藏角并移动棱", "利用空槽改变角棱关系。"], ["U", "检查新的关系", "现在与三步插入相同。"], [OPEN_SLOT, "插入", "一对归位，另三槽仍应正确。"]]);

const whiteUpNear = pairCase("academy-f2l-white-up-near", "白色朝上，棱在右上", "白绿橙角在右上前，白色朝上；绿橙棱在右上，绿色朝上。", [
  "白贴片朝上时，直接把角压入底层会留下错误朝向。先决定怎样改变关系，而不是反复试插。",
  "R 先把棱带到右侧中层，同时让白角转向侧面；U2 移动顶层的角，R′ 再把棱带回上层。接着 U′ 摆位，在第四步暂停：角的白色已朝右，棱来到后上。",
  "后面复用 R U R′。这不是要求记两套无关公式，而是把陌生情形转换为已经理解的小动作。",
], [["R U2 R'", "从白上变为可配", "顶层半圈使角和棱重新相遇。"], ["U'", "摆成已认识的形态", "检查白色朝右、棱在后上。"], [OPEN_SLOT, "完成插入", "核对两色侧条与白十字。"]]);
const whiteUpFar = pairCase("academy-f2l-white-up-far", "白色朝上，棱在左上", "同一个白角仍在右上前，但绿橙棱已经在左上，绿色朝上。", [
  "先与上一例对照：角的白色方向相同，棱的位置不同。只看角就套公式，会错过最有用的信息。",
  "R 先把白角转向侧面，U′ 将顶层两块移走，R′ 收回右层；再 U2 把它们摆到插入位置。这里没有把角藏到底层，注意与上一例暂存棱的区别。",
  "后面仍然是三步插入。两例共同的原则是先改变白角朝向和角棱关系、恢复右层，再复用已知插入；暂存哪一块、顶层转几格由位置决定。",
], [["R U' R'", "先改变关系", "先改变白角方向，再移动顶层两块；右层随后收回。"], ["U2", "送到插入位置", "半圈后暂停找出两块。"], [OPEN_SLOT, "复用同一个结尾", "检查目标槽，不凭白面判断。"]]);

const trappedCorner = pairCase("academy-f2l-trapped-corner", "角卡在家里，朝向却错了", "白绿橙角在前右下槽，白色朝前；绿橙棱在右上。", [
  "角在正确的位置不等于已经还原；白色朝前说明朝向错误。让它继续留在底层，通常会妨碍配对。",
  "R U′ R′ 将这一角带回上层，同时恢复白十字。停下来再认角和棱，不把“取出”误认为失败。",
  "U 调整后，用 R U′ R′ 完成本例。实际换一个卡槽情形时，仍然先取出，再按新的上层关系判断。",
], [["R U' R'", "取出错误朝向的角", "已完成的其他槽仍然保持。"], ["U", "重新识别", "此时不必继续背一段未知动作。"], ["R U' R'", "把正确的一对送回", "检查三色，而不只看角有没有进槽。"]]);
const trappedEdge = pairCase("academy-f2l-trapped-edge", "棱已在槽内，角还在上面", "绿橙棱在前右中层且方向正确；白绿橙角在右上前，白色朝上。", [
  "棱单独正确时，也可以把它取出来参与配对。保留一个未完整的槽，不如让角棱一起形成可判断的关系。",
  "第一组 R U R′ U′ 把槽里的棱带到可操作区域；右层收回后再看两块。不要拆开其他已完成槽。",
  "第二组四步继续转换，最后 R U R′ 插入。本例展示“允许局部退一步”，不要求所有卡槽都重复两组。",
], [["R U R' U'", "先取出棱", "槽暂时更空，是配对所需的空间。"], ["R U R' U'", "调整上层关系", "在完整四步后重新找同一对。"], [OPEN_SLOT, "角棱一起回家", "两块都正确才算这个槽完成。"]]);
const bothTrapped = pairCase("academy-f2l-both-trapped", "两块都在槽里，仍不能算完成", "角与棱都在前右槽；棱方向正确，但角的白色朝前。", [
  "检查一个槽必须看角和棱的所有侧色。这个槽的中层看似正确，底角却没有正确朝向。",
  "第一组 R U R′ U′ 将错误连接拆到顶层。取出后固定前面，确认还是同一组三色和两色。",
  "用 R U2 R′ U′ 改变关系，再三步插入。每一次借用槽都以收回右层结束，这样才能保护白十字。",
], [["R U R' U'", "拆开错误连接", "先允许目标槽变空。"], ["R U2 R' U'", "重新配对", "顶层半圈改变角和棱的连接。"], [OPEN_SLOT, "一起插入", "白面与两个侧面都检查。"]]);

function rotatedSlot(id: string, title: string, rotation: string): LessonCase {
  const orientationState = applyAlgorithm(SOLVED, `z2 ${rotation}`);
  const pair: Face[][] = [["U", center(orientationState, "F"), center(orientationState, "R")], [center(orientationState, "F"), center(orientationState, "R")]];
  const segments: Segment[] = rotation ? [[rotation, "把目标槽转到前右", "整颗横向换向，白面始终在下面；不是只做 U。"], [READY_PAIR, "复用同一个插入", "先读新的正面与右面中心，再执行。"], [inverse(rotation), "回到观察方向", "这是整颗换向，不改变配对的正确性。"]] : [["U R", "让位与开槽", "先说出目标槽。"], ["U' R'", "插入与恢复", "目标槽两色都对齐中心。"]];
  const algorithm = segments.map(([moves]) => moves).join(" ");
  return makeCase({id, title, when: "白十字完整，目标角棱已经配好，但它们的家不一定在当前前右。", setup: `${LATE} ${inverse(algorithm)}`,
    explanation: ["由两种侧色的中心确定目标槽，不用“我习惯右手”来决定把哪一对塞到哪里。", rotation ? "先整颗换向，把这个家放到前右，再重新读中心色。原本已完成的槽会随整颗移动，不能因换向就忘记保护。" : "目标槽就在前右，可以直接使用已经理解的四步。", "插入后换回观察方向，确认目标槽正确、其余槽保持。熟练后可以学后槽插入；这一课先把四个家与同一原理连起来。"],
    focusPieces: pair, focusLabel: "同一角棱对 · 随整颗换向追踪", check: "目标角棱归位；白十字和另外三个槽保持，整颗换向前后颜色身份不变。"}, segments);
}

const allPairs: Face[][] = [["U","F","L"],["F","L"],["U","F","R"],["F","R"],["U","B","R"],["B","R"],["U","B","L"],["B","L"]];
function fullExample(id: string, title: string, algorithms: [string,string,string,string]): LessonCase {
  const rotations = ["", "y'", "y2", "y"];
  const labels = ["前右", "前左", "后左", "后右"];
  const segments: Segment[] = algorithms.map((algorithm, i) => [
    `${rotations[i]} ${algorithm} ${inverse(rotations[i])}`.trim(),
    `第 ${i+1} 对 · ${labels[i]}`,
    "先读角的三色，找对应棱与空槽；这一对完成后停下，检查白十字及此前已完成的槽。",
  ]);
  const algorithm = segments.map(([moves]) => moves).join(" ");
  return makeCase({id,title,when:"白十字已经正确，四个角棱槽还没有完成。示例只是一种选择顺序，不是任意打乱通用的长公式。",
    setup:`${LATE} ${inverse(algorithm)}`, explanation:[
      "从能看清的一对开始。先预测第一对的目标槽，再看第一段；其余三对也各自重新识别，不能把整段连播当作理解。",
      "每完成一对就停止寻找那两块，把注意力移到未完成的角棱。找下一对时先放慢，不要求边转边盲找。",
      "四槽全部完成后检查白十字、白角和四条中棱，再进入顶层。练习变式改变了配对关系与动作，说明同一个阶段没有唯一固定公式。",
    ], focusPieces:allPairs,focusLabel:"四对角棱 · 逐对归位",check:"四个槽与白十字全部正确，前两层完成；顶层仍有待处理，继续选择 OLL 或入门顶层课程。"},segments);
}

function lesson(id: string, number: number, title: string, summary: string, cases: LessonCase[], specifics: {goal:string;prepare:string[];checklist:string[];pitfalls:{title:string;body:string}[];practice:string}): CourseLesson {
  return { id,number,title,kicker:`直观 F2L · ${number-12}/6`,summary,cases,relatedStudyIds:["f2l-insert","two-f2l"],...specifics };
}

export const F2L_LESSONS: CourseLesson[] = [
  lesson("f2l-foundations",13,"一对角棱，一个槽","先找同一家，再判断是不是真的配好。",[ready,falsePair],{
    goal:"能找到属于同一槽的角和棱，并区分正确配对与只是相邻。",
    prepare:["白十字必须完整且侧色对齐。白下黄上，前面绿色、右面橙色是本课示例的初始方向。","F2L 把白角与中层棱一起处理；白角的另外两种颜色，就是要找的棱色。"],
    checklist:["我能在未高亮的魔方上找出角、对应棱和目标槽。","我比较了相邻正确与相邻错误的两种连接。","实物插入后，我同时检查角三色、棱两色和白十字。"],
    pitfalls:[{title:"看到相邻就插入",body:"先检查两块的同侧颜色和白角朝向。错误连接也可以相邻，但进入槽后不会正确。"},{title:"只盯白色",body:"白色告诉你朝向，另外两色决定家在哪里。两种信息必须同时使用。"}],
    practice:"在实物上选两组不同颜色的角棱，不播放时先指出它们的家。做屏幕变式后，再独立处理一组配好的角棱。",
  }),
  lesson("f2l-basic-pairing",14,"借用空槽，让角棱相遇","从三步插入，理解藏角与移动棱。",[separated,opposite],{
    goal:"能解释怎样利用未完成的槽改变角棱关系，并辨认可直接插入的形态。",
    prepare:["先完成上一单元的找块练习。目标槽放在前右，其他已完成槽是需要保护的部分。","示范中的暂停点在完整动作组末尾；中途白十字暂时离位，不应插入额外补救动作。"],
    checklist:["我能分别指出开槽前后的角和棱。","我能区分棱在后上可直接接住与棱在左上需要转换。","实物每次收回右层后，白十字与已有槽仍正确。"],
    pitfalls:[{title:"以为必须先贴成一条",body:"配对也可以发生在插入过程中。判断相对位置，不必强求屏幕上先形成相邻形状。"},{title:"把已完成的槽当空槽",body:"先读槽的两个中心和现有角棱。需要借用的应是当前尚未完成的目标槽。"}],
    practice:"把三步插入与需要先转换的变式交替练习。每次先口述“角在哪里、棱在哪里、空槽在哪里”，再动手。",
  }),
  lesson("f2l-white-up",15,"白色朝上：先转换，再插入","同一个白角方向，也要区分棱的位置。",[whiteUpNear,whiteUpFar],{
    goal:"能处理两种白色朝上的关系，并在中间停顿处识别熟悉的三步插入。",
    prepare:["确认白十字完成，目标角在右上前；把注意力放在对应棱的去向。","U2 表示上层半圈。它改变顶层相对槽口的位置，不等同于整颗 y2。"],
    checklist:["我先找棱的位置，再选转换动作。","我能在转换完成后认出已学的三步插入关系。","实物结果同时满足白色朝下、侧色对中心、其他槽不乱。"],
    pitfalls:[{title:"白色朝上就只会背一套",body:"同一朝向下，棱还可能在不同位置。用两种真实局面比较，而不是按白色方向单独分类。"},{title:"转换到一半就开始插入",body:"先做完该动作组，收回右层；再判断新关系，避免从临时状态套另一公式。"}],
    practice:"轮换两种练习，先预测转换后棱的位置。实物中遇到白色朝上时先观察两块，不急着转。",
  }),
  lesson("f2l-trapped-pieces",16,"卡槽与错误连接","允许目标槽暂时变空，换来可理解的配对。",[trappedCorner,trappedEdge,bothTrapped],{
    goal:"分清角在槽内、棱在槽内与错误连接，能取出后重新识别。",
    prepare:["完成一个槽需要角棱都正确；单独正确的一条棱也可能需要暂时取出。","取出前确认操作的是目标槽。先保住白十字与另外已经完成的槽。"],
    checklist:["我能指出卡住的是角、棱还是两块错误连接。","取出后我重新找两块，而不是自动重复原动作。","实物最后检查了目标槽的五个侧/底贴片，以及其他已完成槽。"],
    pitfalls:[{title:"不肯动已经正确的一条棱",body:"F2L 的目标是完整的一对。暂时取出局部正确块可以形成更容易判断的关系。"},{title:"每个卡槽都重复同样次数",body:"本课三个例子的初始条件不同。先判断新状态，再继续；次数不是卡槽问题的通用答案。"}],
    practice:"分别体验“角在槽”“棱在槽”“两块都在但错”三种情况。取出后暂停，让自己决定下一步属于哪一单元。",
  }),
  lesson("f2l-four-slots",17,"四个槽，复用同一个原理","换正面之后，颜色身份和家的关系仍然不变。",[
    rotatedSlot("academy-f2l-slot-fr","前右槽：原地完成",""),
    rotatedSlot("academy-f2l-slot-fl","前左槽：整颗 y′ 换向","y'"),
    rotatedSlot("academy-f2l-slot-bl","后左槽：整颗 y2 换向","y2"),
    rotatedSlot("academy-f2l-slot-br","后右槽：整颗 y 换向","y"),
  ],{
    goal:"能按中心找到四个目标槽，通过整颗换向复用已学插入，并保护已完成槽。",
    prepare:["目标槽的名字取决于你当前看的方向，角棱的颜色身份不会变。","本课先用可观察的整颗换向；不把少转体或直接盲插后槽作为初学要求。"],
    checklist:["我先在原方向说出目标槽，再整颗换向。","换向后，我重新确认哪个面是前、哪个面是右。","在实物上至少用两组不同颜色完成入槽，并检查其他槽保持。"],
    pitfalls:[{title:"用 U 代替 y",body:"U 只动上层，会改变角棱相对槽口的位置；y 转整颗，中心和所有层一起移动。"},{title:"永远找绿色正面",body:"颜色只是示例。复用原理时，新的正面由你刚刚换到的中心决定。"}],
    practice:"随机选一个空槽，把它放到前右并说出新的两种中心色。练完前槽，再把同一判断用于后槽。",
  }),
  lesson("f2l-full-example",18,"完整 F2L：每完成一对就重新看","把短决策连起来，不背整段还原。",[
    fullExample("academy-f2l-full-a","实例一：四对逐个确认",[READY_PAIR,OPEN_SLOT,WHITE_UP,READY_PAIR]),
    fullExample("academy-f2l-full-b","实例二：关系改变，结尾仍可复用",[WHITE_UP,READY_PAIR,"R U' R' U2 R U R'",OPEN_SLOT]),
  ],{
    goal:"在四槽逐渐完成的过程中，独立找下一对、选槽、识别关系并完成检查。",
    prepare:["本例从白十字已完成开始。每一段只解决一对；完整演示不是通用打乱答案。","第一次逐段看，第二次每段播放前自己预测，第三次换实物陌生打乱。"],
    checklist:["我能在每一段开始前指出下一对与目标槽。","四段结束后白十字和四槽都正确。","我处理了不同于实例的一组实物角棱，记录需要提示的具体关系。"],
    pitfalls:[{title:"第一对做对，就连续播放剩下全部",body:"先停下来自己找下一对。训练的是重新判断，不是观看整段动画。"},{title:"找下一对时追求不停顿",body:"先保证看清和做对。稳定后再减少找块停顿，不用快速乱转掩盖判断困难。"}],
    practice:"在实物的新打乱中完成白十字，然后只靠单元提示做四对。若卡住，记录是找不到块、选错槽、配错关系还是执行漏步。",
  }),
];
