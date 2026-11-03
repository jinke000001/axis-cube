import { Quaternion, Vector3 } from 'three';
import { moveAffects, NORMALS, SLOTS, type Vec3 } from '../core/cube';
import { TEACHING_CUBE_SIZE, type TeachingFrame } from './motion';
const vector = (point: readonly number[]) => new Vector3().fromArray(point);
const tuple = (point: Vector3) => point.toArray() as Vec3;
const EPS = 1e-12;
export type Segment = { a: Vec3; b: Vec3 };
export interface RoundedBox {
  center: Vec3;
  rotation: readonly [number, number, number, number];
  half: Vec3;
  rounding: number;
}

function sub(a: Vec3,b: Vec3): Vec3 { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function norm(a: Vec3) { return Math.hypot(...a); }
function clamp(value:number,low=0,high=1) { return Math.min(high,Math.max(low,value)); }

/** Exact unsigned Euclidean distance from a closed segment to an axis-aligned
 * box. The squared distance is quadratic between slab-crossing parameters. */
export function segmentBoxDistance(a: Vec3,b: Vec3,half: Vec3): number {
  const direction=sub(b,a),breaks=[0,1];
  for(let axis=0;axis<3;axis++) if(Math.abs(direction[axis])>EPS) {
    for(const edge of [-half[axis],half[axis]]) {
      const t=(edge-a[axis])/direction[axis];
      if(t>0&&t<1)breaks.push(t);
    }
  }
  breaks.sort((x,y)=>x-y);
  const squared=(t:number)=>a.reduce((sum,value,axis)=>sum+Math.max(0,Math.abs(value+direction[axis]*t)-half[axis])**2,0);
  let best=Math.min(squared(0),squared(1));
  for(let i=0;i<breaks.length-1;i++) {
    const low=breaks[i],high=breaks[i+1],mid=(low+high)/2;
    let quadratic=0,linear=0;
    for(let axis=0;axis<3;axis++) {
      const value=a[axis]+direction[axis]*mid;
      if(Math.abs(value)<=half[axis])continue;
      const offset=a[axis]-Math.sign(value)*half[axis];
      quadratic+=direction[axis]**2;linear+=offset*direction[axis];
    }
    const t=quadratic>EPS?clamp(-linear/quadratic,low,high):mid;
    best=Math.min(best,squared(t),squared(low),squared(high));
  }
  return Math.sqrt(best);
}

/** Closed-segment distance; handles both points and nearly parallel links. */
export function segmentSegmentDistance(a:Vec3,b:Vec3,c:Vec3,d:Vec3):number {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
  const vx=d[0]-c[0],vy=d[1]-c[1],vz=d[2]-c[2];
  const wx=a[0]-c[0],wy=a[1]-c[1],wz=a[2]-c[2];
  const aa=ux*ux+uy*uy+uz*uz,bb=ux*vx+uy*vy+uz*vz,cc=vx*vx+vy*vy+vz*vz;
  const dd=ux*wx+uy*wy+uz*wz,ee=vx*wx+vy*wy+vz*wz;
  let s=0,t=0;
  if(aa<EPS&&cc<EPS)return Math.hypot(wx,wy,wz);
  if(aa<EPS)t=clamp(ee/cc);
  else if(cc<EPS)s=clamp(-dd/aa);
  else {
    const determinant=aa*cc-bb*bb;
    s=determinant>EPS?clamp((bb*ee-cc*dd)/determinant):0;
    t=(bb*s+ee)/cc;
    if(t<0){t=0;s=clamp(-dd/aa);}
    else if(t>1){t=1;s=clamp((bb-dd)/aa);}
  }
  return Math.hypot((a[0]+ux*s)-(c[0]+vx*t),(a[1]+uy*s)-(c[1]+vy*t),(a[2]+uz*s)-(c[2]+vz*t));
}

export function capsuleBoxClearance(segment:Segment,radius:number,box:RoundedBox):number {
  const inverse=new Quaternion().fromArray(box.rotation).invert();
  const local=(point:Vec3)=>tuple(vector(point).sub(vector(box.center)).applyQuaternion(inverse));
  const inner=box.half.map(value=>Math.max(0,value-box.rounding)) as Vec3;
  return segmentBoxDistance(local(segment.a),local(segment.b),inner)-radius-box.rounding;
}

/** Separating-axis test for two oriented boxes. Positive is overlap along all
 * 15 axes; non-positive is a separating gap. Rounding is intentionally ignored
 * so callers can choose outer envelopes or inscribed boxes explicitly. */
export function obbPenetration(a:RoundedBox,b:RoundedBox):number {
  const basis=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
  const qa=new Quaternion().fromArray(a.rotation),qb=new Quaternion().fromArray(b.rotation);
  const axesA=basis.map(axis=>axis.clone().applyQuaternion(qa)),axesB=basis.map(axis=>axis.clone().applyQuaternion(qb));
  const axes=[...axesA,...axesB,...axesA.flatMap(x=>axesB.map(y=>x.clone().cross(y)))];
  const delta=vector(b.center).sub(vector(a.center));let minimum=Infinity;
  for(const raw of axes) {
    if(raw.lengthSq()<EPS)continue;
    const axis=raw.clone().normalize();
    const radiusA=axesA.reduce((sum,x,i)=>sum+Math.abs(x.dot(axis))*a.half[i],0);
    const radiusB=axesB.reduce((sum,x,i)=>sum+Math.abs(x.dot(axis))*b.half[i],0);
    const depth=radiusA+radiusB-Math.abs(delta.dot(axis));
    if(depth<=0)return depth;
    minimum=Math.min(minimum,depth);
  }
  return minimum;
}

/** Three interior slabs retain flat face centres while excluding all rounded
 * edges/corners. An overlap of slabs is positive interior evidence. */
export function inscribedBoxSlabs(box:RoundedBox):RoundedBox[] {
  return [0,1,2].map(axis=>({...box,half:box.half.map((half,i)=>Math.max(0,half-(i===axis?.00012:box.rounding+.00012))) as Vec3,rounding:0}));
}

export interface CubeShape extends RoundedBox { cubie:Vec3; label:string; boundingRadius:number }
/** Mirrors CubeModel's rounded bodies and outward sticker plates. Centers and
 * local frames move with the selected layer, including middle/wide/rotations. */
export function frameCubeShapes(frame:Pick<TeachingFrame,'move'|'angle'>):CubeShape[] {
  const pitch=TEACHING_CUBE_SIZE/3;
  const layerQ=frame.move?new Quaternion().setFromAxisAngle(vector(NORMALS[frame.move.face]),frame.angle):new Quaternion();
  const shapes:CubeShape[]=[];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++) {
    if(x===0&&y===0&&z===0)continue;
    const cubie:Vec3=[x,y,z],moving=frame.move&&moveAffects(frame.move,cubie),q=moving?layerQ:new Quaternion();
    const center=vector(cubie).multiplyScalar(pitch).applyQuaternion(q);
    const half=(pitch-.0012)/2;
    shapes.push({center:tuple(center),rotation:q.toArray(),half:[half,half,half],rounding:.0022,cubie,label:'body',boundingRadius:Math.sqrt(3)*half});
    for(const slot of SLOTS.filter(slot=>slot.position.every((value,index)=>value===cubie[index]))) {
      const normal=vector(slot.normal),stickerCenter=center.clone().add(normal.clone().multiplyScalar((pitch-.0007)/2).applyQuaternion(q));
      const stickerQ=q.clone().multiply(new Quaternion().setFromUnitVectors(new Vector3(0,0,1),normal));
      const stickerHalf:Vec3=[(pitch-.004)/2,(pitch-.004)/2,.0005];
      // RoundedBoxGeometry clamps its radius to half the thinnest dimension.
      shapes.push({center:tuple(stickerCenter),rotation:stickerQ.toArray(),half:stickerHalf,rounding:.0005,cubie,label:`sticker-${slot.face}`,boundingRadius:norm(stickerHalf)});
    }
  }
  return shapes;
}

