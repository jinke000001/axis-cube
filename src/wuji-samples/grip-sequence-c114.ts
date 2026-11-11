import{Vector3}from'three';
import{NORMALS,moveAngle}from'../core/cube';
import{blendFingerPose,clonePose,oppositeHand,fingerLibrary}from'../scene/finger-data';
import type{FingerContact}from'../scene/finger-contact';import type{FingerSegment}from'../scene/finger-program';
import{smooth,type HandPose,type Side}from'../scene/motion';
import{g1Pose,g1Contacts}from'./grip-poses-c114';import{assembleC114,nativeC114,type C114Instruction}from'./grip-native-c114';
import{gripHandoffC114,type GripGuide}from'./grip-sequence-handoff-c114';
import{contextLoadedC114,contextSupportC114}from'./grip-context-c114';
import{hasMeasuredSupport}from'../scene/finger-contact';
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-8);
type NativeFactory=typeof nativeC114;
const bridgeCache=new Map<string,ReturnType<typeof gripHandoffC114>>(),sampleCache=new Map<string,FingerSegment['sample']>();
export function compileGripSequenceC114(instructions:readonly C114Instruction[],options:{clearance?:number;handoffMode?:'guide'|'normal-arc';bow?:number;native?:NativeFactory}={}){
 if(!instructions.length)throw Error('C114 empty sequence not yet compiled');
 const factory=options.native??nativeC114,first=factory(instructions[0],undefined,{context:!instructions[0].move.kind&&instructions[0].move.face==='R'}),initial=first.segments[0].sample(0),held={left:clonePose(initial.left),right:clonePose(initial.right)},low={left:g1Pose('left','support'),right:g1Pose('right','support')},cs:Record<Side,FingerContact[]>={left:initial.contacts.filter(c=>c.side==='left').map(c=>({...c,role:'support'})),right:initial.contacts.filter(c=>c.side==='right').map(c=>({...c,role:'support'}))};
 const standard=(side:Side):GripGuide=>({finger:2,pad:new Vector3().fromArray(fingerLibrary.hands[side].gripContacts.find(c=>c.finger===2)!.padOffset),normal:new Vector3(side==='right'?1:-1,0,0)}),guides={left:standard('left'),right:standard('right')};
 const parts:FingerSegment[]=[],wrist:Partial<Record<Side,number>>={};let index=0,regrips=0,retained=0,contextHeld=!instructions[0].move.kind&&instructions[0].move.face==='R';
 function add(s:FingerSegment){parts.push({...s,index});const f=s.sample(1);held.left=clonePose(f.left);held.right=clonePose(f.right);}
 function transfer(side:Side,target:HandPose,toGuide=standard(side),toContacts:readonly FingerContact[]=[]){
  if(same(held[side],target))return;
  const other=oppositeHand(side),support=cs[other].slice();if(support.length<3)throw Error('C114 handoff needs three measured supports');
  const fixed=clonePose(held[other]),key=JSON.stringify([side,held[side],target,cs[side],toContacts,guides[side],toGuide,options.clearance,options.handoffMode,options.bow]);
  let bridge=bridgeCache.get(key);if(!bridge){bridge=gripHandoffC114(side,held[side],target,cs[side],toContacts,guides[side],toGuide,options.clearance,options.handoffMode,options.bow);bridgeCache.set(key,bridge);}
  for(const[j,part]of bridge.entries()){const sampleKey=JSON.stringify([key,j,fixed,support]);let sample=sampleCache.get(sampleKey);if(!sample){sample=p=>({left:side==='left'?part.sample(p):clonePose(fixed),right:side==='right'?part.sample(p):clonePose(fixed),angle:0,contacts:support});sampleCache.set(sampleKey,sample);}add({index,start:0,duration:part.duration,stage:'TRANSFER',phase:'G1连接 · '+part.phase,active:side,sample});}
  cs[side]=[];guides[side]=toGuide;delete wrist[side];if(side==='right')contextHeld=false;regrips++;
 }
 function localRight(target:ReturnType<typeof contextLoadedC114>,digit:1|2,releasing:boolean){
  if(same(held.right,target.pose)){cs.right=target.contacts;return;}
  const from=clonePose(held.right),fixed=clonePose(held.left),support=[...cs.left,...cs.right.filter(c=>c.finger!==digit)];
  if(support.length<3)throw Error('C114 contextual finger gait needs three unchanged supports');
  const key=JSON.stringify(['local',from,target.pose,fixed,support,digit,releasing]);let sample=sampleCache.get(key);if(!sample){sample=p=>({left:clonePose(fixed),right:blendFingerPose(from,target.pose,smooth(p)),angle:0,contacts:support});sampleCache.set(key,sample);}
  add({index,start:0,duration:.35,stage:releasing?'RELEASE':'PREPARE',phase:releasing?'G1上下文 · 保腕 · 单指法向释放':'G1上下文 · 保腕 · 单指重新接稳',active:'right',finger:digit,sample});
  cs.right=target.contacts;
 }
 function home(side:Side){if(same(held[side],low[side])){cs[side]=g1Contacts(side,'support');return;}const other=oppositeHand(side);if(cs[other].length<3){if(cs[side].length<3)throw Error('C114 both hands unloaded');home(other);}transfer(side,low[side],standard(side),g1Contacts(side,'support'));cs[side]=g1Contacts(side,'support');}
 for(index=0;index<instructions.length;index++){
  const instruction=instructions[index],move=instruction.move;let before:number|undefined;
  const active:Side=instruction.hand??(instruction.finger===1?'right':move.face==='L'||move.face==='U'&&move.turns===3?'left':'right'),other=oppositeHand(active);
  let supportOverride:{pose:HandPose;contacts:FingerContact[]}|undefined;
  if(!move.kind&&active==='left'&&move.face==='U'&&contextHeld&&wrist.right!==undefined){const contextual=contextSupportC114(wrist.right);if(contextual){localRight(contextual,contextual.digit,true);supportOverride=contextual;}}
  if(!move.kind&&active==='right'&&move.face==='U'&&Math.abs((wrist.left??99)+Math.PI/2)<1e-7&&cs.left.length>=3){supportOverride={pose:clonePose(held.left),contacts:cs.left.slice()};}
  if(!move.kind&&active==='right'&&move.face==='R'&&contextHeld&&wrist.right!==undefined){const target=contextLoadedC114(wrist.right),digit:1|2=Math.abs(wrist.right)<1e-7?2:1;localRight(target,digit,false);}
  // Opposite outer layers leave this already held layer fixed. Keep its
  // measured grip instead of returning the whole supporting hand to low.
  if(!move.kind&&['R','L'].includes(move.face)&&wrist[other]!==undefined&&hasMeasuredSupport(held,cs[other],move,0)){
   if(other==='right'&&contextHeld){const angle=wrist.right!,target=contextLoadedC114(angle);localRight(target,Math.abs(angle)<1e-7?2:1,false);}
   supportOverride={pose:clonePose(held[other]),contacts:cs[other].slice()};retained++;
  }
  if(!move.kind&&['R','L'].includes(move.face)&&wrist[active]!==undefined&&Math.abs(wrist[active]!+moveAngle(move))<=Math.PI/2+1e-8)before=wrist[active];
  const native=factory(instruction,before,{context:!move.kind&&move.face==='R',support:supportOverride}),start=native.segments[0].sample(0),support=start.contacts.filter(c=>c.side===other&&(c.role==='support'||move.kind==='rotation')).map(c=>({...c,role:'support' as const}));
  if(!same(held[other],start[other])){if(cs[active].length<3)home(active);transfer(other,start[other],standard(other),support);cs[other]=support;}else cs[other]=support;
  const turns=native.segments.filter(s=>s.stage==='TURN'),drive=turns[0].sample(0).contacts.find(c=>c.side===active&&c.role==='drive')!,wristMove=!move.kind&&['R','L'].includes(move.face),loadedMove=turns.every(s=>!s.finger),nextGuide:GripGuide={finger:drive.finger,pad:drive.padOffset.clone(),normal:drive.normal.clone()};
  transfer(active,start[active],nextGuide,start.contacts.filter(c=>c.side===active));
  if(!move.kind&&move.face==='R'){contextHeld=true;if(before!==undefined)retained++;}
  for(const s of native.segments.filter(s=>s.stage!=='HOLD'))add(s);
  const last=native.segments.filter(s=>s.stage==='TURN').at(-1)!,f=last.sample(1),axis=new Vector3(...NORMALS[move.face]);
  if(loadedMove){
   cs[active]=f.contacts.filter(c=>c.side===active&&c.role==='drive').map(c=>({...c,role:'support',point:c.point.clone().applyAxisAngle(axis,f.angle),normal:c.normal.clone().applyAxisAngle(axis,f.angle)}));
   if(wristMove)wrist[active]=(before??(move.turns===2?-Math.sign(moveAngle(move))*Math.PI/2:moveAngle(move)<0?0:-Math.PI/2))+moveAngle(move);else delete wrist[active];
  }else{cs[active]=[];delete wrist[active];}
  const guideTurn=move.face==='U'&&move.turns===2?turns.find(s=>s.finger===2)!:last,guideFrame=guideTurn.sample(1),guide=guideFrame.contacts.find(c=>c.side===active&&c.role==='drive')!;
  guides[active]=wristMove?standard(active):{finger:guide.finger,pad:guide.padOffset.clone(),normal:guide.normal.clone().applyAxisAngle(axis,guideFrame.angle)};
  const endNative=native.segments.filter(s=>s.stage!=='HOLD').at(-1)!.sample(1);
  cs[other]=move.kind==='rotation'?f.contacts.filter(c=>c.side===other).map(c=>({...c,role:'support' as const,point:c.point.clone().applyAxisAngle(axis,f.angle),normal:c.normal.clone().applyAxisAngle(axis,f.angle)})):endNative.contacts.filter(c=>c.side===other&&c.role==='support');
  if(move.kind==='rotation'){contextHeld=false;delete wrist.left;delete wrist.right;}
 }
 index=instructions.length-1;const final={left:clonePose(held.left),right:clonePose(held.right),contacts:[...cs.left,...cs.right],angle:moveAngle(instructions.at(-1)!.move)};
 add({index,start:0,duration:.6,stage:'HOLD',phase:'G1 · 整式完成 · 保留末步握姿',active:null,sample:()=>({...final,left:clonePose(final.left),right:clonePose(final.right)})});
 const p=assembleC114(parts,instructions.map(s=>s.move));p.statistics.regrips=regrips;p.statistics.retainedWrists=retained;
 const geometryStateKey=JSON.stringify([held,cs,guides,wrist,contextHeld],(_key,value)=>typeof value==='number'?Math.round(value*1e10)/1e10:value);
 return Object.assign(p,{geometryStateKey});
}
