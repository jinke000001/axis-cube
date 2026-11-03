import { describe, expect, it } from "vitest";
import { applyAlgorithm, applyMove, FACES, normalizeColors, parseAlgorithm, SLOTS, SOLVED, validateFacelets } from "../core/cube.ts";
import type { Face } from "../core/cube.ts";
import { ACADEMY_LESSONS, getAcademyLesson, getLessonActivities, isPickPieceActivity, LEARNING_TRACKS } from "./academy.ts";
import { LESSONS } from "./curriculum.ts";
import { ACTIVITY_CRITERIA } from "./academy-data/activities.ts";
import { F2L_LESSONS } from "./academy-data/f2l.ts";
import { TWO_LOOK_LESSONS, TWO_LOOK_RECORDS } from "./academy-data/last-layer.ts";
import { TWO_LOOK_FIXTURES } from "./academy-data/two-look-fixtures.ts";
import { getCFOPCase } from "./cfop-library.ts";

const cases=ACADEMY_LESSONS.flatMap(lesson=>lesson.cases);
const newCases=[...F2L_LESSONS,...TWO_LOOK_LESSONS].flatMap(lesson=>lesson.cases);
const activities=ACADEMY_LESSONS.flatMap(lesson=>lesson.cases.flatMap(item=>getLessonActivities(lesson.id,item.id)));
const at=(p:readonly number[])=>SLOTS.filter(s=>s.position.every((v,i)=>v===p[i]));
const c=(state:string,face:Face)=>state[FACES.indexOf(face)*9+4];
const key=(colors:readonly string[])=>[...colors].sort().join("");
const colors=(state:string,p:readonly number[])=>key(at(p).map(s=>state[s.index]));
const positions=[...new Set(SLOTS.map(s=>s.position.join()))].map(p=>p.split(",").map(Number));
const positionOf=(state:string,piece:readonly Face[])=>positions.find(p=>colors(state,p)===key(piece))!;
const home=(state:string,p:readonly number[])=>at(p).every(s=>state[s.index]===c(state,s.face));
const correct=(state:string,predicate:(p:readonly number[])=>boolean)=>SLOTS.filter(s=>predicate(s.position)).every(s=>state[s.index]===c(state,s.face));
const size=(p:readonly number[])=>p.filter(Boolean).length;
const cross=(state:string)=>correct(state,p=>p[1]===-1&&size(p)===2);
const f2l=(state:string)=>correct(state,p=>p[1]<1);
const upperFace=(state:string)=>state.slice(0,9).split("").every(v=>v===c(state,"U"));
const corners=(state:string)=>correct(state,p=>p[1]===1&&size(p)===3);
const solved=(state:string)=>correct(state,()=>true);
const topEdges=(state:string)=>[1,3,5,7].filter(i=>state[i]===c(state,"U"));
const sideFaces:Face[]=["F","R","B","L"];
const cornerPairs=(state:string)=>sideFaces.filter(face=>{const i=FACES.indexOf(face)*9;return state[i]===state[i+2];});
const start=(item:{setup:string})=>applyAlgorithm(SOLVED,item.setup);
const legal=(state:string)=>validateFacelets(normalizeColors(state).facelets).valid;
const slotCount=(state:string)=>[-1,1].flatMap(x=>[-1,1].map(z=>home(state,[x,-1,z])&&home(state,[x,0,z]))).filter(Boolean).length;

