import {
  GAN_F2L_ALGORITHMS,
  GAN_OLL_ALGORITHMS,
  GAN_PLL_ALGORITHMS,
  GAN_PLL_ALTERNATIVES,
} from './cfop-data/algorithms';
import setupData from './cfop-data/setups.json';
import fixtureData from './cfop-data/recognition-fixtures.json';
import f2lDescriptionData from './cfop-data/f2l-descriptions.json';

export type CFOPStage = 'F2L' | 'OLL' | 'PLL';

/** These facts were read from GAN's supplied chart, independently of the algorithms.
 * F2L: U/F/R are positional faces; U/R/B values mean white/red/blue, '.' means unmarked.
 * OLL: 1 means yellow. top is row-major; bars are back L→R, right B→F,
 * front L→R, left B→F, all viewed from above.
 * PLL: cycles are the printed source→destination arrows on top-view cells 0..8. */
export type CFOPRecognitionFixture =
  | { kind: 'f2l'; U: string; F: string; R: string }
  | { kind: 'oll'; top: string; bars: string }
  | { kind: 'pll'; cycles: readonly (readonly number[])[] };

export interface CFOPCase {
  id: string;
  /** Printed GAN sheet number, deliberately not presented as a universal case number. */
  sourceNumber: number;
  sourceName: string;
  stage: CFOPStage;
  name: string;
  category: string;
  recognition: string;
  orientation: string;
  /** The source's action groups are retained; X'2 spelling is normalized to X2'. */
  algorithm: string;
  alternateAlgorithms?: readonly string[];
  /** Legal sequence from the engine's white-up SOLVED to the exact source holding. */
  setup: string;
  check: string;
  lessonId: string;
  sourceUrl: string;
  recognitionFixture: CFOPRecognitionFixture;
  /** Accurate cubie animation is always available; uncalibrated gestures need not be shown. */
  usesWholeCubeOrSlice: boolean;
}

const GAN_SOURCE = 'https://www.gancube.com/pages/3x3x3-cfop-guide-gancube';
const ORIENTATION = '白色中心朝下，黄色中心朝上，蓝色中心朝前，红色中心朝右。先按图摆好目标块；公式里的 x、y、z 是整体转动，执行时连同整颗魔方一起转。';
const setups: Record<string, string> = setupData;
type RawFixture = { U?: string; F?: string; R?: string; top?: string; bars?: string; cycles?: number[][] };
const fixtures: Record<string, RawFixture> = fixtureData;
const f2lDescriptions: Record<string, {category: string;cornerLocation: string;edgeLocation: string;whiteFace: string;edgeBlueFace: string}> = f2lDescriptionData;

const PLL_NAMES = ['Ua','Ub','H','Z','Aa','Ab','E','T','F','V','Y','Ja','Jb','Rb','Ra','Gc','Gd','Ga','Gb','Nb','Na'] as const;
const TOP_POSITIONS = ['后左角','后棱','后右角','左棱','中心','右棱','前左角','前棱','前右角'];
const PLL_RECOGNITION = [
  '后侧是一整条同色条，三个顶棱需要循环。前棱去右侧，右棱去左侧，左棱去前侧。',
  '后侧是一整条同色条，三个顶棱需要循环。前棱去左侧，左棱去右侧，右棱去前侧。',
  '四个顶角已归位；前后两条顶棱互换，左右两条顶棱互换。',
  '四个顶角已归位；后棱与右棱互换，左棱与前棱互换。',
  '四条顶棱已归位，后左角不动；后右角去前右，前右去前左，前左去后右。',
  '四条顶棱已归位，后左角不动；后右角去前左，前左去前右，前右去后右。',
  '四条顶棱已归位；左边两个顶角前后互换，右边两个顶角前后互换。',
  '右侧两个顶角互换，同时左右两条顶棱互换。先确认同色的两角位于左侧。',
  '右侧两个顶角互换，同时前后两条顶棱互换；不要只凭右侧两角判断为 T。',
  '后左与前右两个对角互换，同时后棱与右棱互换。',
  '后左与前右两个对角互换，同时后棱与左棱互换。',
  '前侧两个顶角互换，同时右棱与前棱互换。整条同色条位于后侧。',
  '右侧两个顶角互换，同时右棱与前棱互换。整条同色条位于左侧。',
  '后侧两个顶角互换，同时右棱与前棱互换。按图检查角块和棱块两组位置。',
  '右侧两个顶角互换，同时后棱与左棱互换。按图检查角块和棱块两组位置。',
  '三个角与三个棱同时循环：角是后左→前左→前右，棱是左→右→前。先核对同色的相邻角棱块。',
  '三个角与三个棱同时循环：角是后左→后右→前左，棱是后→左→前。先核对同色的相邻角棱块。',
  '三个角与三个棱同时循环：角是后左→后右→前左，棱是后→左→右。先核对同色的相邻角棱块。',
  '三个角与三个棱同时循环：角是后左→前左→前右，棱是后→前→左。先核对同色的相邻角棱块。',
  '后左与前右两个对角互换，同时左右两条顶棱互换。注意它与 Y 的棱块交换方向不同。',
  '后右与前左两个对角互换，同时左右两条顶棱互换。先核对对角线方向。',
];

