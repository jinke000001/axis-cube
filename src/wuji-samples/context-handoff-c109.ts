import{Quaternion,Vector3}from'three';
import{createApprovedProgram as baseline}from'../wuji-exhibition-u4-r2/program';
import{clonePose,blendFingerPose}from'../scene/finger-data';
import{smooth}from'../scene/motion';
import type{FingerProgram,FingerSegment}from'../scene/finger-program';
const CENTER=new Vector3(0,.34,0);
const reference=baseline('gan-f2l-40').segments;
const sameHand=(a:ReturnType<FingerSegment['sample']>['right'],b:ReturnType<FingerSegment['sample']>['right'])=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-8);
const canonical=(s:FingerSegment,which:4|9)=>sameHand(s.sample(0).right,reference[which].sample(0).right)&&sameHand(s.sample(1).right,reference[which].sample(1).right);
export const C109_OPTIONS={
 'ru-35':{ru:.015,m:0,d:0,back:false},
 'm-40':{ru:0,m:.04,d:0,back:false},
 'd-30':{ru:0,m:0,d:.03,back:false},
 'back-direct':{ru:0,m:0,d:0,back:true},
 'ru-40':{ru:.01,m:0,d:0,back:false},
 'return-chord20':{ru:0,m:0,d:0,back:false},
 'ru-prepared':{ru:.015,m:0,d:0,back:false},
 'return-prepared':{ru:0,m:0,d:0,back:false},
 'all3':{ru:0,m:.04,d:.03,back:true},
 'all2':{ru:.015,m:.04,d:.03,back:true},
 'all1':{ru:.01,m:.04,d:.03,back:true},
}as const;
export type C109Variant=keyof typeof C109_OPTIONS;
/** Only unloaded TRANSFERs change. Contacts, support hand, original move,
 * stroke, joints/limits and every boundary pose remain the accepted ones. */
export function createContextHandoffProgram(id:string,variant:C109Variant='all3'):FingerProgram{
 const old=baseline(id),option=C109_OPTIONS[variant],segments:FingerSegment[]=[];
 let time=0;
 for(let i=0;i<old.segments.length;i++){
  const original=old.segments[i];let segment=original;
  if(original.stage==='TRANSFER'&&original.active){
   const side=original.active,a=original.sample(0),next=old.segments[i+1];
   if(option.back&&side==='left'&&id==='gan-oll-47'&&next?.index===original.index&&next.stage==='TRANSFER'&&
    ((original.phase.includes('方外绕到后侧')&&next.phase.includes('方外转向静止前层'))||(original.phase.includes('方外转向静止前层')&&next.phase.includes('方外绕到后侧')))){
    const end=next.sample(1),rotation=end.left.quaternion.clone().multiply(a.left.quaternion.clone().invert()),v=a.left.position.clone().sub(CENTER);
    segment={...original,duration:next.start+next.duration-original.start,phase:'局部换握 · 另一手接稳 · 支撑手沿方外直接换面',sample:p=>{
     const q=new Quaternion().slerp(rotation,smooth(p)),pose=blendFingerPose(a.left,end.left,smooth(p));
     pose.position.copy(v).applyQuaternion(q).add(CENTER);pose.quaternion.copy(q).multiply(a.left.quaternion);
     return{...a,left:pose,right:clonePose(a.right)};
    }};i++;
   }else if(option.m&&side==='right'&&(id.includes('pll')||id==='gan-oll-12')){
    const kind=original.phase.includes('原握指沿侧面上移')?'up':original.phase.includes('全手网格包围')?'rotate':original.phase.includes('指尖在背侧离面预备')?'down':undefined;
    if(kind)segment={...original,phase:'局部换握 · 右手保持离面 · 上侧转腕',sample:p=>{
     const f=original.sample(p),pose=clonePose(f.right),weight=kind==='up'?smooth(p):kind==='down'?1-smooth(p):1;
     pose.position.y-=option.m*weight;return{...f,right:pose};
    }};
   }
   if(option.d&&side==='left'&&['gan-f2l-33','gan-pll-10','gan-pll-19'].includes(id)){
    const kind=original.phase.startsWith('方外离开指尖侧面')?'out':original.phase.startsWith('按实际全手包围在方外换腕')?'rotate':original.phase.startsWith('另一手接稳 · 从侧边进入离面预备')?'in':undefined;
    if(kind)segment={...original,phase:'局部换握 · 左手保持离面 · 近侧转腕',sample:p=>{
     const f=original.sample(p),pose=clonePose(f.left),weight=kind==='out'?smooth(p):kind==='in'?1-smooth(p):1;
     pose.position.x+=option.d*weight;return{...f,left:pose};
    }};
   }
   if(option.ru&&side==='right'&&original.phase.startsWith('指尖离面 · 沿方边连续换握')&&old.steps[original.index].move.notation==='U'&&canonical(original,4)){
    segment={...original,phase:'局部换握 · 指尖离面 · 沿方边连续接入U',sample:p=>{
     const f=original.sample(p),pose=clonePose(f.right),t=smooth(p),u=1-t;
     pose.position.add(new Vector3(-option.ru*3*u*u*t,0,option.ru*3*u*t*t));return{...f,right:pose};
    }};
   }
  }
  if(original.stage==='TRANSFER'&&original.active==='right'&&(['return-chord20','return-prepared','all1','all2','all3'].includes(variant))&&original.phase.startsWith('指尖离面 · 沿方边连续换握')&&original.phase.endsWith('左手接稳 · 右手接回右层')&&canonical(original,9)){
   const a=original.sample(0).right.position,b=original.sample(1).right.position;
   segment={...original,phase:'局部换握 · 右手保持离面 · 就近接回右层',sample:p=>{const f=original.sample(p),pose=clonePose(f.right);pose.position.lerp(a.clone().lerp(b,smooth(p)),.2);return{...f,right:pose};}};
  }
  if(segment.phase.startsWith('局部换握')&&['ru-prepared','return-prepared','all2','all3'].includes(variant)&&original.active==='right'&&(canonical(original,4)||canonical(original,9))){
   const current=segment;segment={...current,phase:current.phase+' · 闲置拇指先让位',sample:p=>{const f=current.sample(p),pose=clonePose(f.right),w=smooth(Math.min(1,p/.15))*smooth(Math.min(1,(1-p)/.15));pose.joints!.right_finger1_joint3+=.05*w;return{...f,right:pose};}};
  }
  segments.push({...segment,start:original.start});time=original.start+segment.duration;
 }
 time=old.duration;
 const changed=segments.some(s=>s.phase.startsWith('局部换握'));
 if(!changed)return old;
 const steps=old.steps;
 return{...old,segments,steps,duration:time,cost:time,sample(t){
  if(t>=time)return old.sample(old.duration);
  const s=segments.find(s=>t<s.start+s.duration)??segments.at(-1)!,p=Math.max(0,Math.min(1,(t-s.start)/s.duration)),frame=old.sample(t);
  if(!s.phase.startsWith('局部换握'))return frame;
  const f=s.sample(p);return{...frame,left:f.left,right:f.right,contacts:f.contacts,angle:f.angle,phase:s.phase,stage:s.stage,active:s.active,activeFinger:s.finger,progress:p};
 }};
}
