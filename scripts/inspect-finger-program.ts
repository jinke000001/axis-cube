/** Independent mesh acceptance of the actual joined finger-program compiler.
 * Writes only evidence/finger-program-*; does not change any application code.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
import { compileFingerProgram } from "../src/scene/finger-program";
import { FINGER_STUDIES } from "../src/core/finger-studies";
import { NORMALS, parseAlgorithm, type Move } from "../src/core/cube";
import type { FingerContact } from "../src/scene/finger-contact";

type Side = "left" | "right";
type Pose = { position: number[]; quaternion: number[]; joints: Record<string, number> };
type Frame = { cubeAngle: number; left: Pose; right: Pose; contacts: FingerContact[] };
const sides: Side[] = ["left", "right"], center = new Vector3(0, 0.34, 0), axisY = new Vector3(0, 1, 0);
const q = (a: number[]) => new Quaternion(...a as [number, number, number, number]);
const v = (a: number[]) => new Vector3(...a as [number, number, number]);
const clone = <T>(value:T):T => structuredClone(value);
const arg = (name:string, fallback="") => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const mode=arg("--mode","coarse"), studyFilter=arg("--study"), phaseFilter=arg("--phase");
const coarse=mode==="coarse", divisions=coarse?8:128, thresholdMM=0.3;
const phaseExpression=phaseFilter?new RegExp(phaseFilter):undefined;
function convert(state:any):Frame {
  const pose=(p:any):Pose=>({position:p.position.toArray(),quaternion:p.quaternion.toArray(),joints:{...p.joints}});
  return {cubeAngle:state.angle,left:pose(state.left),right:pose(state.right),contacts:state.contacts};
}
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
function cubeDepth(meshes: Mesh[], move?: Move, angle = 0) {
  const normal = move ? new Vector3(...NORMALS[move.face]) : null;
  const inverseTurn = new Quaternion().setFromAxisAngle(normal ?? axisY, -angle);
  const point = new Vector3(), rotated = new Vector3();
  let depthMM = 0, meshName = "", worldPoint: number[] = [];
  for (const mesh of meshes) {
    const vertices = mesh.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).sub(center);
      let depth = boxDepth(point);
      if (normal) {
        const coordinate = point.dot(normal);
        rotated.copy(point).applyQuaternion(inverseTurn);
        depth = Math.max(Math.min(depth, 0.015 - coordinate), Math.min(boxDepth(rotated), coordinate - 0.015));
      }
      if (depth * 1000 > depthMM) { depthMM = depth * 1000; meshName = mesh.parent?.parent?.name ?? "unknown"; worldPoint = point.clone().add(center).toArray(); }
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

type Metric = { handCubeMM:number; selfContainmentMM:number; handHandMM:number; handArmMM:number; crossArmMM:number; armCubeMM:number; reachErrorMM:number; contactErrorMM:number; jointLimitRadians:number; missingJoints:number; bodyFailures:number; supportFailures:number };
const zero = ():Metric => ({handCubeMM:0,selfContainmentMM:0,handHandMM:0,handArmMM:0,crossArmMM:0,armCubeMM:0,reachErrorMM:0,contactErrorMM:0,jointLimitRadians:0,missingJoints:0,bodyFailures:0,supportFailures:0});
function inspect(f:Frame, move?:Move) {
  apply(f);
  const metric=zero(), detail:Record<string,unknown>={}, contactRecords:any[]=[], validSupport:Vector3[]=[];
  for(const side of sides) {
    const cube=cubeDepth(bounds[side].map(b=>b.mesh),move,f.cubeAngle);
    if(cube.depthMM>metric.handCubeMM){metric.handCubeMM=cube.depthMM;detail.cube={side,...cube};}
    for(const [name,joint] of Object.entries(hands[side].robot.joints)) {
      if(joint.jointType==="fixed")continue;
      const value=f[side].joints[name];
      if(!Number.isFinite(value)){metric.missingJoints++;continue;}
      metric.jointLimitRadians=Math.max(metric.jointLimitRadians,value-joint.limit.upper,joint.limit.lower-value);
    }
    if(!coarse) {
      const self=selfDepth(side,f[side]);
      if(self.depthMM>metric.selfContainmentMM){metric.selfContainmentMM=self.depthMM;detail.self={side,...self};}
      const origin=new Vector3(side==="left"?-0.355:0.355,0.155,-0.09);
      metric.reachErrorMM=Math.max(metric.reachErrorMM,Math.abs(arms[side].elbowPosition.distanceTo(origin)-ARM_LENGTHS.upper)*1000,Math.abs(arms[side].elbowPosition.distanceTo(arms[side].wristPosition)-ARM_LENGTHS.fore)*1000);
    }
  }
  for(const contact of f.contacts) {
    const actual=hands[contact.side].robot.links[`${contact.side}_finger${contact.finger}_tip_link`].localToWorld(contact.padOffset.clone());
    const target=contact.point.clone();
    if(move&&contact.role==="drive")target.applyAxisAngle(new Vector3(...NORMALS[move.face]),f.cubeAngle);
    target.add(center);
    const errorMM=actual.distanceTo(target)*1000;
    let correctBody=true;
    if(move) {
      const coordinate=contact.point.dot(new Vector3(...NORMALS[move.face]));
      const layer=coordinate < -0.015 ? -1 : coordinate > 0.015 ? 1 : 0;
      const moving=(move.layers??[1]).includes(layer);
      correctBody=contact.role==="drive"?moving:!moving;
    }
    if(!correctBody)metric.bodyFailures++;
    if(errorMM>metric.contactErrorMM){metric.contactErrorMM=errorMM;detail.contact={side:contact.side,finger:contact.finger,role:contact.role,errorMM,correctBody,actual:actual.toArray(),target:target.toArray()};}
    if(contact.role==="support"&&correctBody&&errorMM<=thresholdMM)validSupport.push(actual);
    contactRecords.push({side:contact.side,finger:contact.finger,role:contact.role,errorMM,correctBody});
  }
  let area=0;
  for(let a=0;a<validSupport.length;a++)for(let b=a+1;b<validSupport.length;b++)for(let c=b+1;c<validSupport.length;c++)area=Math.max(area,validSupport[b].clone().sub(validSupport[a]).cross(validSupport[c].clone().sub(validSupport[a])).length()/2);
  if(area<=0.00015){metric.supportFailures++;detail.support={validContacts:validSupport.length,maxTriangleArea:area};}
  if(!coarse) {
    const mutual=pairDepth(bounds.left,bounds.right);metric.handHandMM=mutual.depthMM;
    if(mutual.depthMM>thresholdMM)detail.hands=mutual;
    for(const link of links) {
      for(const side of sides)for(const bound of bounds[side]) {
        const depth=intoArm(bound.mesh,link);
        if(depth>metric.handArmMM){metric.handArmMM=depth;detail.handArm={side,hand:bound.name,arm:link.side,part:link.part,depthMM:depth};}
      }
      for(const opposite of links.filter(l=>l.side!==link.side))for(const mesh of opposite.meshes)metric.crossArmMM=Math.max(metric.crossArmMM,intoArm(mesh,link));
      metric.armCubeMM=Math.max(metric.armCubeMM,cubeDepth(link.meshes,move,f.cubeAngle).depthMM);
    }
  }
  return {metric,detail,contacts:contactRecords};
}
function failed(metric:Metric) {
  return Object.entries(metric).filter(([key,value])=>key==="jointLimitRadians"?value>1e-7:/Failures$|missingJoints/.test(key)?value>0:value>thresholdMM).map(([key])=>key);
}
const filePaths=["src/scene/finger-program.ts","src/scene/finger-data.ts","src/scene/finger-library.json","src/scene/finger-paths.json","src/scene/arm.ts","src/core/finger-studies.ts"];
const sources=filePaths.map(path=>({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")}));
const studyResults:any[]=[], sampleCache=new Map<string,ReturnType<typeof inspect>>();
for(const study of FINGER_STUDIES.filter(s=>!studyFilter||s.id===studyFilter)) {
  const program=compileFingerProgram(parseAlgorithm(study.algorithm));
  const segments:any[]=[];
  for(let segmentIndex=0;segmentIndex<program.segments.length;segmentIndex++) {
    const segment=program.segments[segmentIndex];
    if(phaseExpression&&!phaseExpression.test(segment.phase))continue;
    const cubeMove=segment.stage==="TURN"?program.steps[segment.index].move:undefined;
    const maximum=zero(), failures:any[]=[], peaks:Record<string,unknown>={};
    for(let i=0;i<=divisions;i++) {
      const progress=i/divisions,f=convert(segment.sample(progress));
      const key=JSON.stringify({f,move:cubeMove?.notation??"static"});
      let measurement=sampleCache.get(key);
      if(!measurement){measurement=inspect(f,cubeMove);sampleCache.set(key,measurement);}
      const where={study:study.id,segmentIndex,stepIndex:segment.index,move:program.steps[segment.index].move.notation,stage:segment.stage,phase:segment.phase,active:segment.active,activeFinger:segment.finger,progress,time:segment.start+segment.duration*progress};
      for(const name of Object.keys(maximum) as (keyof Metric)[])if(measurement.metric[name]>maximum[name]){maximum[name]=measurement.metric[name];peaks[name]={...where,value:maximum[name],detail:measurement.detail};}
      const invalid=failed(measurement.metric);
      if(invalid.length)failures.push({...where,invalid,...measurement,frame:failures.length===0?f:undefined});
    }
    const result={segmentIndex,stepIndex:segment.index,move:program.steps[segment.index].move.notation,stage:segment.stage,phase:segment.phase,start:segment.start,duration:segment.duration,samples:divisions+1,passed:failures.length===0,maximum,peaks,failures};
    segments.push(result);
    if(!result.passed)console.log(JSON.stringify({study:study.id,segmentIndex,phase:segment.phase,maximum,first:failures[0]?.detail}));
  }
  const result={id:study.id,name:study.name,algorithm:study.algorithm,totalSegments:program.segments.length,checkedSegments:segments.length,passed:segments.every(s=>s.passed),segments};
  studyResults.push(result);
  console.log(JSON.stringify({study:study.id,passed:result.passed,checkedSegments:segments.length,failedSegments:segments.filter(s=>!s.passed).length}));
}
const label=arg("--label",`${mode}${studyFilter?"-"+studyFilter:""}${phaseFilter?"-focused":""}`);
const output=`evidence/finger-program-${label}.json`;
const result={date:new Date().toISOString(),mode,thresholdMM,samplesPerSegment:divisions+1,scope:coarse?"Coarse phase screening: full hand STL vertices vs cube and independent actual-URDF pad/support/body checks; self/interhand/arm checks deferred.":"All full hand vertices vs cube; different-finger and interhand bidirectional vertex containment; upper/forearm solid/reach checks; independent actual-URDF pad/support/body checks.",sources,assetsSHA256:assetHasher.digest("hex"),scriptSHA256:createHash("sha256").update(readFileSync("scripts/inspect-finger-program.ts")).digest("hex"),passed:studyResults.every(s=>s.passed),studies:studyResults,uniqueSampleStates:sampleCache.size,limitations:["Moving-layer cube/contact-body checks apply only to TURN; PREPARE/HOLD use aligned static cube geometry.","Stored contacts are checked individually against actual URDFLoader FK; support requires three non-collinear contacts with area >0.00015 m2.","Same-finger adjacent joints and intentional hand/wrist attachments are excluded from self tests.","Sampled vertices and containment are not continuous triangle intersection, force closure or hardware proof."]};
writeFileSync(output,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({output,passed:result.passed,uniqueSampleStates:sampleCache.size}));
if(!result.passed)process.exitCode=1;
