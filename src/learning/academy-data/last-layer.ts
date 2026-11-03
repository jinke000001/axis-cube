import type { CourseLesson, LessonCase } from "../types.ts";
import { EDGE_CYCLE, inverse, makeCase } from "./shared.ts";
import type { Segment } from "./shared.ts";

/** Formula choices checked against J Perm's public 2-look trainers, 2026-11-01.
 * Text and segmentation are AXIS teaching content. Z includes a final AUF so
 * each edge-only demonstration starts and finishes with aligned corners. */
export interface TwoLookRecord {
  id: string;
  stage: "oll-edges" | "oll-corners" | "pll-corners" | "pll-edges";
  name: string;
  sourceName: string;
  algorithm: string;
  recognition: string;
  orientation: string;
  groups: Segment[];
}

export const TWO_LOOK_RECORDS: TwoLookRecord[] = [
  {id:"two-oll-line",stage:"oll-edges",name:"横线",sourceName:"I-Shape",algorithm:"F R U R' U' F'",
    recognition:"只看四条黄棱：有两条朝上，而且互相对面。黄角的样子不影响这一步。",orientation:"把黄色横线放成左右方向；前上、后上两条棱的黄色朝侧面。",
    groups:[["F","打开前层","记住前面，暂时带走的前两层稍后会恢复。"],["R U R' U'","完成四步","每一步转足，不因看到黄色增加就提前停。"],["F'","收回前层","黄十字应形成，前两层回到正确状态。"]]},
  {id:"two-oll-elbow",stage:"oll-edges",name:"折角",sourceName:"L-Shape",algorithm:"f R U R' U' f'",
    recognition:"只有两条相邻黄棱朝上。不要把旁边的黄角算成第三条棱。",orientation:"本公式把朝上的黄棱摆在前上和右上。f 是前面两层一起转，方向与 F 相同。",
    groups:[["f","两层一起打开","f 包含前层和紧邻的中层；不是单独 F。"],["R U R' U'","复用四步","继续保持原正面。"],["f'","两层一起收回","检查四条黄棱，不要求黄角也朝上。"]]},
  {id:"two-oll-dot",stage:"oll-edges",name:"点",sourceName:"Dot Shape",algorithm:"F R U R' U' F' f R U R' U' f'",
    recognition:"四条黄棱都没有朝上，只剩黄中心作为参照；黄角可以是任意合法朝向。",orientation:"保持白下黄上。本例连做两段；第一段结束不要转体，直接接第二段。",
    groups:[["F R U R' U' F'","先改变黄棱关系","第一段完成仍可能没有十字，不要就此结束。"],["f R U R' U' f'","完成黄十字","注意第二段用小写 f，宽转两层。"]]},
  {id:"two-oll-h",stage:"oll-corners",name:"H 型",sourceName:"H",algorithm:"R U R' U R U' R' U R U2 R'",
    recognition:"黄十字已完成，四个黄角都不朝上；左右两个侧面各有一对朝外的黄色角贴片。",orientation:"两对黄色角贴片分别放在左面和右面。这里只读黄色朝向，不比较其他侧色。",
    groups:[["R U R' U","第一段","保持原正面，记一组右层进出。"],["R U' R' U","中间反向","这一组的 U′ 与前一组不同。"],["R U2 R'","半圈收尾","完成整组后再看黄面与前两层。"]]},
  {id:"two-oll-pi",stage:"oll-corners",name:"Pi 型",sourceName:"Pi",algorithm:"R U2 R2 U' R2 U' R2 U2 R",
    recognition:"黄十字已完成，四个黄角都不朝上；只有一个侧面有两枚黄色角贴片。",orientation:"把唯一一对黄色角贴片放在左面；另外两枚分别朝前和朝后。",
    groups:[["R U2","开头半圈","先把右层与顶层摆到下一组位置。"],["R2 U' R2 U' R2","三个右层半圈","三个 R2 之间只用 U′，不要把半圈当四分之一圈。"],["U2 R","收尾恢复","顶层再半圈，最后 R 恢复右层。"]]},
  {id:"two-oll-u",stage:"oll-corners",name:"U 型",sourceName:"U",algorithm:"R2 D R' U2 R D' R' U2 R'",
    recognition:"有两个相邻黄角朝上；另外两个黄角的黄色贴片朝向同一个侧面。",orientation:"两个朝上的黄角放在后排，另外两枚黄色贴片都朝前。D 是从底面看顺时针。",
    groups:[["R2 D","借用底层空间","D 不是 U；白层暂时变动属于这一完整公式。"],["R' U2 R D'","换角并收回底层","D′ 必须收回刚才的底层变化。"],["R' U2 R'","完成朝向","检查白层和中层确实恢复。"]]},
  {id:"two-oll-t",stage:"oll-corners",name:"T 型",sourceName:"T",algorithm:"r U R' U' r' F R F'",
    recognition:"有两个相邻黄角朝上；剩下两个黄色贴片分别朝向相反的侧面。",orientation:"朝上的两个黄角放在右侧；其余黄色分别朝前、朝后。r 是右边两层一起转。",
    groups:[["r U R' U'","宽转开始","小写 r 包含右层和中层，随后大写 R′ 只动右层。"],["r' F R F'","恢复并翻角","把 F R F′ 作为收尾组，做完再检查。"]]},
  {id:"two-oll-l",stage:"oll-corners",name:"L 型",sourceName:"L",algorithm:"F R' F' r U R U' r'",
    recognition:"有两个对角位置的黄角朝上；与只有相邻两个朝上的 U、T 型区分。",orientation:"朝上的黄角在左后和右前；另两枚黄色分别朝前和朝右。",
    groups:[["F R' F'","先改一组朝向","这一组先用前层夹住 R′。"],["r U R U' r'","宽转收尾","开头 r 与结尾 r′ 对应，最后前两层恢复。"]]},
  {id:"two-oll-antisune",stage:"oll-corners",name:"反小鱼",sourceName:"Antisune",algorithm:"R U2 R' U' R U' R'",
    recognition:"只有一个黄角朝上；其余三枚黄色绕向与小鱼相反。不能只凭“一个黄角”就选同一公式。",orientation:"唯一朝上的黄角放在右后；前面的左上角贴片为黄色。",
    groups:[["R U2 R'","先半圈","反小鱼的半圈出现在开头。"],["U' R U' R'","两次反向顶层","两次都是 U′，最后收回右层。"]]},
  {id:"two-oll-sune",stage:"oll-corners",name:"小鱼",sourceName:"Sune",algorithm:"R U R' U R U2 R'",
    recognition:"只有一个黄角朝上；另外三枚黄色的绕向与反小鱼不同，需要再看侧面。",orientation:"唯一朝上的黄角放在左前；右前角的黄色贴片朝前。",
    groups:[["R U R' U","前半段","两次顶层都是 U。"],["R U2 R'","半圈收尾","半圈在结尾，区别于反小鱼。"]]},
  {id:"two-pll-headlights",stage:"pll-corners",name:"相邻换角",sourceName:"Headlights",algorithm:"R U R' U' R' F R2 U' R' U' R U R' F'",
    recognition:"黄面完整。绕四个侧面，只比较每面最上排的两个角：恰有一面出现同色角对（车灯）。",orientation:"把唯一的同色角对放在左面，再做 T 置换。侧面顶棱颜色暂时不参与这一步判断。",
    groups:[["R U R' U'","第一组四步","黄面短暂变化正常，必须继续完整公式。"],["R' F R2 U' R' U'","中间换位","R2 是半圈，随后两次 U′ 分别执行。"],["R U R' F'","恢复前两层","做完看四面角对；必要时只用 U 对齐侧面中心。"]]},
  {id:"two-pll-diagonal",stage:"pll-corners",name:"对角换角",sourceName:"Diagonal",algorithm:"F R U' R' U' R U R' F' R U R' U' R' F R F'",
    recognition:"黄面完整，四个侧面都没有同色角对；对应对角角块需要交换。",orientation:"确认四面都看过，没有车灯。保持示例当前正面，做 Y 置换；最后用 U 对齐四个角。",
    groups:[["F R U' R' U' R U R' F'","前段交换关系","先完整收回 F′，不要中途根据车灯停下。"],["R U R' U' R' F R F'","后段恢复朝向","结束后黄面与前两层保持，四个角可用顶层调整对齐。"]]},
  {id:"two-pll-h",stage:"pll-edges",name:"H 换棱",sourceName:"PLL (H)",algorithm:"M2 U M2 U2 M2 U M2",
    recognition:"顶角已经对齐中心，四条顶棱都错；每条棱都要去它正对面的侧面。",orientation:"白下黄上，角先对齐。M 是中间竖层，转向参考 L；M2 为这层半圈。",
    groups:[["M2 U M2","第一对交换","用中层与顶层配合，保持握姿。"],["U2","顶层半圈","不要混成整颗 y2。"],["M2 U M2","第二对与恢复","四角最终回到原位，六面应完成。"]]},
  {id:"two-pll-z",stage:"pll-edges",name:"Z 换棱",sourceName:"PLL (Z)",algorithm:"M' U M2 U M2 U M' U2 M2 U'",
    recognition:"顶角已对齐，四条顶棱都错；它们分成两组相邻侧面的互换，不是对面互换。",orientation:"本例前棱要去左面、后棱要去右面。M′ 与 L′ 同方向；末尾 U′ 是对齐顶角的调整。",
    groups:[["M' U","先移动中层","中层的转向与右层 R 不是同一参照。"],["M2 U M2 U","两个半圈组","保持两次 U 方向一致。"],["M' U2 M2","恢复中层","先完成整段，再看最终顶层偏移。"],["U'","对齐顶角与侧面","这一步称顶层调整（AUF）；完整结果需要它。"]]},
  {id:"two-pll-ua",stage:"pll-edges",name:"Ua 三棱循环",sourceName:"PLL (Ua)",algorithm:"R U' R U R U R U' R' U' R2",
    recognition:"顶角已对齐，恰有一条顶棱正确。把它放后面后，前上棱的侧色属于右面的中心。",orientation:"正确顶棱放背面；用颜色去向判 Ua / Ub，不靠想象顺时针箭头。",
    groups:[["R U'","开始循环","固定正面，先反向转顶层。"],["R U R U","中间同向组","连续两个 R U。"],["R U' R' U' R2","收尾恢复右层","最后 R2 做足，检查六面。"]]},
  {id:"two-pll-ub",stage:"pll-edges",name:"Ub 三棱循环",sourceName:"PLL (Ub)",algorithm:"R2 U R U R' U' R' U' R' U R'",
    recognition:"顶角已对齐，恰有一条顶棱正确。正确棱放后面后，前上棱的侧色属于左面的中心。",orientation:"正确顶棱放背面，前棱应去左。与 Ua 的判断参照相同，但去向相反。",
    groups:[["R2 U","开头半圈","这一次半圈在开头。"],["R U R' U'","熟悉的四步","完整执行，不当成可随时停止的独立还原。"],["R' U' R' U R'","完成循环","最后检查背面也保持正确。"]]},
];

