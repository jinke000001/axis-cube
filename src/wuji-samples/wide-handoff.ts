import {Quaternion,Vector3} from 'three';
import {blendFingerPose,clonePose,fingerLibrary,handPose,rotatedFingerPose,type PoseData} from '../scene/finger-data';
import {smooth,type HandPose,type Side} from '../scene/motion';
import {compactHandoff,type HandoffPart} from './compact-handoff';
import wide from '../../art/wuji-teaching/wide-right-grip-calibration.json';
import parkedRecords from '../../art/wuji-teaching/compact-handoff-calibration.json';

const X=new Vector3(1,0,0),grip=handPose(wide.pose),record=parkedRecords.records.find(r=>r.id==='right-low')!;
const parked=handPose(record.parked as unknown as PoseData);
const pose=(angle:number,gap=0)=>{const p=rotatedFingerPose(grip,new Quaternion().setFromAxisAngle(X,angle));p.position.x+=gap;return p;};
const same=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.angleTo(b.quaternion)<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
const identify=(p:HandPose)=>[0,-Math.PI/2].find(a=>same(p,pose(a)));
function release(angle:number):HandoffPart[]{
  const held=pose(angle),outside=pose(angle,.05),neutral=pose(0,.05),loose={...clonePose(neutral),joints:{...parked.joints}};
  const parts:HandoffPart[]=[{duration:.4,phase:'另一手接稳 · 双层握指离面',sample:p=>blendFingerPose(held,outside,smooth(p))}];
  if(Math.abs(angle)>1e-8)parts.push({duration:1,phase:'方外收回双层腕姿',sample:p=>pose(angle*(1-smooth(p)),.05)});
  parts.push({duration:.4,phase:'方外释放握指',sample:p=>blendFingerPose(neutral,loose,smooth(p))});
  parts.push({duration:.4,phase:'接成已校准侧拨预备',sample:p=>blendFingerPose(loose,parked,smooth(p))});
  return parts;
}
/** The middle-layer thumb must clear the right face before the free wrist
 * resets. Then reuse the original measured C8 standby-to-flick path. */
export function wideHandoff(side:Side,from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3,preferred?:1|2,targetDigit:1|2=2):HandoffPart[]{
  if(side!=='right')return compactHandoff(side,from,to,padA,padB,normalA,normalB,preferred);
  const a=identify(from),b=identify(to),parts:HandoffPart[]=[];
  if(a!==undefined){parts.push(...release(a));from=parked;}
  if(b!==undefined){
    if(!same(from,parked))parts.push(...compactHandoff(side,from,parked,padA,new Vector3().fromArray(record.thumbPad),normalA,new Vector3().fromArray(record.thumbNormal),1));
    parts.push(...release(b).reverse().map(p=>({...p,phase:'接成两层握姿 · '+p.phase,sample:(t:number)=>p.sample(1-t)})));return parts;
  }
  if(a!==undefined){
    const known=[handPose(fingerLibrary.hands.right.support),...[0,-Math.PI/2].map(a=>rotatedFingerPose(handPose(fingerLibrary.hands.right.grip),new Quaternion().setFromAxisAngle(X,a)))].some(p=>same(to,p));
    preferred=known?1:targetDigit;
    padA=new Vector3().fromArray(preferred===1?record.thumbPad:fingerLibrary.hands.right.gripContacts.find(c=>c.finger===2)!.padOffset);
    normalA=preferred===1?new Vector3().fromArray(record.thumbNormal):X.clone();
  }
  if(!same(from,to))parts.push(...compactHandoff(side,from,to,padA,padB,normalA,normalB,preferred));return parts;
}