// Literal masks describe the public 2-look shapes independently of the
// algorithms. Only yellow corner stickers count; U rotations are equivalent.
const cornerMasks:Record<string,{top:number[];side:Partial<Record<Face,number[]>>}>={
  "two-oll-h":{top:[],side:{R:[0,2],L:[0,2]}},
  "two-oll-pi":{top:[],side:{F:[2],B:[0],L:[0,2]}},
  "two-oll-u":{top:[0,2],side:{F:[0,2]}},
  "two-oll-t":{top:[2,8],side:{F:[0],B:[2]}},
  "two-oll-l":{top:[0,8],side:{F:[0],R:[2]}},
  "two-oll-antisune":{top:[2],side:{F:[0],R:[0],L:[0]}},
  "two-oll-sune":{top:[6],side:{F:[2],R:[2],B:[2]}},
};
const yellowCornerIndexes=(state:string)=>SLOTS.filter(s=>s.position[1]===1&&size(s.position)===3&&state[s.index]==="D").map(s=>s.index).sort((a,b)=>a-b).join();
function recognizeTwoLook(state:string,stage:string):string{
  if(stage==="oll-edges"){
    const indexes=topEdges(state);
    if(indexes.length===0)return "two-oll-dot";
    if(indexes.length!==2)throw new Error("Exercise already has a yellow cross");
    return indexes.reduce((a,b)=>a+b,0)===8?"two-oll-line":"two-oll-elbow";
  }
  if(stage==="oll-corners"){
    expect(topEdges(state)).toHaveLength(4);
    const matches=Object.entries(cornerMasks).filter(([,mask])=>{
      const expected=[...mask.top,...Object.entries(mask.side).flatMap(([face,indexes])=>indexes!.map(i=>FACES.indexOf(face as Face)*9+i))].sort((a,b)=>a-b).join();
      return ["","U","U2","U'"].some(auf=>yellowCornerIndexes(applyAlgorithm(state,auf))===expected);
    });
    expect(matches,`yellow mask ${yellowCornerIndexes(state)}`).toHaveLength(1);
    return matches[0][0];
  }
  expect(upperFace(state)).toBe(true);
  if(stage==="pll-corners"){
    const count=cornerPairs(state).length;
    expect([0,1]).toContain(count);
    return count===1?"two-pll-headlights":"two-pll-diagonal";
  }
  expect(corners(state)).toBe(true);
  const destinations=sideFaces.map(face=>sideFaces.findIndex(target=>c(state,target)===state[FACES.indexOf(face)*9+1]));
  const fixed=destinations.map((to,from)=>to===from?from:-1).filter(n=>n!==-1);
  if(fixed.length===0)return destinations.every((to,from)=>to===(from+2)%4)?"two-pll-h":"two-pll-z";
  expect(fixed).toHaveLength(1);
  const front=(fixed[0]+2)%4;
  return destinations[front]===(front+1)%4?"two-pll-ua":"two-pll-ub";
}

describe("academy course contract",()=>{
  it("keeps all original lesson/case objects and adds six F2L plus 10+6 two-look cases",()=>{
    expect(ACADEMY_LESSONS).toHaveLength(20);
    LESSONS.forEach((lesson,i)=>expect(ACADEMY_LESSONS[i]).toBe(lesson));
    expect(F2L_LESSONS).toHaveLength(6);
    expect(TWO_LOOK_LESSONS.map(l=>l.cases.length)).toEqual([10,6]);
    expect(new Set(cases.map(item=>item.id)).size).toBe(cases.length);
    expect(LEARNING_TRACKS.flatMap(track=>track.lessonIds).sort()).toEqual(ACADEMY_LESSONS.map(l=>l.id).sort());
    expect(LEARNING_TRACKS[1].lessonIds).toEqual(["two-look-oll","two-look-pll"]);
    expect(getAcademyLesson("not-published")).toBeUndefined();
    expect(getLessonActivities("not-published","anything")).toEqual([]);
    expect(getLessonActivities("white-daisy","not-published")).toEqual([]);
    for(const lesson of ACADEMY_LESSONS){
      expect(getAcademyLesson(lesson.id)).toBe(lesson);
      expect(lesson.checklist.length).toBeGreaterThan(0);
      for(const item of lesson.cases){
        const practice=getLessonActivities(lesson.id,item.id);
        expect(practice).toHaveLength(3);
        expect(practice[0].kind).not.toBe("transfer");
        expect(practice.filter(a=>a.kind==="transfer")).toHaveLength(2);
        expect(start(practice[1]),item.id).not.toBe(start(practice[2]));
      }
    }
  });
  it("provides one unambiguous answer, readable fallback and feedback for every activity",()=>{
    expect(activities).toHaveLength(216);
    expect(new Set(activities.map(a=>a.id)).size).toBe(activities.length);
    for(const activity of activities){
      expect(activity.options.filter(o=>o.id===activity.answer),activity.id).toHaveLength(1);
      expect(new Set(activity.options.map(o=>o.id)).size).toBe(activity.options.length);
      expect(activity.hint.length).toBeGreaterThan(8);
      expect(activity.explanation.length).toBeGreaterThan(12);
      expect(ACTIVITY_CRITERIA[activity.id]).toBeDefined();
      if(isPickPieceActivity(activity)){
        expect(activity.options.length).toBeGreaterThanOrEqual(3);
        expect(activity.answer).toBe(`piece:${key(activity.answerColors)}`);
      }
    }
  });
});

