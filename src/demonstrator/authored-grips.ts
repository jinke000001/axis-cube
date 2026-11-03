import type { Face, Vec3 } from '../core/cube';
import type { TeachingFinger, TeachingHand } from './types';

/** Formula-level holding choices, keyed by the original source step.
 * These are authored teaching placements, not extra turns or chart finger hints. */
export interface AuthoredSupportPlacement {
  hand:TeachingHand;
  finger:TeachingFinger;
  face:Face;
  cubie:Vec3;
  arrivalPath?:'normal';
  reason:string;
}
const placements:Record<string,Record<number,AuthoredSupportPlacement[]>>={
  'gan-oll-03':{
    0:[{hand:'left',finger:'thumb',face:'L',cubie:[-1,-1,-1],arrivalPath:'normal',
      reason:'起始宽前层转动时，左拇指承托固定后层的下排，给拇指近节留出低于无名指安装座的通道；后续保持该承托，直到公式需要换位。'}],
    4:[{hand:'right',finger:'index',face:'B',cubie:[1,0,-1],arrivalPath:'normal',
      reason:'左食指拨U′前，右食指接住固定后层中排，与前面拇指相向承托；避免从上方指根跨过无名指和小指安装座去压右面下排，下一步宽前层转动时继续保留此后层支撑。'}],
  },
};
export function authoredSupportPlacements(formulaId:string,sourceStep:number):readonly AuthoredSupportPlacement[] {
  return placements[formulaId]?.[sourceStep]??[];
}

export interface AuthoredIdleWait {
  sourceStep:number;
  fromPhase:'release';
  hand:TeachingHand;
  finger:TeachingFinger;
  reason:string;
}
const idleWaits:Record<string,AuthoredIdleWait[]>={
};
export const authoredIdleWaits=(formulaId:string):readonly AuthoredIdleWait[]=>idleWaits[formulaId]??[];

export interface AuthoredReleaseRetirement {
  hand:TeachingHand;
  finger:TeachingFinger;
  reason:string;
}
const retirements:Record<string,Record<number,AuthoredReleaseRetirement[]>>={
  'gan-oll-03':{
    3:[{hand:'right',finger:'middle',reason:'中指完成R′并离开后层后收拢，让出下一步食指接稳的后层中排；接下来的U′和f′都不需要这根中指。'}],
  },
};
export const authoredReleaseRetirements=(formulaId:string,sourceStep:number):readonly AuthoredReleaseRetirement[]=>retirements[formulaId]?.[sourceStep]??[];

/** An unloaded hand receives around the cube's outside, before its thumb
 * resumes support. Distances are authored spatial clearances, not bone angles. */
export interface AuthoredExternalReception {
  sourceStep:number;
  waitFromStep:number;
  hand:TeachingHand;
  finger:TeachingFinger;
  side:Face;
  distance:number;
  reason:string;
}
const externalReceptions:Record<string,AuthoredExternalReception[]>={
  'gan-oll-03':[{sourceStep:4,waitFromStep:3,hand:'right',finger:'index',side:'R',distance:.05,
    reason:'食指随R′保留原局部指形；中指退出后，左手独立承托，右手向右退到魔方外侧，让食指在方外转向后面，再归掌、接稳拇指并让食指沿后面法线落位。'}],
};
export const authoredExternalReceptions=(formulaId:string):readonly AuthoredExternalReception[]=>externalReceptions[formulaId]??[];

export interface AuthoredFlickTransition {
  hand:TeachingHand;
  finger:TeachingFinger;
  departureClearance:number;
  releaseClearance:number;
  reason:string;
}
const flickTransitions:Record<string,Record<number,AuthoredFlickTransition[]>>={
  'gan-f2l-01':{3:[{hand:'left',finger:'index',departureClearance:.012,releaseClearance:.004,
    reason:'右手前后两面接稳后，左食指先沿原左面法线离开承托位，再准备顶层拨动；拨完只作足够解除贴面的短退出，随后接住下一次整体换向。'}]},
};
export const authoredFlickTransitions=(formulaId:string,sourceStep:number):readonly AuthoredFlickTransition[]=>flickTransitions[formulaId]?.[sourceStep]??[];

export interface AuthoredCornerReception {
  sourceStep:number;
  hand:TeachingHand;
  finger:TeachingFinger;
  fromFace:Face;
  clearance:number;
  reason:string;
}
const cornerReceptions:Record<string,AuthoredCornerReception[]>={
  'gan-oll-03':[{sourceStep:5,hand:'left',finger:'index',fromFace:'L',clearance:.012,
    reason:'食指从顶层拨动的左侧退出位接到后面承托时，先沿左面外侧到后角，再沿后面外侧移动并落位；避免末两节在掌上展开后再折回。'}],
};
export const authoredCornerReceptions=(formulaId:string):readonly AuthoredCornerReception[]=>cornerReceptions[formulaId]??[];