function lastLayerShape(top: string): string {
  const edges = [1,3,5,7].filter(i => top[i] === '1');
  if (edges.length === 0) return '点形';
  if (edges.length === 4) return '黄十字';
  return edges[0] + edges[1] === 8 ? '一字形' : '拐角形';
}

function makeCase(stage: CFOPStage, algorithm: string, index: number): CFOPCase {
  const sourceNumber = index + 1;
  const id = `gan-${stage.toLowerCase()}-${String(sourceNumber).padStart(2,'0')}`;
  const raw = fixtures[id];
  let name: string;
  let category: string;
  let recognition: string;
  let recognitionFixture: CFOPRecognitionFixture;
  if (stage === 'F2L') {
    const d = f2lDescriptions[id];
    category = d.category;
    name = `${d.category} · 白色朝${d.whiteFace}`;
    recognition = `找到白蓝红角块：它在${d.cornerLocation}，白色朝${d.whiteFace}。再找蓝红棱块：它在${d.edgeLocation}，蓝色朝${d.edgeBlueFace}。目标是蓝、红中心交界的右前槽，图中灰色贴片无需匹配。`;
    recognitionFixture = {kind: 'f2l', U: raw.U!, F: raw.F!, R: raw.R!};
  } else if (stage === 'OLL') {
    const top = raw.top!;
    category = lastLayerShape(top);
    const corners = [0,2,6,8].filter(i => top[i] === '1').length;
    name = `${category} · ${corners} 个黄角`;
    const positions = [0,1,2,3,5,6,7,8].filter(i => top[i] === '1').map(i => TOP_POSITIONS[i]);
    recognition = `先看顶棱，当前是${category}。除中心外，顶面黄色位于${positions.join('、') || '无其他位置'}；同时核对图示外圈黄色条。只看顶面形状相似，还不能确定是同一个情形。`;
    recognitionFixture = {kind: 'oll', top, bars: raw.bars!};
  } else {
    name = `${PLL_NAMES[index]} · 顶层换位`;
    category = index < 4 ? '仅顶棱换位' : index < 7 ? '仅顶角换位' : index >= 15 && index <= 18 ? '角棱循环' : '角棱交换';
    recognition = PLL_RECOGNITION[index];
    recognitionFixture = {kind: 'pll', cycles: raw.cycles!};
  }
  return {
    id, sourceNumber, sourceName: `GAN 原表 ${stage} ${String(sourceNumber).padStart(2,'0')}`,
    stage, name, category, recognition, orientation: ORIENTATION, algorithm,
    ...(stage === 'PLL' && GAN_PLL_ALTERNATIVES[sourceNumber] ? {alternateAlgorithms: GAN_PLL_ALTERNATIVES[sourceNumber]} : {}),
    setup: setups[id],
    check: stage === 'F2L'
      ? '白蓝红角块与蓝红棱块一同进入蓝、红中心之间的槽。检查白十字、其余三个槽仍然正确，不能只看白色底面。'
      : stage === 'OLL'
        ? '黄色中心所在面全部变成黄色，前两层保持完成。顶层侧色此时可以还没归位，接下来才做 PLL。'
        : '对齐顶层后，检查四个侧面各自与中心同色，并确认底面和前两层保持完成。六个面都一致才算还原。',
    lessonId: stage === 'F2L' ? 'f2l-foundations' : stage === 'OLL' ? 'two-look-oll' : 'two-look-pll',
    sourceUrl: GAN_SOURCE,
    recognitionFixture,
    usesWholeCubeOrSlice: /[xyzMESurfdlb]/.test(algorithm),
  };
}

/** A reference shelf, not a requirement to memorize 119 cases before beginning. */
export const CFOP_CASES: readonly CFOPCase[] = [
  ...GAN_F2L_ALGORITHMS.map((algorithm,index) => makeCase('F2L',algorithm,index)),
  ...GAN_OLL_ALGORITHMS.map((algorithm,index) => makeCase('OLL',algorithm,index)),
  ...GAN_PLL_ALGORITHMS.map((algorithm,index) => makeCase('PLL',algorithm,index)),
];

const byId = new Map(CFOP_CASES.map(item => [item.id,item]));
export function getCFOPCase(id: string): CFOPCase | undefined {
  return byId.get(id);
}
