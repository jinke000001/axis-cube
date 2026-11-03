import { COLOR_NAMES, FACES, FACE_NAMES, SLOTS, SOLVED, parseAlgorithm } from "../../core/cube.ts";
import type { Face, Vec3 } from "../../core/cube.ts";
import type { CourseLesson, LessonCase } from "../types.ts";
import type { ActivityOption, ChoiceActivity, LessonActivity, PickPieceActivity } from "../academy-types.ts";
import { TWO_LOOK_RECORDS } from "./last-layer.ts";
import { TWO_LOOK_FIXTURES } from "./two-look-fixtures.ts";
import { center, colorKey, colorLabel, colorsAt, findPiece, homePosition, inverse, LATE, POSITIONS, setupState, slotsAt, solvedPosition, stickerFace } from "./shared.ts";

/** Kept separate from the UI contract: each answer has an observable cube fact.
 * Tests recompute these facts from sticker geometry, including the distractors. */
export type ActivityCriterion =
  | {type:"piece";colors:Face[]}
  | {type:"sticker";colors:Face[];color:Face}
  | {type:"home";colors:Face[]}
  | {type:"layer"}
  | {type:"edge-pattern"}
  | {type:"corner-count"}
  | {type:"headlights"}
  | {type:"edge-target";from:Face}
  | {type:"stage"}
  | {type:"f2l-relation";corner:Face[];edge:Face[]}
  | {type:"f2l-count"}
  | {type:"undo";before:string}
  | {type:"two-look";recordId:string};