/** An idle folded digit opens an adjacent relay corridor. Angles describe the
 * authored side pocket; the offline author derives the actual rigid joint turn. */
export interface AuthoredRelayYield {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; incoming:TeachingFinger;
  sidePocketYaw:number; reason:string;
  /** Preserve this formula's own complete incoming branch and only add the
   * measured outer-corner guide, instead of re-authoring its neighbours. */
  referencePath?:{cornerFrom:number;cornerAmplitude:number;cornerDirection:Vec3};
}
const relayYields:Record<string,AuthoredRelayYield[]>={
  'gan-oll-01':[{sourceStep:7,hand:'left',finger:'ring',incoming:'middle',sidePocketYaw:Math.PI/6,
    reason:'第二次顶层拨动前，无职责无名指先抬起末节并向侧方让出折指通道；中指进入后才恢复末节与折指，原三处承托始终保持。'}],
  'gan-pll-15':[{sourceStep:13,hand:'left',finger:'ring',incoming:'middle',sidePocketYaw:Math.PI/6,
    referencePath:{cornerFrom:.75,cornerAmplitude:.0095,cornerDirection:[0,1,1]},
    reason:'顶层第二拨前，无名指先让出原中指进入通道；中指保留本式折形路线，在上前角外留足净距，再恢复无名指。对侧原承托位置和指腹不变。'}],
  'gan-oll-53':[{sourceStep:1,hand:'left',finger:'ring',incoming:'middle',sidePocketYaw:Math.PI/6,
    referencePath:{cornerFrom:.75,cornerAmplitude:.0065,cornerDirection:[0,1,1]},
    reason:'双拨接力时闲置无名指先抬末节并侧让，中指沿本式原路线从上前外角进入；原前后两面承托保持，进入后再恢复折指。'}],
};
export const authoredRelayYields=(formulaId:string):readonly AuthoredRelayYield[]=>relayYields[formulaId]??[];

/** Keep a supported distal joint below a turning upper layer, while its pad
 * and MCP stay fixed. The existing free receiving/releasing paths are retained. */
export interface AuthoredSupportClearance {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; face:Face; distalHeight:number; reason:string;
}
const supportClearances:Record<string,AuthoredSupportClearance[]>={
  'gan-pll-01-alt-1':[{sourceStep:9,hand:'right',finger:'index',face:'F',distalHeight:.01,
    reason:'食指接稳前面中央后，保持指腹与掌指关节不动，略降低远端指节，避开U′顶层扫过；转层结束再恢复原折形，然后按原流程换握。'}],
};
export const authoredSupportClearances=(formulaId:string):readonly AuthoredSupportClearance[]=>supportClearances[formulaId]??[];

/** A digit with no later task stays in a verified clear channel instead of
 * folding through its palm into the universal resting pose. */
export interface AuthoredIdleParking {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; duration:number;
  directions:[Vec3,Vec3,Vec3]; reason:string;
}
const idleParking:Record<string,AuthoredIdleParking[]>={
  'gan-pll-16':[{sourceStep:1,hand:'left',finger:'middle',duration:.35,
    directions:[[0,0,1],[0,.14834045293024462,.9889363528682975],[0,0,1]],
    reason:'中指完成宽顶层拨动并离面后，沿掌前侧伸出至空闲通道；本式后续没有中指接触任务，随掌保持该指形，让食指接收而不穿过掌壳折回统一收纳位。'}],
};
export const authoredIdleParking=(formulaId:string):readonly AuthoredIdleParking[]=>idleParking[formulaId]??[];

/** A free receiving digit retains the two valid boundary fold shapes, rather
 * than re-choosing a different elbow branch in the short incoming interval. */
export interface AuthoredJointReception {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; reason:string;
}
const jointReceptions:Record<string,AuthoredJointReception[]>={
  'gan-pll-16':[{sourceStep:8,hand:'right',finger:'index',
    reason:'食指接后面承托前，沿原起终折形平顺展开；避免短接收中先把中末节反折到同一关节球外，再重新展开。'}],
};
export const authoredJointReceptions=(formulaId:string):readonly AuthoredJointReception[]=>jointReceptions[formulaId]??[];

/** A temporary supporting digit leaves only after the receiving hand is ready,
 * before the adjacent gripping finger starts its own approach. */
export interface AuthoredPreclearance {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; incoming:TeachingFinger; duration:number; reason:string;
}
const preclearances:Record<string,AuthoredPreclearance[]>={
  'gan-pll-16':[{sourceStep:6,hand:'right',finger:'index',incoming:'middle',duration:.30,
    reason:'左手已接稳后，右食指不再承担临时底面支撑，先退出中指夹转的通道；食指让开后再让拇指和中指进入原夹持位。'}],
};
export const authoredPreclearances=(formulaId:string):readonly AuthoredPreclearance[]=>preclearances[formulaId]??[];

