import { Quaternion, Vector3 } from 'three';
import { parseMove } from '../core/cube';
import { rotatedFingerPose } from '../scene/finger-data';
import type { FingerProgram } from '../scene/finger-program';
import type { FingerContact } from '../scene/finger-contact';
import { createTipFlickProgram } from './tip-flick';
import { createThumbSideFlickProgram } from './thumb-side-flick';

/** Candidate B/B' by rigidly placing the measured side-pad family on the
 * corresponding back-layer side edge. Actual original hand and arm geometry
 * must pass independently; transformation alone does not grant acceptance. */
export function createBackFlickProgram(prime=false):FingerProgram {
  const source=prime?createThumbSideFlickProgram():createTipFlickProgram();
  const rotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2),move=parseMove(prime?"B'":'B');
  const contact=(c:FingerContact):FingerContact=>({...c,point:c.point.clone().applyQuaternion(rotation),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()});
  const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>({...f,left:rotatedFingerPose(f.left,rotation),right:rotatedFingerPose(f.right,rotation),contacts:f.contacts.map(contact)});
  return {...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:s.phase.replaceAll('U', 'B'),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:f.phase.replaceAll('U','B')};}};
}