describe("new demonstrations",()=>{
  it.each(newCases.map(item=>[item.id,item] as const))("%s is legal through every move and uses complete, increasing segment boundaries",(_id,item)=>{
    let state=start(item),previous=0;
    expect(legal(state)).toBe(true);
    for(const step of item.steps){expect(step.end).toBeGreaterThan(previous);previous=step.end;}
    expect(previous).toBe(parseAlgorithm(item.algorithm).length);
    for(const move of parseAlgorithm(item.algorithm)){state=applyMove(state,move);expect(legal(state),move.notation).toBe(true);}
  });
  const geometries:[string,number[],Face,number[]][]=[
    ["academy-f2l-ready",[1,1,1],"F",[1,1,0]],
    ["academy-f2l-false-pair",[1,1,1],"R",[1,1,0]],
    ["academy-f2l-open-slot",[1,1,1],"R",[0,1,-1]],
    ["academy-f2l-across",[1,1,1],"R",[-1,1,0]],
    ["academy-f2l-white-up-near",[1,1,1],"U",[1,1,0]],
    ["academy-f2l-white-up-far",[1,1,1],"U",[-1,1,0]],
    ["academy-f2l-trapped-corner",[1,-1,1],"F",[1,1,0]],
    ["academy-f2l-trapped-edge",[1,1,1],"U",[1,0,1]],
    ["academy-f2l-both-trapped",[1,-1,1],"F",[1,0,1]],
  ];
  const chartCases:[string,number][]=[
    ["academy-f2l-ready",31],["academy-f2l-false-pair",41],["academy-f2l-open-slot",40],
    ["academy-f2l-across",39],["academy-f2l-white-up-near",21],["academy-f2l-white-up-far",19],
    ["academy-f2l-trapped-corner",7],["academy-f2l-trapped-edge",12],["academy-f2l-both-trapped",4],
  ];
  it.each(chartCases)("%s matches independently sampled GAN chart %i stickers after the explicit color-frame mapping",(id,number)=>{
    const fixture=getCFOPCase(`gan-f2l-${String(number).padStart(2,"0")}`)!.recognitionFixture;
    if(fixture.kind!=="f2l")throw new Error("Expected F2L chart fixture");
    const state=start(cases.find(item=>item.id===id)!);
    // GAN's source chart: white down, blue front, red right.
    // Academy teaching: white down, green front, orange right.
    const palette:Record<string,string>={U:"U",B:"F",R:"L"};
    for(const face of ["U","F","R"] as const)for(let index=0;index<9;index++){
      const color=fixture[face][index];
      if(color!==".")expect(state[FACES.indexOf(face)*9+index],`${id}: ${face}${index}`).toBe(palette[color]);
    }
  });
  it.each(geometries)("%s matches independently stated positions and white orientation",(id,cornerPosition,whiteFace,edgePosition)=>{
    const item=cases.find(item=>item.id===id)!,state=start(item);
    expect(colors(state,cornerPosition)).toBe("FLU");
    expect(colors(state,edgePosition)).toBe("FL");
    expect(state[at(cornerPosition).find(slot=>slot.face===whiteFace)!.index]).toBe("U");
    expect(cross(state)).toBe(true);
    expect(slotCount(state)).toBe(3);
    const after=applyAlgorithm(state,item.algorithm);
    expect(f2l(after)).toBe(true);
    expect(solved(after)).toBe(false);
    for(const slot of SLOTS.filter(s=>s.position[1]<1&&!(s.position[0]===1&&s.position[2]===1))){
      expect(after[slot.index],`${id}: protected ${slot.index}`).toBe(state[slot.index]);
    }
  });
  it("teaches the color difference between a ready pair and merely adjacent pieces",()=>{
    const a=start(cases.find(c=>c.id==="academy-f2l-ready")!),b=start(cases.find(c=>c.id==="academy-f2l-false-pair")!);
    const cornerSticker=at([1,1,1]).find(s=>s.face==="R")!.index,edgeSticker=at([1,1,0]).find(s=>s.face==="R")!.index;
    expect(a[cornerSticker]).toBe(a[edgeSticker]);
    expect(b[cornerSticker]).not.toBe(b[edgeSticker]);
  });
  it("both white-up conversions reach the stated three-move insertion, while storing different pieces during the conversion",()=>{
    for(const id of ["academy-f2l-white-up-near","academy-f2l-white-up-far"]){
      const item=cases.find(item=>item.id===id)!;
      const prefix=parseAlgorithm(item.algorithm).slice(0,4),state=applyAlgorithm(start(item),prefix);
      expect(colors(state,[1,1,1])).toBe("FLU");
      expect(colors(state,[0,1,-1])).toBe("FL");
      expect(state[at([1,1,1]).find(slot=>slot.face==="R")!.index]).toBe("U");
      const afterFirst=applyMove(start(item),parseAlgorithm(item.algorithm)[0]);
      expect(positionOf(afterFirst,["U","F","L"])[1]).toBe(1);
      expect(positionOf(afterFirst,["F","L"])[1]).toBe(id.endsWith("near")?0:1);
    }
  });
  it.each([["fr",[1,-1,1]],["fl",[-1,-1,1]],["bl",[-1,-1,-1]],["br",[1,-1,-1]]] as const)("four-slot %s keeps the physical pair while moving its home to the work position",(name,homePosition)=>{
    const item=cases.find(c=>c.id===`academy-f2l-slot-${name}`)!,before=start(item),after=applyAlgorithm(before,item.algorithm);
    expect(cross(before)).toBe(true);
    expect(slotCount(before)).toBe(3);
    expect(colors(after,homePosition)).toBe(key(item.focusPieces![0]));
    expect(f2l(after)).toBe(true);
    const [x,,z]=homePosition;
    for(const s of SLOTS.filter(s=>s.position[1]<1&&!(s.position[0]===x&&s.position[2]===z)))expect(before[s.index]).toBe(after[s.index]);
  });
  it.each(["academy-f2l-full-a","academy-f2l-full-b"])("%s genuinely goes from four open slots to one, two, three, four completed pairs",id=>{
    const item=cases.find(c=>c.id===id)!;let state=start(item),offset=0;
    expect(cross(state)).toBe(true);
    expect(slotCount(state)).toBe(0);
    const moves=parseAlgorithm(item.algorithm);
    for(const [index,step] of item.steps.entries()){
      const previous=state;
      state=applyAlgorithm(state,moves.slice(offset,step.end));offset=step.end;
      expect(cross(state)).toBe(true);
      expect(slotCount(state)).toBe(index+1);
      for(const x of [-1,1])for(const z of [-1,1])if(home(previous,[x,-1,z])&&home(previous,[x,0,z])){
        expect(home(state,[x,-1,z])&&home(state,[x,0,z])).toBe(true);
      }
    }
    expect(f2l(state)).toBe(true);expect(solved(state)).toBe(false);
  });
  it.each(TWO_LOOK_RECORDS.map(r=>[r.id,r] as const))("%s has the published shape and preserves the correct teaching preconditions",(id,record)=>{
    const item=cases.find(c=>c.id===id)!,before=start(item),after=applyAlgorithm(before,item.algorithm);
    expect(f2l(before)).toBe(true);expect(f2l(after)).toBe(true);
    expect(recognizeTwoLook(before,record.stage)).toBe(id);
    if(record.stage==="oll-edges") {expect(topEdges(after)).toHaveLength(4);expect(upperFace(after)).toBe(false);}
    if(record.stage==="oll-corners") {expect(upperFace(after)).toBe(true);expect(solved(after)).toBe(false);}
    if(record.stage==="pll-corners") {expect(corners(after)).toBe(true);expect(solved(after)).toBe(false);}
    if(record.stage==="pll-edges") {expect(corners(before)).toBe(true);expect(solved(after)).toBe(true);}
  });
  it.each(TWO_LOOK_RECORDS.map(r=>[r.id,r] as const))("%s also works on two independent public trainer scrambles, not just its inverse",(id,record)=>{
    expect(TWO_LOOK_FIXTURES[id]).toHaveLength(2);
    for(const fixture of TWO_LOOK_FIXTURES[id]){
      expect(fixture.setup).toContain(fixture.sourceScramble);
      const before=start(fixture),after=applyAlgorithm(before,fixture.algorithm);
      expect(legal(before)).toBe(true);expect(legal(after)).toBe(true);
      expect(f2l(before)).toBe(true);expect(f2l(after)).toBe(true);
      expect(recognizeTwoLook(before,record.stage)).toBe(id);
      if(record.stage==="oll-edges")expect(topEdges(after)).toHaveLength(4);
      if(record.stage==="oll-corners")expect(upperFace(after)).toBe(true);
      if(record.stage==="pll-corners")expect(corners(after)).toBe(true);
      if(record.stage==="pll-edges")expect(solved(after)).toBe(true);
    }
  });
});