/** A receiver goes around the physical underside of the cube. The arm gets
 * explicit time to clear that channel before the digit leaves its old face. */
export interface AuthoredUnderReception {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; fromFace:'F'; toFace:'L';
  clearance:number; lowerClearance:number; armPreparation:number; armRecovery:number; reason:string;
}
const underReceptions:Record<string,AuthoredUnderReception[]>={
  'gan-pll-16':[{sourceStep:9,hand:'left',finger:'thumb',fromFace:'F',toFace:'L',clearance:.012,lowerClearance:.02,armPreparation:.30,armRecovery:.30,
    reason:'后面食指先接稳后，机械臂先让出掌下通道；拇指从前面沿法线离开，绕魔方下侧到左面外侧，再沿左面法线接稳。'}],
};
export const authoredUnderReceptions=(formulaId:string):readonly AuthoredUnderReception[]=>underReceptions[formulaId]??[];

/** An unloaded hand forms a two-pad wide-layer grip outside the cube before
 * returning to the existing normal approach. */
export interface AuthoredExternalPreform {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; first:TeachingFinger; side:Face;
  distance:number; withdrawDuration:number; preformDuration:number; returnDuration:number; reason:string;
}
const externalPreforms:Record<string,AuthoredExternalPreform[]>={
  'gan-pll-16':[{sourceStep:11,hand:'right',finger:'thumb',first:'index',side:'R',distance:.037,
    withdrawDuration:.20,preformDuration:.30,returnDuration:.25,
    reason:'左手独立稳持时，右手先退到魔方右侧净空；食指先成形，再让拇指进入双层拨动姿态，整手返回下层外侧后才共同落位，避免两指在角块旁同时相交。'}],
};
export const authoredExternalPreforms=(formulaId:string):readonly AuthoredExternalPreform[]=>externalPreforms[formulaId]??[];

/** Repeat a complete, already authored grip branch for the same source move,
 * retargeting it to the current palms and exact held pads. */
export interface AuthoredGripTemplate {
  sourceStep:number; referenceStep:number; entryDuration:number; exitDuration:number;
  roles:{hand:TeachingHand;finger:TeachingFinger}[]; reason:string;
}
const gripTemplates:Record<string,AuthoredGripTemplate[]>={
  'gan-pll-05':[{sourceStep:6,referenceStep:2,entryDuration:.30,exitDuration:.30,
    roles:[{hand:'left',finger:'thumb'},{hand:'left',finger:'middle'},{hand:'left',finger:'ring'},
      {hand:'right',finger:'thumb'},{hand:'right',finger:'index'}],
    reason:'第二次D2沿用本式第一次D2的整段承托与无名指弯曲分支；在原指腹接稳的前提下先调整折形，连续完成两次无名指拨动，再平顺恢复下一步握姿，避免同一接触位无故翻到内折分支。'}],
};
export const authoredGripTemplates=(formulaId:string):readonly AuthoredGripTemplate[]=>gripTemplates[formulaId]??[];

/** A measured single-quarter grip needs the same swept MCP clearance check
 * as a double flick. Keep this scoped to verified original source steps. */
export interface AuthoredQuarterClearance {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; reason:string;
}
const quarterClearances:Record<string,AuthoredQuarterClearance[]>={
  'gan-pll-06':[{sourceStep:6,hand:'left',finger:'index',
    reason:'本次单U的食指近端折形经整拨弧检查需额外净空；保持原支撑和拨动方向，先外让手掌再落位，避免近端两节折回相交。'}],
  'gan-f2l-06':[{sourceStep:4,hand:'left',finger:'index',
    reason:'本次单U的食指近端折形经整拨弧检查需额外净空；保持原支撑和拨动方向，先外让手掌再落位，避免近端两节折回相交。'}],
  'gan-f2l-10':[{sourceStep:6,hand:'left',finger:'index',
    reason:'本次单U的食指近端折形经整拨弧检查需额外净空；保持原支撑和拨动方向，先外让手掌再落位，避免近端两节折回相交。'}],
  'gan-oll-28':[{sourceStep:6,hand:'left',finger:'index',
    reason:'本次单U的食指近端折形经整拨弧检查需额外净空；保持原支撑和拨动方向，先外让手掌再落位，避免近端两节折回相交。'}],
  'gan-oll-07':[{sourceStep:3,hand:'left',finger:'index',
    reason:'本次单U的食指近端折形经整拨弧检查需额外净空；保持原支撑和拨动方向，先外让手掌再落位，避免近端两节折回相交。'}],
  'gan-f2l-18':[{sourceStep:8,hand:'left',finger:'index',
    reason:'本次顶层食指拨动的近端折形过紧；支撑指保持贴面，左掌先外让，为整90度拨弧留出刚性指节空间。'}],
  'gan-pll-14':[{sourceStep:8,hand:'left',finger:'index',
    reason:'当前握位下单次顶层食指拨动也需预留近节空间；沿用整90度扫掠检查，先小幅开掌再落位，不改变原拨动手指或方向。'}],
  'gan-oll-56':[{sourceStep:3,hand:'left',finger:'index',
    reason:'本次单U先外让手掌完成刚性拨弧，随后保持承托回原衔接掌位，避免改变后继动作所需空间。'}],
  'gan-oll-18':[{sourceStep:3,hand:'left',finger:'index',
    reason:'本次单U的食指近节需要整拨弧净空，保持原承托并先外让手掌，避免近端两节折回相交。'}],
};
export const authoredQuarterClearances=(formulaId:string):readonly AuthoredQuarterClearance[]=>quarterClearances[formulaId]??[];

