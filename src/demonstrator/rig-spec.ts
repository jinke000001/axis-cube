import { Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../core/cube';
import type { TeachingFinger, TeachingHand } from './types';
import { FINGER_BASES, FINGER_LENGTHS, REST_TIP_HEIGHTS, fingerLengths } from './hand-model';
import type { TeachingPose } from './motion';

export { FINGER_BASES, FINGER_LENGTHS, REST_TIP_HEIGHTS };
export function fitPalmTargets(pose:TeachingPose,constraints:readonly {hand:TeachingHand;finger:TeachingFinger}[]) {
  for(const hand of ['left','right'] as const) {
    const sign=hand==='right'?1:-1,h=pose[hand],q=new Quaternion().fromArray(h.rotation);
    const constrained=new Set(constraints.filter(c=>c.hand===hand).map(c=>c.finger));
    if(!constrained.size)continue;
    const palm=new Vector3().fromArray(h.palm),original=palm.clone(),outward=new Vector3(sign,0,0).applyQuaternion(q);
    const minimum=.045*(Math.abs(outward.x)+Math.abs(outward.y)+Math.abs(outward.z))+.038;
    for(let pass=0;pass<32;pass++) {
      palm.lerp(original,.01);
      let shortage=0;
      for(const finger of constrained) {
        const lengths=fingerLengths(finger);
        const tip=h.tips[finger],base=FINGER_BASES[finger];
        const offset=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q);
        const dip=new Vector3().fromArray(tip.point).addScaledVector(new Vector3().fromArray(tip.normal),lengths[2]*.55);
        const chord=palm.clone().add(offset).distanceTo(dip);
        // Keep the two proximal links in a curl instead of folding them flat
        // against a palm that sits only a few centimetres off the cube.
        shortage=Math.max(shortage,(lengths[0]+lengths[1])*.74-chord);
        const target=dip.clone().sub(offset);
        const delta=palm.clone().sub(target),max=lengths[0]+lengths[1]-.001;
        if(delta.length()>max)palm.copy(target.add(delta.setLength(max)));
      }
      if(shortage>0&&palm.dot(outward)<.18)palm.addScaledVector(outward,Math.min(.02,shortage));
      const distance=palm.dot(outward);
      if(distance<minimum)palm.addScaledVector(outward,minimum-distance);
    }
    h.palm=palm.toArray() as Vec3;
  }
  return pose;
}
