import{Quaternion,Vector3}from'three';import{createApprovedProgram as baseline}from'../wuji-exhibition-u5-r3/program';
import{clonePose,fingerContacts,fingerLibrary,handPose,rotatedFingerPose,type ContactData}from'../scene/finger-data';
import{smooth}from'../scene/motion';import type{FingerProgram,FingerSegment}from'../scene/finger-program';
import{extendedWideHandoff}from'./extended-wide-handoff';import raw from'../../art/wuji-teaching/wide-right-grip-calibration.json';

/** Two original r-prime steps retain their common grip at90 degrees.
 * Each still has its own step/state/angle and can be paused or sought. */
export function createRetainedWidePairProgram(id:string):FingerProgram{
 const old=baseline(id);if(id!=='gan-oll-18')return old;
 const first=old.segments.findIndex(s=>s.index===7&&s.stage==='TURN'),second=old.segments.findIndex(s=>s.index===8&&s.stage==='TURN');
 if(first<0||second<0||old.steps[7].move.notation!=="r'"||old.steps[8].move.notation!=="r'")throw new Error('Original two-quarter sequence changed');
 const exitStart=second+1;let exitEnd=exitStart;while(exitEnd+1<old.segments.length&&old.segments[exitEnd+1].index===9&&old.segments[exitEnd+1].active==='right'&&old.segments[exitEnd+1].stage==='TRANSFER')exitEnd++;
 const X=new Vector3(1,0,0),grip=handPose(raw.pose),pose=(angle:number)=>rotatedFingerPose(grip,new Quaternion().setFromAxisAngle(X,angle)),left=clonePose(old.segments[first].sample(1).left),support=old.segments[first].sample(1).contacts.filter(c=>c.side==='left'),drive=fingerContacts('right',raw.contacts as ContactData[],'drive'),target=old.segments[exitEnd].sample(1).right;
 const targetPad=fingerLibrary.hands.right.contacts.find(c=>c.finger===1)!,firstDelta=Math.PI/2;
 const exit=extendedWideHandoff('right',pose(Math.PI/2),target,drive.find(c=>c.finger===1)!.padOffset,new Vector3().fromArray(targetPad.padOffset),new Vector3(0,-1,0),new Vector3().fromArray(targetPad.normal),1);
 const segments:FingerSegment[]=[],refs:((p:number)=>number)[]=[];let duration=0;
 const add=(s:FingerSegment,ref:(p:number)=>number)=>{segments.push({...s,start:duration});refs.push(ref);duration+=s.duration;};
 for(let i=0;i<old.segments.length;i++){
  const s=old.segments[i];add(s,p=>s.start+s.duration*p);
  if(i!==first)continue;
  add({index:7,start:0,duration:.10,stage:'HOLD',phase:'持续宽层 · 第一r′90°停稳 · 保留原握',active:'right',sample:()=>({left:clonePose(left),right:pose(0),angle:firstDelta,contacts:[...support,...fingerContacts('right',raw.contacts as ContactData[],'support')]})},()=>s.start+s.duration);
  add({index:8,start:0,duration:.12,stage:'CONTACT',phase:'持续宽层 · 第二r′独立原步 · 保持两层握持',active:'right',sample:()=>({left:clonePose(left),right:pose(0),angle:0,contacts:[...support,...drive]})},()=>old.segments[second].start);
  add({index:8,start:0,duration:1.65,stage:'TURN',phase:'持续宽层 · 第二r′同向90° · 不重新抓握',active:'right',sample:p=>({left:clonePose(left),right:pose(Math.PI/2*smooth(p)),angle:Math.PI/2*smooth(p),contacts:[...support,...drive]})},p=>old.segments[second].start+old.segments[second].duration*p);
  for(const part of exit)add({index:9,start:0,duration:part.duration,stage:'TRANSFER',phase:'持续宽层 · 双步后必要接稳 · '+part.phase,active:'right',sample:p=>({left:clonePose(left),right:part.sample(p),angle:0,contacts:support})},()=>old.segments[exitStart].start);
  i=exitEnd;
 }
 const steps=old.steps.map((s,index)=>{const parts=segments.filter(p=>p.index===index);return{...s,start:parts[0].start,duration:parts.reduce((a,p)=>a+p.duration,0)};});
 return{...old,duration,cost:duration,segments,steps,sample(t){if(t>=duration)return old.sample(old.duration);const i=segments.findIndex(s=>t<s.start+s.duration),s=segments[i],progress=Math.max(0,Math.min(1,(t-s.start)/s.duration)),f=s.sample(progress),ref=old.sample(refs[i](progress));return{...ref,...f,index:s.index,complete:false,stage:s.stage,phase:s.phase,active:s.active,activeFinger:s.finger,support:s.active==='left'?'right':'left',progress};}};
}
