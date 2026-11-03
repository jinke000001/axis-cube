import { Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../core/cube';
import type { TeachingFinger, TeachingHand } from './types';
import type { TeachingPose } from './motion';

export const FINGER_LENGTHS = [.045,.040,.019] as const;
/** The idle little finger folds below the middle-finger return corridor. */
export const REST_TIP_HEIGHTS:Record<TeachingFinger,number>={thumb:-.022,index:.022,middle:.007,ring:-.009,little:-.042};
export const FINGER_BASES: Record<TeachingFinger,Vec3> = {
  thumb:[-.014,-.016,.021],index:[-.014,.022,-.014],middle:[-.014,.007,-.019],
  ring:[-.014,-.009,-.018],little:[-.014,-.024,-.012],
};
export function fitPalmTargets(pose:TeachingPose,constraints:readonly {hand:TeachingHand;finger:TeachingFinger}[]) {
  for(const hand of ['left','right'] as const) {
    const sign=hand==='right'?1:-1,h=pose[hand],q=new Quaternion().fromArray(h.rotation);
    const constrained=new Set(constraints.filter(c=>c.hand===hand).map(c=>c.finger));
    if(!constrained.size)continue;
    const palm=new Vector3().fromArray(h.palm),original=palm.clone(),outward=new Vector3(sign,0,0).applyQuaternion(q);
    const minimum=.045*(Math.abs(outward.x)+Math.abs(outward.y)+Math.abs(outward.z))+.038;
    for(let pass=0;pass<32;pass++) {
      palm.lerp(original,.01);
      for(const finger of constrained) {
        const tip=h.tips[finger],base=FINGER_BASES[finger];
        const offset=new Vector3(sign*base[0],base[1],base[2]).applyQuaternion(q);
        const target=new Vector3().fromArray(tip.point).addScaledVector(new Vector3().fromArray(tip.normal),FINGER_LENGTHS[2]*.55).sub(offset);
        const delta=palm.clone().sub(target),max=FINGER_LENGTHS[0]+FINGER_LENGTHS[1]-.001;
        if(delta.length()>max)palm.copy(target.add(delta.setLength(max)));
      }
      const distance=palm.dot(outward);
      if(distance<minimum)palm.addScaledVector(outward,minimum-distance);
    }
    h.palm=palm.toArray() as Vec3;
  }
  return pose;
}
