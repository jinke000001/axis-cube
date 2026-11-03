import {Matrix4,Quaternion,Vector3} from 'three';
import type {Vec3 as Direction} from '../core/cube';
const UP=new Vector3(0,1,0),Z=new Vector3(0,0,1);
const vector=(p:readonly number[])=>new Vector3().fromArray(p);
const cosine=(x:number)=>Math.max(-1,Math.min(1,x));
function state(directions:readonly Direction[]) {
 const [first,second,third]=directions.map(d=>vector(d).normalize());
 let normal=first.clone().cross(second);
 if(normal.lengthSq()<1e-10)normal=first.clone().cross(third);
 if(normal.lengthSq()<1e-10)normal=first.clone().cross(Math.abs(first.x)<.8?new Vector3(1,0,0):UP);
 normal.normalize();
 const side=first.clone().cross(normal).normalize();
 const rotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side,first,normal));
 const distalNormal=second.clone().cross(third).normalize();
 return {first,normal,rotation,proximalBend:Math.acos(cosine(first.dot(second))),distalBend:Math.acos(cosine(second.dot(third))),
  distalTwist:Math.atan2(second.dot(normal.clone().cross(distalNormal)),normal.dot(distalNormal))};
}
/** Keep a free finger’s anatomical bend magnitudes between its endpoints.
 * Rigid MCP orientation interpolates as a whole frame. Unsigned adjacent-bone
 * bend magnitudes interpolate between endpoint values; distal bend-plane
 * azimuth takes the unwrapped short arc. This prevents a shortest quaternion
 * route from passing through 180-degree self-fold or a straighter angle than
 * both endpoints. It does not itself plan around the palm or other fingers.
 * Endpoint straight/fully-folded planes remain geometrically underdetermined;
 * authoring should preserve a plane or insert a verified non-degenerate pose.
 */
export function interpolateFingerDirections(from:readonly Direction[],to:readonly Direction[],blend:number):Direction[] {
 if(blend<=0)return from.map(d=>[...d] as Direction);
 if(blend>=1)return to.map(d=>[...d] as Direction);
 const a=state(from),b=state(to),rotation=a.rotation.clone().slerp(b.rotation,blend);
 const proximal=a.proximalBend+(b.proximalBend-a.proximalBend)*blend;
 const distal=a.distalBend+(b.distalBend-a.distalBend)*blend;
 let difference=b.distalTwist-a.distalTwist;
 while(difference>Math.PI)difference-=Math.PI*2;
 while(difference< -Math.PI)difference+=Math.PI*2;
 const twist=a.distalTwist+difference*blend;
 const second=UP.clone().applyAxisAngle(Z,proximal);
 const distalNormal=Z.clone().applyAxisAngle(second,twist);
 const third=second.clone().applyAxisAngle(distalNormal,distal);
 return [UP.clone(),second,third].map(d=>d.applyQuaternion(rotation).normalize().toArray() as Direction);
}

function axisSwing(from:ReturnType<typeof state>,to:ReturnType<typeof state>) {
 const cross=from.first.clone().cross(to.first),sine=cross.length(),cos=cosine(from.first.dot(to.first));
 if(sine>1e-14)return new Quaternion().setFromAxisAngle(cross.multiplyScalar(1/sine),Math.atan2(sine,cos));
 return cos<0?new Quaternion().setFromAxisAngle(from.normal,Math.PI):new Quaternion();
}
/** Optional offline path candidate: move the MCP axis and fold-plane twist separately.
 * It is not the default runtime route; every constructed path still needs full geometry checks. */
export function interpolateSwingFingerDirections(from:readonly Direction[],to:readonly Direction[],blend:number):Direction[] {
 if(blend<=0)return from.map(d=>[...d] as Direction);
 if(blend>=1)return to.map(d=>[...d] as Direction);
 const a=state(from),b=state(to),fullSwing=axisSwing(a,b);
 const partialSwing=new Quaternion().slerp(fullSwing,blend);
 const first=a.first.clone().applyQuaternion(partialSwing).normalize();
 const normal=a.normal.clone().applyQuaternion(partialSwing);
 const endNormal=a.normal.clone().applyQuaternion(fullSwing);
 const roll=Math.atan2(b.first.dot(endNormal.clone().cross(b.normal)),endNormal.dot(b.normal));
 normal.applyAxisAngle(first,roll*blend).normalize();
 const side=first.clone().cross(normal).normalize();
 const rotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side,first,normal));
 const proximal=a.proximalBend+(b.proximalBend-a.proximalBend)*blend;
 const distal=a.distalBend+(b.distalBend-a.distalBend)*blend;
 let difference=b.distalTwist-a.distalTwist;
 while(difference>Math.PI)difference-=Math.PI*2;
 while(difference< -Math.PI)difference+=Math.PI*2;
 const twist=a.distalTwist+difference*blend;
 const second=UP.clone().applyAxisAngle(Z,proximal);
 const distalNormal=Z.clone().applyAxisAngle(second,twist);
 const third=second.clone().applyAxisAngle(distalNormal,distal);
 return [UP.clone(),second,third].map(d=>d.applyQuaternion(rotation).normalize().toArray() as Direction);
}