function lastLayerCase(record: TwoLookRecord): LessonCase {
  const after = record.stage === "oll-edges" ? `z2 ${EDGE_CYCLE} R U R' U R U2 R'`
    : record.stage === "pll-edges" ? "z2" : `z2 ${EDGE_CYCLE}`;
  return makeCase({ id:record.id,title:record.name,when:record.recognition,
    setup:`${after} ${inverse(record.algorithm)}`,
    orientation:`白色朝下，黄色朝上。${record.orientation}`,
    explanation:[record.recognition,record.orientation,
      record.stage === "oll-edges" ? "这一段只处理四条黄棱。形成十字就停止，再独立判断七种黄角朝向；不把黄角暂时变化当作错误。"
      : record.stage === "oll-corners" ? "先确认黄十字已完成，再选择黄角公式。公式结束应整面黄色，但侧面顶块仍可错位，下一阶段才换位置。"
      : record.stage === "pll-corners" ? "先完成角的位置，再处理棱。这里的同色角对与 OLL 中的黄色朝向是两种不同的识别；角对完成后先用 U 对齐中心。"
      : "先确认黄面、前两层和四个顶角都正确，再读顶棱去向。最后要观察全部六面；只看黄色一面不算还原。",
      "先按动作组慢放，再在实物上跟做。记不清时回到上一完整动作组，已知的误转可以逐步撤销；不盲目重做整套。"],
    focusFace:"U", check:record.stage === "oll-edges" ? "四条黄棱朝上，前两层完整。黄角尚未要求朝上，请继续选黄角情形。"
      : record.stage === "oll-corners" ? "上面九格全黄，前两层完整。侧面顶块仍可能错位，继续进入两步 PLL。"
      : record.stage === "pll-corners" ? "四面都有同色角对，顶层对齐后四角接上各自中心；黄面和前两层完整，顶棱可继续待换。"
      : "六面都同色，顶角仍与中心对齐；底面和背面也已逐面检查。",
  },record.groups);
}

