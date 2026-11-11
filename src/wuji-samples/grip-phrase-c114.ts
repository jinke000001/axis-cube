import{Vector3}from'three';
import{NORMALS,moveAngle}from'../core/cube';
import{getFormula}from'../demonstrator/catalog';
import{blendFingerPose,clonePose,oppositeHand,fingerLibrary}from'../scene/finger-data';
import type{FingerContact}from'../scene/finger-contact';import type{FingerSegment}from'../scene/finger-program';
import{smooth,type HandPose,type Side}from'../scene/motion';
import{g1Pose,g1Contacts}from'./grip-poses-c114';import{assembleC114,nativeC114,type C114Instruction}from'./grip-native-c114';
import{gripHandoffC114,type GripGuide}from'./grip-handoff-c114';
import{contextLoadedC114,contextSupportC114}from'./grip-context-c114';
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-8);
export const C114_FIRST_IDS=['gan-f2l-40','gan-f2l-18','gan-f2l-19','gan-f2l-21','gan-f2l-22']as const;
type NativeFactory=typeof nativeC114;
export function compileGripC114(instructions:readonly C114Instruction[],options:{clearance?:number;handoffMode?:'guide'|'normal-arc';bow?:number;native?:NativeFactory}={}){
 if(!instructions.length)throw Error('C114 empty sequence not yet compiled');
 const factory=options.native??nativeC114,first=factory(instructions[0],undefined,{context:instructions[0].move.face==='R'}),initial=first.segments[0].sample(0),held={left:clonePose(initial.left),right:clonePose(initial.right)},low={left:g1Pose('left','support'),right:g1Pose('right','support')},cs:Record<Side,FingerContact[]>={left:initial.contacts.filter(c=>c.side==='left').map(c=>({...c,role:'support'})),right:initial.contacts.filter(c=>c.side==='right').map(c=>({...c,role:'support'}))};
 const standard=(side:Side):GripGuide=>({finger:2,pad:new Vector3().fromArray(fingerLibrary.hands[side].gripContacts.find(c=>c.finger===2)!.padOffset),normal:new Vector3(side==='right'?1:-1,0,0)}),guides={left:standard('left'),right:standard('right')};
 const parts:FingerSegment[]=[],wrist:Partial<Record<Side,number>>={};let index=0,regrips=0,retained=0,contextHeld=instructions[0].move.face==='R';
 function add(s:FingerSegment){parts.push({...s,index});const f=s.sample(1);held.left=clonePose(f.left);held.right=clonePose(f.right);}
 function transfer(side:Side,target:HandPose,toGuide=standard(side),toContacts:readonly FingerContact[]=[]){
  if(same(held[side],target))return;
  const other=oppositeHand(side),support=cs[other].slice();if(support.length<3)throw Error('C114 handoff needs three measured supports');
  const fixed=clonePose(held[other]),bridge=gripHandoffC114(side,held[side],target,cs[side],toContacts,guides[side],toGuide,options.clearance,options.handoffMode,options.bow);
  for(const part of bridge)add({index,start:0,duration:part.duration,stage:'TRANSFER',phase:'G1连接 · '+part.phase,active:side,sample:p=>({left:side==='left'?part.sample(p):clonePose(fixed),right:side==='right'?part.sample(p):clonePose(fixed),angle:0,contacts:support})});
  cs[side]=[];guides[side]=toGuide;delete wrist[side];if(side==='right')contextHeld=false;regrips++;
 }
 function localRight(target:ReturnType<typeof contextLoadedC114>,digit:1|2,releasing:boolean){
  if(same(held.right,target.pose)){cs.right=target.contacts;return;}
  const from=clonePose(held.right),fixed=clonePose(held.left),support=[...cs.left,...cs.right.filter(c=>c.finger!==digit)];
  if(support.length<3)throw Error('C114 contextual finger gait needs three unchanged supports');
  add({index,start:0,duration:.35,stage:releasing?'RELEASE':'PREPARE',phase:releasing?'G1上下文 · 保腕 · 单指法向释放':'G1上下文 · 保腕 · 单指重新接稳',active:'right',finger:digit,sample:p=>({left:clonePose(fixed),right:blendFingerPose(from,target.pose,smooth(p)),angle:0,contacts:support})});
  cs.right=target.contacts;
 }
 function home(side:Side){if(same(held[side],low[side])){cs[side]=g1Contacts(side,'support');return;}const other=oppositeHand(side);if(cs[other].length<3){if(cs[side].length<3)throw Error('C114 both hands unloaded');home(other);}transfer(side,low[side],standard(side),g1Contacts(side,'support'));cs[side]=g1Contacts(side,'support');}
 for(index=0;index<instructions.length;index++){
  const instruction=instructions[index],move=instruction.move;let before:number|undefined;
  const active:Side=instruction.hand??(instruction.finger===1?'right':move.face==='L'||move.face==='U'&&move.turns===3?'left':'right'),other=oppositeHand(active);
  let supportOverride:ReturnType<typeof contextSupportC114>;
  if(active==='left'&&move.face==='U'&&contextHeld&&wrist.right!==undefined){supportOverride=contextSupportC114(wrist.right);if(supportOverride)localRight(supportOverride,supportOverride.digit,true);}
  if(active==='right'&&move.face==='R'&&contextHeld&&wrist.right!==undefined){const target=contextLoadedC114(wrist.right),digit:1|2=Math.abs(wrist.right)<1e-7?2:1;localRight(target,digit,false);}
  if(['R','L'].includes(move.face)&&wrist[active]!==undefined&&Math.abs(wrist[active]!+moveAngle(move))<=Math.PI/2+1e-8)before=wrist[active];
  const native=factory(instruction,before,{context:!move.kind&&move.face==='R',support:supportOverride}),start=native.segments[0].sample(0),support=start.contacts.filter(c=>c.side===other&&c.role==='support');
  if(!same(held[other],start[other])){if(cs[active].length<3)home(active);transfer(other,start[other],standard(other),support);cs[other]=support;}else cs[other]=support;
  const turns=native.segments.filter(s=>s.stage==='TURN'),drive=turns[0].sample(0).contacts.find(c=>c.side===active&&c.role==='drive')!,wristMove=['R','L'].includes(move.face),nextGuide:GripGuide=wristMove?standard(active):{finger:drive.finger,pad:drive.padOffset.clone(),normal:drive.normal.clone()};
  transfer(active,start[active],nextGuide,start.contacts.filter(c=>c.side===active));
  if(move.face==='R'){contextHeld=true;if(before!==undefined)retained++;}
  for(const s of native.segments.filter(s=>s.stage!=='HOLD'))add(s);
  const last=native.segments.filter(s=>s.stage==='TURN').at(-1)!,f=last.sample(1),axis=new Vector3(...NORMALS[move.face]);
  if(['R','L'].includes(move.face)){
   cs[active]=f.contacts.filter(c=>c.side===active&&c.role==='drive').map(c=>({...c,role:'support',point:c.point.clone().applyAxisAngle(axis,f.angle),normal:c.normal.clone().applyAxisAngle(axis,f.angle)}));
   wrist[active]=(before??(move.turns===2?-Math.sign(moveAngle(move))*Math.PI/2:moveAngle(move)<0?0:-Math.PI/2))+moveAngle(move);
  }else{cs[active]=[];delete wrist[active];}
  const guideTurn=move.face==='U'&&move.turns===2?turns.find(s=>s.finger===2)!:last,guideFrame=guideTurn.sample(1),guide=guideFrame.contacts.find(c=>c.side===active&&c.role==='drive')!;
  guides[active]=wristMove?standard(active):{finger:guide.finger,pad:guide.padOffset.clone(),normal:guide.normal.clone().applyAxisAngle(axis,guideFrame.angle)};
  cs[other]=support;
 }
 index=instructions.length-1;const final={left:clonePose(held.left),right:clonePose(held.right),contacts:[...cs.left,...cs.right],angle:moveAngle(instructions.at(-1)!.move)};
 add({index,start:0,duration:.6,stage:'HOLD',phase:'G1 · 整式完成 · 保留末步握姿',active:null,sample:()=>({...final,left:clonePose(final.left),right:clonePose(final.right)})});
 const p=assembleC114(parts,instructions.map(s=>s.move));p.statistics.regrips=regrips;p.statistics.retainedWrists=retained;return p;
}
export function createGripPhraseC114(id:string,options:Parameters<typeof compileGripC114>[1]={}){
 if(!(C114_FIRST_IDS as readonly string[]).includes(id))throw Error('C114 formula migration pending: '+id);
 const f=getFormula(id)!;return compileGripC114(f.steps.map(s=>({move:s.move,hand:s.hint?.hand,finger:s.hint?.finger==='thumb'?1:s.hint?.finger==='index'?2:undefined})),options);
}