export const ACTIVITY_CRITERIA: Record<string,ActivityCriterion> = {};
const sid = (face:Face)=>FACES.indexOf(face)*9;
const sides:Face[]=["F","R","B","L"];
const rotateChoices = (options:ActivityOption[],id:string) => {
  const offset=[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%options.length;
  return [...options.slice(offset),...options.slice(0,offset)];
};
const base = (id:string,kind:LessonActivity["kind"],item:Pick<LessonCase,"setup"|"algorithm">,question:string,hint:string,explanation:string) => ({
  id,kind,title:kind==="transfer"?"换个局面，再判断":kind==="predict"?"先预测，再播放":"先观察，自己判断",
  setup:item.setup,algorithm:item.algorithm,question,hint,explanation,
});
function choice(id:string,kind:LessonActivity["kind"],item:Pick<LessonCase,"setup"|"algorithm">,question:string,hint:string,explanation:string,answer:string,options:ActivityOption[],criterion:ActivityCriterion,focusPieces?:Face[][]):ChoiceActivity{
  ACTIVITY_CRITERIA[id]=criterion;
  return {...base(id,kind,item,question,hint,explanation),mode:"choice",answer,options:rotateChoices(options,id),focusPieces};
}
const pieceOptions = (target:Face[],id:string):ActivityOption[] => {
  const candidates=POSITIONS.filter(p=>p.filter(Boolean).length===target.length).map(p=>colorsAt(SOLVED,p));
  candidates.sort((a,b)=>b.filter(c=>target.includes(c)).length-a.filter(c=>target.includes(c)).length);
  const selected=[target,...candidates.filter(p=>colorKey(p)!==colorKey(target)).slice(0,3)];
  return rotateChoices(selected.map(colors=>({id:`piece:${colorKey(colors)}`,label:`${colorLabel(colors)}${colors.length===3?"角":"棱"}`})),id);
};
function pick(id:string,kind:LessonActivity["kind"],item:LessonCase,colors:Face[],question:string,hint:string):PickPieceActivity{
  ACTIVITY_CRITERIA[id]={type:"piece",colors};
  const state=setupState(item);
  return {...base(id,kind,item,question,hint,`这是一整块${colorLabel(colors)}${colors.length===3?"角":"棱"}。转动后颜色身份不变；再用当前中心判断它的家。`),mode:"pick-piece",answerColors:colors,answerPosition:findPiece(state,colors),answer:`piece:${colorKey(colors)}`,focusPieces:[colors],options:pieceOptions(colors,id)};
}
function rotated(item:LessonCase,rotation:string):LessonCase{
  return {...item,setup:`${item.setup} ${rotation}`,algorithm:`${inverse(rotation)} ${item.algorithm} ${rotation}`};
}
function positionName([x,y,z]:Vec3):string{
  return `${z===1?"前":z===-1?"后":""}${x===1?"右":x===-1?"左":""}${y===-1?"下":y===1?"上":"中层"}${[x,y,z].filter(Boolean).length===3?"角位":"棱位"}`;
}
function home(id:string,kind:LessonActivity["kind"],item:LessonCase,colors:Face[]):ChoiceActivity{
  const state=setupState(item),answerPosition=homePosition(state,colors);
  const positions=POSITIONS.filter(p=>p[1]===answerPosition[1]&&p.filter(Boolean).length===colors.length);
  return choice(id,kind,item,`${colorLabel(colors)}${colors.length===3?"角":"棱"}的家在哪里？按当前中心色判断，不按它现在的位置猜。`,"把这块的每一种颜色分别找到同色中心；这些中心相交的位置就是它的家。",`当前中心决定它属于${positionName(answerPosition)}。整颗换向后方位名会变，颜色身份不会变。`,`home:${answerPosition.join()}`,positions.map(p=>({id:`home:${p.join()}`,label:positionName(p)})),{type:"home",colors},[colors]);
}
function whiteDirection(id:string,item:LessonCase,colors:Face[]):ChoiceActivity{
  const state=setupState(item),face=stickerFace(state,colors,"U");
  return choice(id,"transfer",item,`这次${colorLabel(colors)}${colors.length===3?"角":"棱"}的白色贴片朝哪一面？先认朝向，再选处理分支。`,"先找到整块，再只看属于它的白贴片；上面有其他白色并不代表这一块的白色朝上。",`这块的白贴片朝${FACE_NAMES[face]}。位置与朝向是两项不同条件；播放后跟踪同一块，检查它如何到达目标。`,`face:${face}`,FACES.map(f=>({id:`face:${f}`,label:`朝${FACE_NAMES[f]}`})),{type:"sticker",colors,color:"U"},[colors]);
}
function firstLayer(id:string,item:LessonCase):ChoiceActivity{
  const state=setupState(item),correct=SLOTS.filter(s=>s.position[1]===-1).every(s=>state[s.index]===center(state,s.face));
  return choice(id,"transfer",item,"底面已经一片白色，第一层就完成了吗？请同时看四个侧面的最下排。","一层包含底面以及四面的底排；还原需要侧面也接上各自中心。",correct?"这一次底面同色，而且四面底排都对应中心，第一层完整。":"这一次底面虽然同色，侧面底排却没有与中心对应，所以只是白面，不是完整第一层。",correct?"layer:yes":"layer:no",[{id:"layer:yes",label:"完成了：底面与四面底排都正确"},{id:"layer:no",label:"还没有：只完成白面不够"}],{type:"layer"});
}
function undo(id:string,kind:LessonActivity["kind"],move:string):ChoiceActivity{
  const before=LATE,item={setup:`${before} ${move}`,algorithm:inverse(move)};
  return choice(id,kind,item,`这颗魔方刚刚只多转了一次 ${move.replaceAll("'","′")}。哪一步能精确回到误转前？`,"撤销要选同一层的反方向；半圈的逆动作仍是半圈。不要再加别的补救。",`用 ${inverse(move).replaceAll("'","′")} 撤销后会回到刚才的前两层检查点，顶层仍待继续。撤销不是整颗魔方的通用还原。`,`undo:${inverse(move)}`,[move,inverse(move),"U2","F'","R2"].filter((a,i,list)=>list.indexOf(a)===i).map(a=>({id:`undo:${a}`,label:a.replaceAll("'","′")})),{type:"undo",before});
}
function edgePattern(state:string):string{
  const visible=[1,3,5,7].filter(i=>state[i]===center(state,"U"));
  if(visible.length===4)return "ready";
  if(visible.length===0)return "dot";
  return visible[0]+visible[1]===8?"line":"elbow";
}
function yellowEdges(id:string,kind:LessonActivity["kind"],item:LessonCase):ChoiceActivity{
  const pattern=edgePattern(setupState(item)),names={ready:"已经成十字",dot:"点",line:"横线",elbow:"折角"};
  return choice(id,kind,item,"只看四条黄棱，当前属于哪种形态？黄角暂时不要计入。","四条棱在顶面四条边的中间。两个相对是横线，两个相邻是折角；四条都黄就跳过翻棱。",`当前是${names[pattern as keyof typeof names]}。${pattern==="ready"?"不再执行翻棱公式，继续判断黄角。":"先按对应公式的拿法摆位，再执行并检查前两层。"}`,`edge-pattern:${pattern}`,Object.entries(names).map(([value,label])=>({id:`edge-pattern:${value}`,label})),{type:"edge-pattern"});
}
function yellowCorners(id:string,kind:LessonActivity["kind"],item:LessonCase):ChoiceActivity{
  const state=setupState(item),count=[0,2,6,8].filter(i=>state[i]==="D").length;
  return choice(id,kind,item,"四个黄角中，有几个的黄色贴片已经朝上？只数角，不数黄中心或黄棱。","角在顶面四个拐角。黄色在侧面不算朝上；先确定哪些要跳过，哪些要处理。",`有 ${count} 个黄角朝上。${count===4?"黄面朝向已完成，下一步检查侧面顶角位置。":"实物逐角处理时需要依据每个角的实际朝向，不能照抄示例的重复次数。"}`,`corner-count:${count}`,[0,1,2,3,4].map(n=>({id:`corner-count:${n}`,label:`${n} 个`})),{type:"corner-count"});
}
function headlights(id:string,kind:LessonActivity["kind"],item:LessonCase):ChoiceActivity{
  const state=setupState(item),count=sides.filter(f=>state[sid(f)]===state[sid(f)+2]).length;
  return choice(id,kind,item,"绕四个侧面观察，有几面出现顶排两角同色的“角对”？中间那条顶棱先忽略。","同色角对不要求立刻等于该面中心色。先比较左上角与右上角，再考虑顶层对齐。",`这里有 ${count} 面同色角对。${count===4?"角的相互位置已正确，可以用顶层调整对齐中心；不要再盲做换角。":count===1?"已有可用参照，按本课公式指定的位置摆放这个角对。":"没有同色角对，需使用相应的无角对分支，再重新检查。"}`,`headlights:${count}`,[0,1,2,4].map(n=>({id:`headlights:${n}`,label:`${n} 面`})),{type:"headlights"});
}
function edgeTarget(id:string,kind:LessonActivity["kind"],item:LessonCase,from:Face="F"):ChoiceActivity{
  const state=setupState(item),color=state[sid(from)+1] as Face,target=sides.find(f=>center(state,f)===color)!;
  return choice(id,kind,item,`当前${FACE_NAMES[from]}上棱的侧色应去哪个面？先读取它的颜色，再找同色中心。`,"看的是侧面最上排中间一格，不是黄色贴片，也不是左右两个角。",`这条棱的侧色是${COLOR_NAMES[color]}，应去${FACE_NAMES[target]}面。${target===from?"它已经在自己的位置，可以作为摆位参照。":"去向比背诵顺逆时针更可靠；先确认其他前置条件，再选循环方向。"}`,`edge-target:${target}`,sides.map(f=>({id:`edge-target:${f}`,label:`${FACE_NAMES[f]}面${f===from?"（留在原位）":""}`})),{type:"edge-target",from});
}
const stageLabels:Record<string,string>={daisy:"先找白棱、收小花",cross:"按侧色完成白十字",first:"完成第一层白角",middle:"完成第二层棱",yellowCross:"形成黄十字",yellowFace:"完成黄面朝向",yellowCorners:"检查顶角位置与对齐",yellowEdges:"处理顶棱位置",solved:"六面已还原"};
function stateStage(state:string):string{
  const check=(fn:(p:Vec3)=>boolean)=>SLOTS.filter(s=>fn(s.position)).every(s=>state[s.index]===center(state,s.face));
  if(!check(p=>p[1]===-1&&p.filter(Boolean).length===2))return [1,3,5,7].every(i=>state[i]==="U")?"cross":"daisy";
  if(!check(p=>p[1]===-1))return "first";
  if(!check(p=>p[1]<1))return "middle";
  if(![1,3,5,7].every(i=>state[i]==="D"))return "yellowCross";
  if(![0,2,6,8].every(i=>state[i]==="D"))return "yellowFace";
  if(!check(p=>p[1]===1&&p.filter(Boolean).length===3))return "yellowCorners";
  return check(()=>true)?"solved":"yellowEdges";
}
function stage(id:string,kind:LessonActivity["kind"],item:LessonCase):ChoiceActivity{
  const answer=stateStage(setupState(item));
  return choice(id,kind,item,"如果不知道此前的动作，只按当前局面逐层检查，现在应该从哪一步继续？","从白十字开始检查，找到最早一个未通过的阶段。局面里出现黄色，并不说明前两层已经完成。",`最早需要继续处理的是“${stageLabels[answer]}”。屏幕演示只解决当前例子的一个目标；完成后要再次按检查点观察。`,`stage:${answer}`,Object.entries(stageLabels).map(([value,label])=>({id:`stage:${value}`,label})),{type:"stage"});
}
const relationLabels:Record<string,string>={paired:"上层已正确配对，可按摆位整对插入",adjacent:"只是相邻，先改变错误连接",separated:"都在上层但分开，先比较与空槽的关系",whiteUp:"白角朝上，先转换关系再插入",cornerIn:"角卡在底层，先取出再判断",edgeIn:"棱留在中层，先取出参与配对",bothIn:"角棱都在槽内，检查错误连接并取出",solved:"这一对已经归位，寻找下一对"};
function pairRelation(state:string,corner:Face[],edge:Face[]):string{
  const cp=findPiece(state,corner),ep=findPiece(state,edge);
  if(solvedPosition(state,cp)&&solvedPosition(state,ep))return "solved";
  if(cp[1]===-1&&ep[1]===0)return "bothIn";
  if(cp[1]===-1)return "cornerIn";
  if(ep[1]===0)return "edgeIn";
  if(stickerFace(state,corner,"U")==="U")return "whiteUp";
  const shared=slotsAt(cp).filter(s=>s.face!=="U").find(s=>slotsAt(ep).some(other=>other.face===s.face));
  const adjacent=cp.reduce((n,v,i)=>n+Math.abs(v-ep[i]),0)===1;
  if(!adjacent)return "separated";
  if(shared){const es=slotsAt(ep).find(s=>s.face===shared.face)!;if(state[shared.index]===state[es.index])return "paired";}
  return "adjacent";
}
function relation(id:string,kind:LessonActivity["kind"],item:LessonCase,corner:Face[],edge:Face[]):ChoiceActivity{
  const answer=pairRelation(setupState(item),corner,edge);
  return choice(id,kind,item,`找到${colorLabel(corner)}角与${colorLabel(edge)}棱后，哪一句最符合它们当前的关系？`,"先看角、棱分别在上层还是槽内，再看白色方向。两块相邻时，还要比较相接那一侧的颜色。",`${relationLabels[answer]}。这只是第一层判断；接下来还要检查目标槽与具体摆位，不能把同一类别视为唯一固定公式。`,`relation:${answer}`,Object.entries(relationLabels).map(([value,label])=>({id:`relation:${value}`,label})),{type:"f2l-relation",corner,edge},[corner,edge]);
}
function completedPairs(id:string,kind:LessonActivity["kind"],item:LessonCase):ChoiceActivity{
  const state=setupState(item),count=[[-1,-1],[-1,1],[1,-1],[1,1]].filter(([x,z])=>solvedPosition(state,[x,-1,z])&&solvedPosition(state,[x,0,z])).length;
  return choice(id,kind,item,"这次有几个完整的角棱槽已经归位？一个槽必须同时检查底角和中层棱。","先绕四个槽观察。白角正确但对应棱错误，或棱正确但角扭着，都不能算完成一对。",`当前完成 ${count} 对。接下来把注意力留给未完成的槽；已经完成的槽应受保护。`,`f2l-count:${count}`,[0,1,2,3,4].map(n=>({id:`f2l-count:${n}`,label:`${n} 对`})),{type:"f2l-count"});
}
function afterSegment(item:LessonCase,index:number):LessonCase{
  const moves=parseAlgorithm(item.algorithm).map(m=>m.notation),end=item.steps[index].end;
  return {...item,setup:`${item.setup} ${moves.slice(0,end).join(" ")}`,algorithm:moves.slice(end).join(" ")};
}
function targetPair(item:LessonCase):[Face[],Face[]]{
  const corner=item.focusPieces?.find(p=>p.length===3&&p.includes("U"))??["U","F","L"];
  const edge=corner.filter(c=>c!=="U");
  return [corner,edge];
}
function f2lActivities(lesson:CourseLesson,item:LessonCase,prefix:string):LessonActivity[]{
  const [corner,edge]=targetPair(item),index=lesson.cases.indexOf(item);
  if(lesson.id==="f2l-full-example")return [
    pick(`${prefix}/recognize`,"recognize",item,edge,`先找到${colorLabel(corner)}角，再点选应与它一起归位的棱。`,"角的白色之外还有两种颜色，用这两色去找棱；不要按距离最近来配。"),
    completedPairs(`${prefix}/transfer-a`,"transfer",afterSegment(item,0)),
    completedPairs(`${prefix}/transfer-b`,"transfer",afterSegment(item,1)),
  ];
  const other=lesson.cases[(index+1)%lesson.cases.length],otherPair=targetPair(other);
  return [
    pick(`${prefix}/recognize`,"recognize",item,edge,`先找到${colorLabel(corner)}角，再点选应与它一起归位的棱。`,"同一槽的棱只包含这个白角的另外两种颜色；位置相邻与否不影响身份。"),
    relation(`${prefix}/transfer-a`,"transfer",other,otherPair[0],otherPair[1]),
    home(`${prefix}/transfer-b`,"transfer",rotated(item,"y"),corner),
  ];
}
function twoLookActivities(item:LessonCase,prefix:string):LessonActivity[]{
  const record=TWO_LOOK_RECORDS.find(r=>r.id===item.id)!;
  const group=TWO_LOOK_RECORDS.filter(r=>r.stage===record.stage),index=group.indexOf(record);
  return [0,1,2].map((i)=>{
    const chosen=group[(index+i)%group.length];
    const fixture=i===0?item:TWO_LOOK_FIXTURES[chosen.id][i-1];
    const options=group.map(r=>({id:`two-look:${r.id}`,label:r.name}));
    const question=record.stage==="oll-edges"?"只看四条黄棱，这个新局面应选哪一种处理？"
      :record.stage==="oll-corners"?"黄十字已经完成。比较朝上的黄角与侧面的黄色方向，这是什么情形？"
      :record.stage==="pll-corners"?"黄面已经完成。看完四面的同色角对后，应选哪种换角？"
      :"顶角已经对齐。按照顶棱的颜色去向，这次应选哪一种换棱？";
    return choice(`${prefix}/${i===0?"recognize":`transfer-${i===1?"a":"b"}`}`,i===0?"recognize":"transfer",fixture,question,
      record.stage==="oll-edges"?"只数棱，不计角；两条黄色是否相邻很关键。":record.stage==="oll-corners"?"先数朝上的黄角，再看侧面黄色朝向。仅凭黄角数量不能区分全部七种。":record.stage==="pll-corners"?"每面只比较顶排两个角，中间的顶棱暂时忽略。":"先找正确顶棱；若只有一条正确，整颗换向把它放后面，再读前棱应去左还是右。",
      `${chosen.name}：${chosen.recognition} ${chosen.orientation}`,`two-look:${chosen.id}`,options,{type:"two-look",recordId:chosen.id});
  });
}

export function buildActivities(lesson:CourseLesson,item:LessonCase):LessonActivity[]{
  const prefix=`${lesson.id}/${item.id}`,index=lesson.cases.indexOf(item);
  const next=lesson.cases[(index+1)%lesson.cases.length],third=lesson.cases[(index+2)%lesson.cases.length];
  const a=rotated(next,"y"),b=rotated(third,"y2");
  const target=item.focusPieces?.[0]??["U","F"];
  if(lesson.id.startsWith("two-look-"))return twoLookActivities(item,prefix);
  if(lesson.id.startsWith("f2l-")||(lesson.id==="smoother-turns"&&item.id!=="finger-rhythm"))return f2lActivities(lesson,item,prefix);
  switch(lesson.id){
    case "meet-the-cube":return [
      pick(`${prefix}/recognize`,"recognize",item,["U","F"],"请在魔方上找出白绿棱。它应有几种颜色、属于哪一种整块？","棱有两色，角有三色；不能把一个角的两张贴片当成一条棱。"),
      firstLayer(`${prefix}/transfer-a`,{...item,setup:`${LATE} D`,algorithm:"D'"}),
      firstLayer(`${prefix}/transfer-b`,{...item,setup:`${LATE} y`,algorithm:""}),
    ];
    case "read-a-turn":return [undo(`${prefix}/recognize`,"predict",index===0?"R":"U"),undo(`${prefix}/transfer-a`,"transfer","U2"),undo(`${prefix}/transfer-b`,"transfer","F'")];
    case "white-daisy":case "first-layer":return [
      pick(`${prefix}/recognize`,"recognize",item,target,`先找出本例要处理的${colorLabel(target)}${target.length===3?"角":"棱"}。先认整块，再看白色朝向。`,"颜色组合决定块的身份；可以绕着魔方看，颜色在背面也仍属于同一块。"),
      whiteDirection(`${prefix}/transfer-a`,a,next.focusPieces?.[0]??["U","F"]),whiteDirection(`${prefix}/transfer-b`,b,third.focusPieces?.[0]??["U","F"]),
    ];
    case "white-cross":case "middle-layer":return [
      pick(`${prefix}/recognize`,"recognize",item,target,`找出本例的${colorLabel(target)}棱。它对应哪两个中心？`,"找到两种颜色都匹配的同一条棱，不要选只匹配一种颜色的相邻块。"),
      home(`${prefix}/transfer-a`,"transfer",a,next.focusPieces?.[0]??["U","F"]),home(`${prefix}/transfer-b`,"transfer",b,third.focusPieces?.[0]??["U","F"]),
    ];
    case "yellow-cross":return [yellowEdges(`${prefix}/recognize`,"recognize",item),yellowEdges(`${prefix}/transfer-a`,"transfer",a),yellowEdges(`${prefix}/transfer-b`,"transfer",b)];
    case "yellow-face":return [yellowCorners(`${prefix}/recognize`,"recognize",item),yellowCorners(`${prefix}/transfer-a`,"transfer",a),yellowCorners(`${prefix}/transfer-b`,"transfer",b)];
    case "yellow-corners":return [headlights(`${prefix}/recognize`,"recognize",item),headlights(`${prefix}/transfer-a`,"transfer",a),headlights(`${prefix}/transfer-b`,"transfer",b)];
    case "yellow-edges":return [edgeTarget(`${prefix}/recognize`,"recognize",item),edgeTarget(`${prefix}/transfer-a`,"transfer",a),edgeTarget(`${prefix}/transfer-b`,"transfer",b)];
    case "solve-on-your-own":return [item.id==="independent-known-mistake"?undo(`${prefix}/recognize`,"predict","R"):stage(`${prefix}/recognize`,"recognize",item),stage(`${prefix}/transfer-a`,"transfer",a),stage(`${prefix}/transfer-b`,"transfer",b)];
    case "smoother-turns":return [completedPairs(`${prefix}/recognize`,"recognize",item),completedPairs(`${prefix}/transfer-a`,"transfer",afterSegment(item,0)),completedPairs(`${prefix}/transfer-b`,"transfer",{...item,setup:`${item.setup} ${item.algorithm}`,algorithm:""})];
    default:throw new Error(`No teaching activities for ${lesson.id}`);
  }
}