/** A fixed-pad support and an idle digit coordinate a two-finger U relay.
 * All directions are authored spatial channels, never physical extra contacts. */
export interface AuthoredSupportedRelay {
  sourceStep:number; hand:TeachingHand; incoming:TeachingFinger; yielding:TeachingFinger;
  supportHand:TeachingHand; supportFinger:TeachingFinger; supportFace:Face;
  supportDirection:Vec3; supportPole:Vec3; entryDuration:number; exitDuration:number;
  sidePocketYaw:number; cornerFrom:number; cornerAmplitude:number; cornerDirection:Vec3; reason:string;
}
const supportedRelays:Record<string,AuthoredSupportedRelay[]>={
  'gan-oll-18':[{sourceStep:13,hand:'left',incoming:'middle',yielding:'ring',supportHand:'right',supportFinger:'index',supportFace:'B',
    supportDirection:[.5,0,-Math.sqrt(.75)],supportPole:[1,0,-1],entryDuration:.20,exitDuration:.20,
    sidePocketYaw:Math.PI/6,cornerFrom:.75,cornerAmplitude:.0045,cornerDirection:[0,1,1],
    reason:'后面食指贴稳后把远端指节移出顶层扫掠带；第二拨前无名指抬末节并侧让，中指沿上前外角进入，随后恢复无名指。两拨完成并离面后，承托食指再恢复原折形。'}],
};
export const authoredSupportedRelays=(formulaId:string):readonly AuthoredSupportedRelay[]=>supportedRelays[formulaId]??[];

/** A scoped clearance can return to the original next-step pose, while a later
 * source move reuses the original continuous joint branch with fixed pads. */
export interface AuthoredGripRecovery {
  clearanceStep:number; sourceStep:number; returnDuration:number; entryDuration:number; exitDuration:number;
  supportHand:TeachingHand; supportFinger:TeachingFinger; supportFace:Face;
  supportDirection:Vec3; supportPole:Vec3; supportDuration:number; reason:string;
}
const gripRecoveries:Record<string,AuthoredGripRecovery[]>={
  'gan-oll-56':[{clearanceStep:3,sourceStep:7,returnDuration:.30,entryDuration:.30,exitDuration:.30,
    supportHand:'right',supportFinger:'index',supportFace:'B',supportDirection:[.5,0,-Math.sqrt(.75)],supportPole:[1,.25,-1],supportDuration:.20,
    reason:'单U开掌后保持指腹接稳并回原衔接姿；后续顶层拨动预先恢复该动作原有的连续折指分支，后面食指接稳后将远节移出顶层扫掠带，转层完再恢复。'}],
};
export const authoredGripRecoveries=(formulaId:string):readonly AuthoredGripRecovery[]=>gripRecoveries[formulaId]??[];

/** An idle neighbour yields while a retired digit follows its existing
 * off-surface pad corridor; both retain their original contact roles. */
export interface AuthoredRetirementYield {
  sourceStep:number; hand:TeachingHand; finger:TeachingFinger; yielding:TeachingFinger;
  sidePocketYaw:number; distalReturnVia:Vec3; reason:string;
}
const retirementYields:Record<string,AuthoredRetirementYield[]>={
  'gan-pll-15':[{sourceStep:15,hand:'right',finger:'middle',yielding:'ring',sidePocketYaw:-Math.PI/6,distalReturnVia:[0,1,0],
    reason:'另一手稳持时，无名指先将末节抬向掌外并侧让，中指沿已离面的前方通道收拢；无名指先恢复近节方向，再经掌上侧恢复末节，最后才开始原空手换腕。'}],
};
export const authoredRetirementYields=(formulaId:string):readonly AuthoredRetirementYield[]=>retirementYields[formulaId]??[];