describe("answer correctness from actual sticker geometry",()=>{
  it.each(activities.map(a=>[a.id,a] as const))("%s has a legal, independently checkable correct answer",(_id,activity)=>{
    const state=start(activity),criterion=ACTIVITY_CRITERIA[activity.id];
    expect(legal(state)).toBe(true);expect(legal(applyAlgorithm(state,activity.algorithm))).toBe(true);
    let expected:string|undefined;
    switch(criterion.type){
      case "piece":{
        expect(isPickPieceActivity(activity)).toBe(true);
        if(!isPickPieceActivity(activity))throw new Error("Missing 3D pick contract");
        expect(colors(state,activity.answerPosition)).toBe(key(criterion.colors));
        expect(positions.filter(p=>colors(state,p)===key(criterion.colors))).toHaveLength(1);
        expected=`piece:${key(criterion.colors)}`;break;
      }
      case "sticker":{
        const slot=at(positionOf(state,criterion.colors)).find(s=>state[s.index]===criterion.color)!;
        expected=`face:${slot.face}`;break;
      }
      case "home":{
        const centerSlots=SLOTS.filter(s=>s.row===1&&s.col===1&&criterion.colors.includes(state[s.index] as Face));
        const p=[0,0,0].map((_,i)=>centerSlots.reduce((n,s)=>n+s.normal[i],0));expected=`home:${p.join()}`;break;
      }
      case "layer":expected=`layer:${correct(state,p=>p[1]===-1)?"yes":"no"}`;break;
      case "edge-pattern":{
        const indexes=topEdges(state);expected=`edge-pattern:${indexes.length===4?"ready":indexes.length===0?"dot":indexes.reduce((a,b)=>a+b,0)===8?"line":"elbow"}`;break;
      }
      case "corner-count":expected=`corner-count:${[0,2,6,8].filter(i=>state[i]==="D").length}`;break;
      case "headlights":expected=`headlights:${cornerPairs(state).length}`;break;
      case "edge-target":expected=`edge-target:${sideFaces.find(face=>c(state,face)===state[FACES.indexOf(criterion.from)*9+1])}`;break;
      case "stage":{
        const phase=!cross(state)?([1,3,5,7].every(i=>state[i]==="U")?"cross":"daisy"):
          !correct(state,p=>p[1]===-1)?"first":!f2l(state)?"middle":topEdges(state).length!==4?"yellowCross":!upperFace(state)?"yellowFace":!corners(state)?"yellowCorners":solved(state)?"solved":"yellowEdges";
        expected=`stage:${phase}`;break;
      }
      case "f2l-relation":{
        const cp=positionOf(state,criterion.corner),ep=positionOf(state,criterion.edge),white=at(cp).find(s=>state[s.index]==="U")!;
        let relation:string;
        if(home(state,cp)&&home(state,ep))relation="solved";
        else if(cp[1]===-1)relation=ep[1]===0?"bothIn":"cornerIn";
        else if(ep[1]===0)relation="edgeIn";
        else if(white.face==="U")relation="whiteUp";
        else if(cp.map((v,i)=>Math.abs(v-ep[i])).reduce((a,b)=>a+b,0)!==1)relation="separated";
        else{
          const common=at(cp).find(s=>s.face!=="U"&&at(ep).some(e=>e.face===s.face));
          const same=common&&state[common.index]===state[at(ep).find(s=>s.face===common.face)!.index];relation=same?"paired":"adjacent";
        }
        expected=`relation:${relation}`;break;
      }
      case "f2l-count":expected=`f2l-count:${slotCount(state)}`;break;
      case "undo":{
        const correctOptions=activity.options.filter(option=>applyAlgorithm(state,option.id.slice(5))===applyAlgorithm(SOLVED,criterion.before));
        expect(correctOptions).toHaveLength(1);expected=correctOptions[0].id;break;
      }
      case "two-look":{
        const record=TWO_LOOK_RECORDS.find(r=>r.id===criterion.recordId)!;
        expected=`two-look:${recognizeTwoLook(state,record.stage)}`;break;
      }
    }
    expect(activity.answer).toBe(expected);
  });
});
