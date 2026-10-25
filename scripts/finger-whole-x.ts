/** Actual whole-object x/x-prime primitives, including independent hand regrips.
 * Only this script and evidence/finger-whole-x-* are written.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Box3, Group, Matrix4, Mesh, Quaternion, Ray, Triangle, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { DexterousHand } from "../src/scene/hand";
import { MechanicalArm, ARM_LENGTHS } from "../src/scene/arm";
import { fingerLibrary } from "../src/scene/finger-data";
import { hasMeasuredSupport } from "../src/scene/finger-contact";
import { parseMove, moveAngle } from "../src/core/cube";

type Side = "left" | "right";
type Pose = { position: number[]; quaternion: number[]; joints: Record<string, number> };
type Contact = { side: Side; finger: number; role: "drive"|"support"; point: number[]; normal: number[]; padOffset: number[] };
type Frame = { progress: number; cubeAngle: number; cubeOrientation: number[]; left: Pose; right: Pose; contacts: Contact[]; turning: boolean };
type Segment = { id: string; phase: string; frames: Frame[]; validation?: ReturnType<typeof validate> };
const sides: Side[] = ["left", "right"], center = new Vector3(0,0.34,0), axisX=new Vector3(1,0,0);
const clone = <T>(value:T):T => structuredClone(value), other=(s:Side):Side=>s==="left"?"right":"left";
const q = (a:number[])=>new Quaternion(...a as [number,number,number,number]);
const v = (a:number[])=>new Vector3(...a as [number,number,number]);
const low=(s:Side):Pose=>clone(fingerLibrary.hands[s].support), grip=(s:Side):Pose=>clone(fingerLibrary.hands[s].grip);
const outputPath="evidence/finger-whole-x-primitives.json", previous=existsSync(outputPath)?JSON.parse(readFileSync(outputPath,"utf8")):undefined;
const thresholdMM=.3;
function contacts(side:Side,kind:"low"|"grip",role:"drive"|"support",worldContactRotation=new Quaternion(),cubeOrientation=new Quaternion()):Contact[]{
  const data=kind==="low"?fingerLibrary.hands[side].contacts:fingerLibrary.hands[side].gripContacts;
  const transform=cubeOrientation.clone().invert().multiply(worldContactRotation);
  return data.map(c=>({side,finger:c.finger,role,point:v(c.point).applyQuaternion(transform).toArray(),normal:v(c.normal).applyQuaternion(transform).toArray(),padOffset:[...c.padOffset]}));
}
function mixPose(a:Pose,b:Pose,t:number):Pose{return {position:v(a.position).lerp(v(b.position),t).toArray(),quaternion:q(a.quaternion).slerp(q(b.quaternion),t).toArray(),joints:Object.fromEntries(Object.keys(a.joints).map(k=>[k,a.joints[k]+(b.joints[k]-a.joints[k])*t]))};}
function shifted(p:Pose,dx:number):Pose{const r=clone(p);r.position[0]+=dx;return r;}
function rotated(p:Pose,rotation:Quaternion):Pose{return {...clone(p),position:v(p.position).sub(center).applyQuaternion(rotation).add(center).toArray(),quaternion:rotation.clone().multiply(q(p.quaternion)).toArray()};}
function mixFrame(a:Frame,b:Frame,t:number):Frame{return {...clone(a),progress:a.progress+(b.progress-a.progress)*t,cubeAngle:a.cubeAngle+(b.cubeAngle-a.cubeAngle)*t,cubeOrientation:q(a.cubeOrientation).slerp(q(b.cubeOrientation),t).toArray(),left:mixPose(a.left,b.left,t),right:mixPose(a.right,b.right,t)};}
Object.assign(globalThis, { DOMParser, Document, Element });
const hands = {} as Record<Side, DexterousHand>, arms = {} as Record<Side, MechanicalArm>;
const assetHasher = createHash("sha256");
type Bound = { side: Side; finger: number; name: string; mesh: Mesh; local: OBB; world: OBB; inverse: Matrix4 };
const bounds = {} as Record<Side, Bound[]>;
for (const side of sides) {
  const directory = resolve("public/models/wuji/hand/body/urdf");
  const loader = new URDFLoader(); loader.parseCollision = false;
  loader.loadMeshCb = (url, _manager, material, done) => {
    const bytes = readFileSync(url);
    assetHasher.update(url).update(bytes);
    const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.deleteAttribute("normal"); const merged = mergeVertices(geometry, 1e-6); geometry.dispose();
    done(new Mesh(merged, material));
  };
  const urdf = readFileSync(`${directory}/${side}.urdf`, "utf8"); assetHasher.update(urdf);
  hands[side] = new DexterousHand(loader.parse(urdf, directory + "/"), side);
  arms[side] = new MechanicalArm(side);
  bounds[side] = [];
  hands[side].root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.computeBoundingBox();
    let link = node.parent; while (link && !/finger\d|palm/.test(link.name)) link = link.parent;
    bounds[side].push({ side, finger: Number(link?.name.match(/finger(\d)/)?.[1] ?? 0), name: link?.name ?? "unknown", mesh: node, local: new OBB().fromBox3(node.geometry.boundingBox!), world: new OBB(), inverse: new Matrix4() });
  });
}
const links = sides.flatMap((side) => (["upper", "fore"] as const).map((part) => {
  const root = arms[side].root.getObjectByName(`${side}-${part === "upper" ? "upper-arm" : "forearm"}`) as Group;
  const length = ARM_LENGTHS[part], meshes: Mesh[] = [];
  root.traverse((node) => { if (node instanceof Mesh) { node.geometry.computeBoundingBox(); meshes.push(node); } });
  return { side, part, root, length, meshes, inverse: new Matrix4(), world: new OBB(), local: new OBB().fromBox3(new Box3(new Vector3(-0.03, -length / 2, -0.035), new Vector3(0.03, length / 2, 0.035))) };
}));
const selfCache = new Map<string, { depthMM: number; pair: string }>();
function apply(f: Frame) {
  for (const side of sides) {
    const pose = f[side];
    hands[side].root.position.fromArray(pose.position); hands[side].root.quaternion.fromArray(pose.quaternion);
    hands[side].robot.setJointValues(pose.joints); hands[side].root.updateMatrixWorld(true);
    arms[side].update(v(pose.position), q(pose.quaternion)); arms[side].root.updateMatrixWorld(true);
    for (const bound of bounds[side]) { bound.world.copy(bound.local).applyMatrix4(bound.mesh.matrixWorld); bound.inverse.copy(bound.mesh.matrixWorld).invert(); }
  }
  for (const link of links) { link.world.copy(link.local).applyMatrix4(link.root.matrixWorld); link.inverse.copy(link.root.matrixWorld).invert(); }
}
const triangle = new Triangle(), ray = new Ray(), direction = new Vector3(1, 0.371, 0.219).normalize();
function insideDepth(a: Bound, b: Bound) {
  const matrix = b.inverse.clone().multiply(a.mesh.matrixWorld), points = a.mesh.geometry.getAttribute("position"), vertices = b.mesh.geometry.getAttribute("position"), indices = b.mesh.geometry.index;
  const count = indices?.count ?? vertices.count, p = new Vector3(), hit = new Vector3(), closest = new Vector3();
  let depth = 0;
  for (let i = 0; i < points.count; i++) {
    p.fromBufferAttribute(points, i).applyMatrix4(matrix);
    if (!b.mesh.geometry.boundingBox!.containsPoint(p)) continue;
    ray.set(p, direction); const hits: number[] = [];
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(t) : t); triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(t + 1) : t + 1); triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(t + 2) : t + 2);
      if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) hits.push(p.distanceToSquared(hit));
    }
    hits.sort((a, b) => a - b);
    if (hits.filter((x, j) => j === 0 || Math.abs(x - hits[j - 1]) > 1e-11).length % 2 !== 1) continue;
    let nearest = Infinity;
    for (let t = 0; t < count; t += 3) {
      triangle.a.fromBufferAttribute(vertices, indices ? indices.getX(t) : t); triangle.b.fromBufferAttribute(vertices, indices ? indices.getX(t + 1) : t + 1); triangle.c.fromBufferAttribute(vertices, indices ? indices.getX(t + 2) : t + 2);
      triangle.closestPointToPoint(p, closest); nearest = Math.min(nearest, p.distanceToSquared(closest));
    }
    depth = Math.max(depth, Math.sqrt(nearest) * 1000);
  }
  return depth;
}
function pairDepth(a: Bound[], b: Bound[], sameSide = false) {
  let depthMM = 0, pair = "";
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const left = a[i], right = b[j];
    if (sameSide && (j <= i || !left.finger || !right.finger || left.finger === right.finger)) continue;
    if (!left.world.intersectsOBB(right.world)) continue;
    const depth = Math.max(insideDepth(left, right), insideDepth(right, left));
    if (depth > depthMM) { depthMM = depth; pair = `${left.name} / ${right.name}`; }
  }
  return { depthMM, pair };
}
function selfDepth(side: Side, pose: Pose) {
  // Same-hand containment depends on joint angles, not its rigid world pose.
  const key = `${side}:${Object.values(pose.joints).map((a) => a.toFixed(9)).join(",")}`;
  if (!selfCache.has(key)) selfCache.set(key, pairDepth(bounds[side], bounds[side], true));
  return selfCache.get(key)!;
}
function boxDepth(p: Vector3) { return Math.min(0.045 - Math.abs(p.x), 0.045 - Math.abs(p.y), 0.045 - Math.abs(p.z)); }
function cubeDepth(meshes: Mesh[], orientation: Quaternion) {
  const inverse = orientation.clone().invert(), point = new Vector3();
  let depthMM = 0, meshName = "", worldPoint: number[] = [];
  for (const mesh of meshes) {
    const vertices = mesh.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).sub(center).applyQuaternion(inverse);
      const depth = boxDepth(point) * 1000;
      if (depth > depthMM) { depthMM = depth; meshName = mesh.parent?.parent?.name ?? "unknown"; worldPoint = point.clone().applyQuaternion(orientation).add(center).toArray(); }
    }
  }
  return { depthMM, meshName, worldPoint };
}
const bodyQ = new Vector3();
function bodyDepth(p: Vector3, length: number) {
  const radius = 0.008;
  bodyQ.set(Math.abs(p.x) - (0.047 / 2 - radius), Math.abs(p.y) - (length * 0.77 / 2 - radius), Math.abs(p.z) - (0.041 / 2 - radius));
  const shell = radius - (Math.hypot(Math.max(bodyQ.x, 0), Math.max(bodyQ.y, 0), Math.max(bodyQ.z, 0)) + Math.min(Math.max(bodyQ.x, bodyQ.y, bodyQ.z), 0));
  const half = (length - 0.028) / 2, taper = 0.025 - 0.004 * (p.y + half) / (2 * half);
  return Math.max(shell, Math.min(half - Math.abs(p.y), taper - Math.hypot(p.x, p.z)));
}
const armMeshBox = new OBB();
function intoArm(mesh: Mesh, link: (typeof links)[number]) {
  armMeshBox.fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  if (!armMeshBox.intersectsOBB(link.world)) return 0;
  const matrix = link.inverse.clone().multiply(mesh.matrixWorld), points = mesh.geometry.getAttribute("position"), point = new Vector3();
  let depthMM = 0;
  for (let i = 0; i < points.count; i++) depthMM = Math.max(depthMM, bodyDepth(point.fromBufferAttribute(points, i).applyMatrix4(matrix), link.length) * 1000);
  return depthMM;
}

const metricZero=()=>({handCubeMM:0,selfContainmentMM:0,handHandMM:0,handArmMM:0,crossArmMM:0,armCubeMM:0,reachErrorMM:0,contactErrorMM:0,jointLimitRadians:0,supportFailures:0,contactCountFailures:0});
const frameCache=new Map<string,any>();
function inspect(f:Frame,notation:string){
  const cacheKey=JSON.stringify({f,notation});if(frameCache.has(cacheKey))return frameCache.get(cacheKey);
  apply(f);const maximum=metricZero(),detail:Record<string,unknown>={},cubeQ=q(f.cubeOrientation),actualSupport:Vector3[]=[];
  for(const side of sides){
    const cube=cubeDepth(bounds[side].map(b=>b.mesh),cubeQ);if(cube.depthMM>maximum.handCubeMM){maximum.handCubeMM=cube.depthMM;detail.cube={side,...cube};}
    const self=selfDepth(side,f[side]);if(self.depthMM>maximum.selfContainmentMM){maximum.selfContainmentMM=self.depthMM;detail.self={side,...self};}
    const origin=new Vector3(side==="left"?-.355:.355,.155,-.09);
    maximum.reachErrorMM=Math.max(maximum.reachErrorMM,Math.abs(arms[side].elbowPosition.distanceTo(origin)-ARM_LENGTHS.upper)*1000,Math.abs(arms[side].elbowPosition.distanceTo(arms[side].wristPosition)-ARM_LENGTHS.fore)*1000);
    for(const [name,value]of Object.entries(f[side].joints)){const limit=hands[side].robot.joints[name].limit;maximum.jointLimitRadians=Math.max(maximum.jointLimitRadians,value-limit.upper,limit.lower-value);}
  }
  const mutual=pairDepth(bounds.left,bounds.right);maximum.handHandMM=mutual.depthMM;if(mutual.depthMM>thresholdMM)detail.mutual=mutual;
  for(const contact of f.contacts){
    const actual=hands[contact.side].robot.links[`${contact.side}_finger${contact.finger}_tip_link`].localToWorld(v(contact.padOffset));
    const target=v(contact.point).applyQuaternion(cubeQ).add(center),errorMM=actual.distanceTo(target)*1000;
    if(errorMM>maximum.contactErrorMM){maximum.contactErrorMM=errorMM;detail.contact={side:contact.side,finger:contact.finger,role:contact.role,errorMM,actual:actual.toArray(),target:target.toArray()};}
    if(errorMM<=thresholdMM)actualSupport.push(actual);
  }
  if(f.turning&&(f.contacts.length!==10||f.contacts.some(c=>c.role!=="drive")))maximum.contactCountFailures++;
  let area=0;for(let a=0;a<actualSupport.length;a++)for(let b=a+1;b<actualSupport.length;b++)for(let c=b+1;c<actualSupport.length;c++)area=Math.max(area,actualSupport[b].clone().sub(actualSupport[a]).cross(actualSupport[c].clone().sub(actualSupport[a])).length()/2);
  const livePoses=Object.fromEntries(sides.map(s=>[s,{position:v(f[s].position),quaternion:q(f[s].quaternion),joints:f[s].joints,closed:1}])) as any;
  const liveContacts=f.contacts.map(c=>({...c,point:v(c.point),normal:v(c.normal),padOffset:v(c.padOffset)})) as any;
  const gate=hasMeasuredSupport(livePoses,liveContacts,f.turning?parseMove(notation):undefined,f.turning?f.cubeAngle:0,f.turning?new Quaternion():cubeQ);
  if(area<=.00015||!gate){maximum.supportFailures++;detail.support={area,gate};}
  for(const link of links){
    for(const side of sides)for(const bound of bounds[side]){const d=intoArm(bound.mesh,link);if(d>maximum.handArmMM){maximum.handArmMM=d;detail.handArm={hand:bound.name,arm:link.side,part:link.part,depthMM:d};}}
    for(const opposite of links.filter(l=>l.side!==link.side))for(const mesh of opposite.meshes)maximum.crossArmMM=Math.max(maximum.crossArmMM,intoArm(mesh,link));
    maximum.armCubeMM=Math.max(maximum.armCubeMM,cubeDepth(link.meshes,cubeQ).depthMM);
  }
  const result={maximum,detail};frameCache.set(cacheKey,result);return result;
}
function validate(segment:Segment,notation:string){
  const maximum=metricZero(),failures:any[]=[],peaks:Record<string,unknown>={};
  for(let i=0;i<segment.frames.length*2-1;i++){
    const a=segment.frames[Math.floor(i/2)],b=segment.frames[Math.min(Math.floor(i/2)+1,segment.frames.length-1)],f=i%2?mixFrame(a,b,.5):a;
    const value=inspect(f,notation);
    for(const name of Object.keys(maximum)as(keyof typeof maximum)[])if(value.maximum[name]>maximum[name]){maximum[name]=value.maximum[name];peaks[name]={phase:segment.phase,progress:f.progress,value:maximum[name],detail:value.detail};}
    const invalid=Object.entries(value.maximum).filter(([name,v])=>name==="jointLimitRadians"?(v as number)>1e-7:name.endsWith("Failures")?(v as number)>0:(v as number)>thresholdMM);
    if(invalid.length)failures.push({progress:f.progress,invalid:invalid.map(([name])=>name),...value,frame:failures.length===0?f:undefined});
  }
  return {passed:failures.length===0,checkedFrames:segment.frames.length*2-1,maximum,peaks,failures};
}
function build(notation:string,first:Side){
  const theta=moveAngle(parseMove(notation)),finalQ=new Quaternion().setFromAxisAngle(axisX,theta),segments:Segment[]=[],poses={left:low("left"),right:low("right")};
  function travel(id:string,side:Side,target:Pose,held:Contact[],cubeOrientation=new Quaternion()){
    const start=clone(poses[side]),fixed=clone(poses[other(side)]);
    const segment:Segment={id,phase:id,frames:Array.from({length:65},(_,i)=>{const pose=mixPose(start,target,i/64);return {progress:i/64,cubeAngle:segments.some(s=>s.id==="whole-turn")?theta:0,cubeOrientation:cubeOrientation.toArray(),left:side==="left"?pose:clone(fixed),right:side==="right"?pose:clone(fixed),contacts:clone(held),turning:false};})};
    segment.validation=validate(segment,notation);segments.push(segment);poses[side]=clone(target);
  }
  travel("right-low-to-full-grip","right",grip("right"),contacts("left","low","support"));
  travel("left-low-to-full-grip","left",grip("left"),contacts("right","grip","support"));
  const turn:Segment={id:"whole-turn",phase:`true ${notation} whole-object rotation`,frames:Array.from({length:65},(_,i)=>{
    const angle=theta*i/64,rotation=new Quaternion().setFromAxisAngle(axisX,angle);
    return {progress:i/64,cubeAngle:angle,cubeOrientation:rotation.toArray(),left:rotated(grip("left"),rotation),right:rotated(grip("right"),rotation),contacts:[...contacts("left","grip","drive"),...contacts("right","grip","drive")],turning:true};
  })};
  turn.validation=validate(turn,notation);segments.push(turn);poses.left=clone(turn.frames.at(-1)!.left);poses.right=clone(turn.frames.at(-1)!.right);
  const recovered=new Set<Side>();
  for(const side of [first,other(first)]){
    const heldSide=other(side),sign=side==="left"?-1:1;
    const held=recovered.has(heldSide)?contacts(heldSide,"low","support",new Quaternion(),finalQ):contacts(heldSide,"grip","support",finalQ,finalQ);
    travel(`${side}-withdraw-65mm`,side,shifted(poses[side],sign*.065),held,finalQ);
    travel(`${side}-recover-outside`,side,shifted(low(side),sign*.065),held,finalQ);
    travel(`${side}-seat-low`,side,low(side),held,finalQ);recovered.add(side);
  }
  const boundaries=segments.slice(1).map((next,i)=>{const a=segments[i].frames.at(-1)!,b=next.frames[0];return {from:segments[i].id,to:next.id,cubeQuaternionGap:q(a.cubeOrientation).angleTo(q(b.cubeOrientation)),hands:sides.map(side=>({side,wristMM:v(a[side].position).distanceTo(v(b[side].position))*1000,wristRadians:q(a[side].quaternion).angleTo(q(b[side].quaternion)),jointRadians:Math.max(...Object.keys(a[side].joints).map(k=>Math.abs(a[side].joints[k]-b[side].joints[k])))}))};});
  const final:Frame={...clone(segments.at(-1)!.frames.at(-1)!),contacts:[...contacts("left","low","support",new Quaternion(),finalQ),...contacts("right","low","support",new Quaternion(),finalQ)]};
  const finalCheck=inspect(final,notation);
  const passed=segments.every(s=>s.validation!.passed)&&boundaries.every(b=>b.cubeQuaternionGap<1e-7&&b.hands.every(h=>h.wristMM<1e-6&&h.wristRadians<1e-7&&h.jointRadians<1e-8))&&finalCheck.maximum.supportFailures===0&&finalCheck.maximum.contactErrorMM<=thresholdMM;
  return {notation,angle:theta,returnOrder:[first,other(first)],passed,segments,boundaries,final,finalCheck};
}
const attempts:any[]=[],primitives:Record<string,ReturnType<typeof build>>={};
for(const notation of ["x","x'"]){
  let candidate=build(notation,"left");
  if(!candidate.passed){attempts.push(candidate);const alternative=build(notation,"right");if(alternative.passed)candidate=alternative;else attempts.push(alternative);}
  primitives[notation==="x"?"x":"xPrime"]=candidate;
  console.log(JSON.stringify({notation,passed:candidate.passed,returnOrder:candidate.returnOrder,segments:candidate.segments.map(s=>({id:s.id,passed:s.validation!.passed,maximum:s.validation!.maximum,firstFailure:s.validation!.failures[0]?.detail}))}));
}
const failedHistory=previous?.failedAttempts??[];if(previous&&!previous.passed)failedHistory.push({date:previous.date,primitives:previous.primitives});
const result={date:new Date().toISOString(),version:1,passed:Object.values(primitives).every(p=>p.passed),source:{path:"src/scene/finger-library.json",sha256:createHash("sha256").update(readFileSync("src/scene/finger-library.json")).digest("hex")},assetSHA256:assetHasher.digest("hex"),scriptSHA256:createHash("sha256").update(readFileSync("scripts/finger-whole-x.ts")).digest("hex"),thresholdMM,cubeCenter:center.toArray(),primitives,failedAttempts:[...failedHistory,...attempts],contract:{poseUnits:"meters/radians; quaternion [x,y,z,w]",cubeOrientation:"absolute physical orientation relative to primitive-entry facelets; remains rotated through all regrips",contacts:"object coordinates relative to entry cube; full turn has 10 drive contacts, recovery uses opposite hand support contacts",supportGate:"TURN: kind=rotation, angle=cubeAngle, orientation=identity. Recovery: no move, angle=0, orientation=cubeOrientation.",logicalCommit:"At primitive completion apply notation x or x-prime to facelets and reset render orientation to identity atomically. This rebases the already-rotated object; do not animate an inverse turn.",nextPrimitive:"Starts from canonical low with newly committed facelets; both final low contact sets can then rebase to canonical object coordinates."},limitations:["Only x and x-prime 90-degree complete paths are supplied. No y/z or new slice primitive is claimed.","Pose/geometry/contact validation only; speed, force closure and hardware are not established.","Mesh vertex/containment checks and upper/forearm solid checks exclude intentional adjacent finger links and wrist mounts; not continuous triangle intersection proof."]};
writeFileSync(outputPath,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({outputPath,passed:result.passed,uniqueStates:frameCache.size}));if(!result.passed)process.exitCode=1;

