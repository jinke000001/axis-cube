import { Quaternion, Vector3 } from 'three';
import { blendFingerPose, handPose, rotatedFingerPose, type PoseData } from '../scene/finger-data';
import { smooth, type HandPose, type Side } from '../scene/motion';
import data from '../../art/wuji-teaching/compact-handoff-calibration.json';
import { compactHandoff, type HandoffPart } from './compact-handoff';
import {fingerLibrary} from '../scene/finger-data';
import {createBackFlickProgram} from './back-flick';

const placement=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
/** Extend the known unload/receive contract to the back-family supporting
 * hand, rather than blending a closed thumb through a cube corner. */
function backGripHandoff(side:Side,from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3,preferred?:1|2):HandoffPart[]{
  const raw=data.records.find(r=>r.id===side+'-low')!;
  const held=rotatedFingerPose(handPose(raw.from as unknown as PoseData),placement);
  const parked=rotatedFingerPose(handPose(raw.parked as unknown as PoseData),placement);
  const same=(p:HandPose)=>p.position.distanceTo(held.position)<1e-8&&p.quaternion.angleTo(held.quaternion)<1e-7&&Object.entries(held.joints!).every(([k,v])=>Math.abs(p.joints![k]-v)<1e-7);
  const parts:HandoffPart[]=[],a=same(from),b=same(to);
  if(a){const original=from;parts.push({duration:.38,phase:'另一手接稳 · 背层支撑指卸力',sample:p=>blendFingerPose(original,parked,smooth(p))});from=parked;padA=new Vector3().fromArray(raw.thumbPad);normalA=new Vector3().fromArray(raw.thumbNormal).applyQuaternion(placement);}
  if(a||b){if(!a)padA=new Vector3().fromArray(raw.thumbPad);if(!b)padB=new Vector3().fromArray(raw.thumbPad);}
  const target=b?parked:to;
  if(b){padB=new Vector3().fromArray(raw.thumbPad);normalB=new Vector3().fromArray(raw.thumbNormal).applyQuaternion(placement);}
  parts.push(...compactHandoff(side,from,target,padA,padB,normalA,normalB,a||b?1:preferred));
  if(b)parts.push({duration:.38,phase:'背层支撑腕先到位 · 指垫重新接稳',sample:p=>blendFingerPose(parked,to,smooth(p))});
  return parts;
}

const samePose=(a:HandPose,b:HandPose)=>a.position.distanceTo(b.position)<1e-8&&a.quaternion.angleTo(b.quaternion)<1e-7&&Object.entries(a.joints!).every(([k,v])=>Math.abs(v-b.joints![k])<1e-7);
/** Change family at its measured support pose, then reuse its local unload
 * path. A compound wrist pitch must not drag a free thumb/index round an edge. */
export function backHandoff(side:Side,from:HandPose,to:HandPose,padA:Vector3,padB:Vector3,normalA:Vector3,normalB:Vector3,preferred?:1|2):HandoffPart[]{
  const localHome=handPose(fingerLibrary.hands[side].support),backHome=rotatedFingerPose(localHome,placement),back=placement.clone().invert();
  const homePad=new Vector3().fromArray(fingerLibrary.hands[side].gripContacts.find(c=>c.finger===2)!.padOffset),homeNormal=new Vector3(side==='left'?-1:1,0,0);
  const programs=side==='right'?[createBackFlickProgram(),createBackFlickProgram(true)]:[];
  const isEnd=programs.some(p=>samePose(from,p.sample(p.duration)[side]));
  const isStart=programs.some(p=>samePose(to,p.sample(0)[side]));
  const parts:HandoffPart[]=[];
  const placed=(p:HandoffPart):HandoffPart=>({...p,phase:'背层握姿 · '+p.phase,sample:t=>rotatedFingerPose(p.sample(t),placement)});
  if(isEnd){
    const localFrom=rotatedFingerPose(from,back);
    parts.push(...compactHandoff(side,localFrom,localHome,padA,homePad,normalA.clone().applyQuaternion(back),homeNormal,preferred).map(placed));
    from=backHome;padA=homePad;normalA=homeNormal;
  }
  if(isStart){
    if(!samePose(from,backHome))parts.push(...backGripHandoff(side,from,backHome,padA,homePad,normalA,homeNormal,preferred));
    const localTo=rotatedFingerPose(to,back);
    parts.push(...compactHandoff(side,localHome,localTo,homePad,padB,homeNormal,normalB.clone().applyQuaternion(back),preferred).map(placed));
  }else if(!samePose(from,to))parts.push(...backGripHandoff(side,from,to,padA,padB,normalA,normalB,preferred));
  return parts;
}