export const TWO_LOOK_LESSONS: CourseLesson[] = [
  {id:"two-look-oll",number:19,title:"两步 OLL：先黄棱，再黄角",kicker:"简化顶层 · 10 套",summary:"3 种黄棱关系 + 7 种黄角关系，分两次把黄面朝上。",
    goal:"前两层完成后，能独立识别黄棱与黄角两步情形，正确摆位并保护前两层。",
    prepare:["先检查白层和中层完整。白下黄上；只改变最后一层朝向，不要求这一步解决顶层位置。","先看黄棱：点、折角、横线或已成十字；十字完成才看黄角。黄面已全黄可直接跳到 PLL。","小写 r / f 是两层一起转，M 是中间一层，D 是底层。先在三维示范中单步确认，再在实物执行。","建议每次学习 1–2 种，先能识别和摆位，再逐渐加入混合练习。10 套是覆盖范围，不是一次背完的任务。"],
    cases:TWO_LOOK_RECORDS.filter((r)=>r.stage.startsWith("oll")).map(lastLayerCase),
    checklist:["我只数四条黄棱，形成十字后再看四个黄角。","我能用侧面黄色方向区分小鱼与反小鱼、H 与 Pi、U 与 T。","实物完成一套后，我检查黄面目标和前两层都正确。","我完成了不同于示例的两种混合识别，且在实物重新摆过位。"],
    pitfalls:[{title:"只有一个黄角就无条件做小鱼",body:"还要看侧面黄色的方向；小鱼和反小鱼都是一个黄角朝上。"},{title:"折角摆位与公式版本混用",body:"本课 f 版本把朝上的两条黄棱放在前上、右上。其他教程可能使用不同公式和摆位，不能拼接。"},{title:"把 OLL 当作顶层还原",body:"OLL 只解决朝向。黄面全黄后，仍要用 PLL 解决侧色位置。"}],
    practice:"先做一条黄棱题，再混合七种黄角题。实物从前两层完整的局面开始，自行识别并摆位，做完只检查目标，不依靠点“已读”判定掌握。",relatedStudyIds:[]},
  {id:"two-look-pll",number:20,title:"两步 PLL：先角位置，再棱位置",kicker:"简化顶层 · 6 套",summary:"2 种换角 + 4 种换棱，用颜色去向完成最后一层。",
    goal:"黄面完成后，能按同色角对判断换角，再按中心色判断顶棱去向，独立完成六面。",
    prepare:["先完成 OLL：上面九格黄色且前两层完整。朝向还没做好时，不进入换位公式。","先看四面角对；全部角对存在时，用 U 对齐中心，跳过换角。再处理四条顶棱。","换角后可能还需 U / U′ / U2 使角与中心相接。这叫顶层调整，先完成它再判断换棱。","Ua / Ub 用“前棱要去右还是左”辨认。顺逆时针取决于观察视角，初学不靠箭头猜。"],
    cases:TWO_LOOK_RECORDS.filter((r)=>r.stage.startsWith("pll")).map(lastLayerCase),
    checklist:["我看过四个侧面，能判断有一对车灯还是完全没有。","换角后我先把四个角与侧面中心对齐。","我能读前棱的侧色去向，区分 Ua / Ub；也能区分相邻互换与对面互换。","实物跟做后六面逐面确认，随后换一个未见局面再试。"],
    pitfalls:[{title:"同色角对与中心暂时不对就认为公式错",body:"先判断四面是否都有同色角对；若都有，通常只需顶层调整使角对齐中心。"},{title:"把正确面用 U 转到背面",body:"要保持四角归位，应整颗 y 换向。U 会把已对齐的顶角再次带走。"},{title:"Z 公式最后忘记调整",body:"本课把末尾 U′ 也列入动作组；它让四角和侧色最终对齐，不能在中层恢复时提前停止。"}],
    practice:"从一个换角例子完成第一步，再重新识别换棱；屏幕混合练习后，使用实物陌生顶层状态检验，记录错在认车灯、读去向、摆位还是执行。",relatedStudyIds:[]},
];
