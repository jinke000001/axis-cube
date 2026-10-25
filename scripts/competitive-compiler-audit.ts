/** Independent production recorded/assembly compiler audit; evidence only. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DOMParser, Document, Element } from "linkedom";
import { Box3, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Ray, Triangle, Vector3 } from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { DexterousHand } from "../src/scene/hand";
import { MechanicalArm, ARM_LENGTHS } from "../src/scene/arm";
import { compileFingerProgram } from "../src/scene/finger-program";
import { CubeModel } from "../src/scene/cube-model";
import { NORMALS, parseMove, moveAngle, parseAlgorithm, applyAlgorithm, snapshots, SOLVED, DEFAULT_PALETTE, type Move } from "../src/core/cube";
import { hasMeasuredSupport, measureContact, type FingerContact } from "../src/scene/finger-contact";
import { compileCompetitiveRotation } from "../src/scene/competitive-rotations";
import { compileRecordedFingerMove, type RecordedFingerPrimitive } from "../src/scene/recorded-finger-program";
import { assembleFingerPrograms, sameHandPose } from "../src/scene/finger-program-assembly";
import { compileDirectFingerProgram } from "../src/scene/finger-direct-program";
import { handPose, fingerLibrary } from "../src/scene/finger-data";
import type { FingerProgram, FingerSegment } from "../src/scene/finger-program";
import type { MotionFrame } from "../src/scene/motion";
import { retimeFingerProgram } from "../src/scene/finger-cadence";

type Side = "left" | "right";
type Pose = { position: number[]; quaternion: number[]; joints: Record<string, number> };
type Frame = { cubeAngle: number; left: Pose; right: Pose; contacts: FingerContact[] };
const sides: Side[] = ["left", "right"], center = new Vector3(0, 0.34, 0), axisY = new Vector3(0, 1, 0);
const q = (a: number[]) => new Quaternion(...a as [number, number, number, number]);
const v = (a: number[]) => new Vector3(...a as [number, number, number]);
const clone = <T>(value:T):T => structuredClone(value);
const arg = (name:string, fallback="") => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const mode=arg("--mode","y"),coarse=false,divisions=128,thresholdMM=.3;
if(!["y","quick","contracts","thumb","down","mixed"].includes(mode))throw new Error("Unsupported audit scope");
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
        depth = move?.kind === "rotation" ? boxDepth(rotated) : Math.max(Math.min(depth, 0.015 - coordinate), Math.min(boxDepth(rotated), coordinate - 0.015));
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

type Metric = { handCubeMM:number; selfContainmentMM:number; handHandMM:number; handArmMM:number; crossArmMM:number; armCubeMM:number; reachErrorMM:number; contactErrorMM:number; jointLimitRadians:number; missingJoints:number; bodyFailures:number; supportFailures:number; fkContactErrorMM:number; fkUrdfDifferenceMM:number; fkSupportFailures:number };
const zero = ():Metric => ({handCubeMM:0,selfContainmentMM:0,handHandMM:0,handArmMM:0,crossArmMM:0,armCubeMM:0,reachErrorMM:0,contactErrorMM:0,jointLimitRadians:0,missingJoints:0,bodyFailures:0,supportFailures:0,fkContactErrorMM:0,fkUrdfDifferenceMM:0,fkSupportFailures:0});
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
    let correctBody=contact.role==="support";
    if(move) {
      const coordinate=contact.point.dot(new Vector3(...NORMALS[move.face]));
      const layer=coordinate < -0.015 ? -1 : coordinate > 0.015 ? 1 : 0;
      const moving=(move.layers??[1]).includes(layer);
      correctBody=contact.role==="drive"?moving:!moving;
    }
    if(!correctBody)metric.bodyFailures++;
    if(errorMM>metric.contactErrorMM){metric.contactErrorMM=errorMM;detail.contact={side:contact.side,finger:contact.finger,role:contact.role,errorMM,correctBody,actual:actual.toArray(),target:target.toArray()};}
    const measured=measureContact(handPose(f[contact.side]),contact,move,f.cubeAngle);
    metric.fkContactErrorMM=Math.max(metric.fkContactErrorMM,measured.error*1000);
    metric.fkUrdfDifferenceMM=Math.max(metric.fkUrdfDifferenceMM,measured.actual.distanceTo(actual)*1000);
    if((contact.role==="support"||move?.kind==="rotation")&&correctBody&&errorMM<=thresholdMM)validSupport.push(actual);
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
  const live={left:handPose(f.left),right:handPose(f.right)};
  if(!hasMeasuredSupport(live,f.contacts,move,f.cubeAngle))metric.fkSupportFailures++;
  return {metric,detail,contacts:contactRecords,actualSupportAreaM2:area};
}
function failed(metric:Metric) {
  return Object.entries(metric).filter(([key,value])=>key==="jointLimitRadians"?value>1e-7:/Failures$|missingJoints/.test(key)?value>0:value>thresholdMM).map(([key])=>key);
}

const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const sourcePaths=["scripts/competitive-compiler-audit.ts","src/scene/recorded-finger-program.ts","src/scene/finger-program-assembly.ts",
  ...(["thumb","down"].includes(mode)?[]:["src/scene/competitive-rotations.ts"]),"src/scene/competitive-rotations.json","src/scene/finger-direct-program.ts","src/scene/finger-direct.json",
  "src/scene/finger-program.ts","src/scene/finger-data.ts","src/scene/finger-library.json","src/scene/finger-paths.json",
  "src/scene/finger-rig.ts","src/scene/finger-rig.json","src/scene/finger-contact.ts","src/scene/arm.ts","src/scene/hand.ts",
  "src/scene/motion.ts","src/scene/cube-model.ts","src/core/cube.ts","evidence/competitive-rotation-primitives.json",
  ...(mode==="thumb"?["evidence/competitive-thumb-primitives.json"]:mode==="down"?["evidence/competitive-down-primitives.json"]:mode==="mixed"?
    ["src/scene/competitive-program.ts","src/scene/competitive-library.ts","src/scene/competitive-library.json","src/scene/finger-cadence.ts",
      "src/core/reorientation-plan.ts","src/core/execution-moves.ts","evidence/competitive-thumb-primitives.json","evidence/competitive-down-primitives.json"]:[])];
const sources=sourcePaths.map(path=>({path,sha256:sha(path)})),assetSHA256=assetHasher.digest("hex");
const productionData=JSON.parse(readFileSync("src/scene/competitive-rotations.json","utf8"));
const acceptedData=JSON.parse(readFileSync("evidence/competitive-rotation-primitives.json","utf8"));
const calibratedDataReuse={samePrimitiveTables:JSON.stringify(productionData.primitives)===JSON.stringify(acceptedData.primitives),
  sourceEvidenceMatches:sha(productionData.sourcePath)===productionData.sourceSHA256,assetsMatch:productionData.assetSHA256===assetSHA256,
  note:"Raw tables and assets match prior STL acceptance. Production eased samples are nevertheless checked anew below; FK is not substituted for STL."};

function poseGap(a:any,b:any) {
  return {positionMM:Math.max(a.left.position.distanceTo(b.left.position),a.right.position.distanceTo(b.right.position))*1000,
    quaternionRadians:Math.max(a.left.quaternion.angleTo(b.left.quaternion),a.right.quaternion.angleTo(b.right.quaternion)),
    jointRadians:Math.max(0,...sides.flatMap(side=>Object.keys(a[side].joints??{}).map(k=>Math.abs(a[side].joints[k]-b[side].joints[k]))))};
}
const samePose=(a:any,b:any)=>{const d=poseGap(a,b);return d.positionMM<1e-6&&d.quaternionRadians<1e-7&&d.jointRadians<1e-8;};
const signatures=(frame:MotionFrame)=>JSON.stringify({index:frame.index,stage:frame.stage,phase:frame.phase,active:frame.active,support:frame.support,
  activeFinger:frame.activeFinger,complete:frame.complete,progress:frame.progress,angle:frame.angle,orientation:frame.orientation.toArray(),...convert(frame)});
const cube=new CubeModel();
function rendered(state:string,move:Move|undefined,angle:number,orientation=new Quaternion()) {
  cube.update(state,DEFAULT_PALETTE,orientation,move,angle);cube.root.updateMatrixWorld(true);const visible:string[]=[];
  cube.root.traverse(node=>{if(node instanceof Mesh&&node.name.startsWith("sticker-"))visible.push(node.getWorldPosition(new Vector3()).toArray().map(x=>Math.round(x*1e5)).join(",")+":"+(node.material as MeshStandardMaterial).color.getHexString());});
  return visible.sort();
}
function boundaries(program:FingerProgram) {
  const failures:any[]=[],seams:any[]=[],moves=program.steps.map(s=>s.move),initial=applyAlgorithm(SOLVED,"R U2 F' L D B2 R' F2 U L2 D' B R2 U' F"),states=snapshots(initial,moves);
  for(let i=1;i<program.segments.length;i++) {
    const a=program.segments[i-1],b=program.segments[i],gap=poseGap(a.sample(1),b.sample(0));
    seams.push({from:i-1,to:i,stepCommit:a.index!==b.index,...gap});
    if(!samePose(a.sample(1),b.sample(0)))failures.push({kind:"pose seam",from:i-1,to:i,gap});
  }
  const commits=program.steps.map((step,i)=>{
    const end=i+1<program.steps.length?program.steps[i+1].start:program.duration;
    const before=program.sample(end-1e-10),after=program.sample(end);
    const a=rendered(states[before.index],moves[before.index],before.angle,before.orientation),b=rendered(states[after.index],moves[after.index],after.angle,after.orientation);
    const passed=a.length===54&&JSON.stringify(a)===JSON.stringify(b)&&before.index===i&&after.index===i+1;
    if(!passed)failures.push({kind:"54 sticker commit",index:i,notation:step.move.notation,beforeIndex:before.index,afterIndex:after.index});
    return {index:i,notation:step.move.notation,passed,beforeAngle:before.angle,expectedAngle:moveAngle(step.move)};
  });
  const times=[0,.01,.37,1.1,2.4,3.9,program.duration-1e-9,program.duration],before=times.map(t=>signatures(program.sample(t)));
  for(const i of [7,3,0,6,1,5,2,4])if(signatures(program.sample(times[i]))!==before[i])failures.push({kind:"history dependent seek",time:times[i]});
  const low={left:handPose(fingerLibrary.hands.left.support),right:handPose(fingerLibrary.hands.right.support)};
  const final=program.sample(program.duration);
  const canonicalLow=samePose(final,low);
  if(!canonicalLow)failures.push({kind:"terminal low",gap:poseGap(final,low)});
  return {passed:!failures.length,seams,commits,canonicalLow,deterministicSeekSamples:times.length,failures};
}
const geometryCache=new Map<string,ReturnType<typeof inspect>>();
function geometryAt(frame:MotionFrame,moves:Move[]) {
  if(frame.orientation.angleTo(new Quaternion())>1e-7)throw new Error("Audit expects the current compiler's identity render frame contract");
  const move=frame.stage==="TURN"&&!frame.complete?moves[frame.index]:undefined,f=convert(frame),key=JSON.stringify({f,move});
  if(!geometryCache.has(key))geometryCache.set(key,inspect(f,move));
  return geometryCache.get(key)!;
}
function auditGeometry(id:string,program:FingerProgram,turnsOnly=false) {
  const maximum=zero(),segments:any[]=[],failures:any[]=[],moves=program.steps.map(s=>s.move);let checked=0,minimumSupportAreaM2=Infinity;
  for(const [si,segment]of program.segments.entries()) {
    if(turnsOnly&&segment.stage!=="TURN")continue;
    const local=zero();let count=0;
    // 129 samples at k/128 plus all 128 progress midpoints: actual public sampler.
    for(let i=0;i<=2*divisions;i++) {
      const p=i/(2*divisions),time=segment.start+segment.duration*p,frame=program.sample(time),result=geometryAt(frame,moves);checked++;count++;
      minimumSupportAreaM2=Math.min(minimumSupportAreaM2,result.actualSupportAreaM2);
      for(const k of Object.keys(maximum)as(keyof Metric)[]){maximum[k]=Math.max(maximum[k],result.metric[k]);local[k]=Math.max(local[k],result.metric[k]);}
      const invalid=failed(result.metric);
      if(invalid.length){failures.push({segment:si,phase:segment.phase,progress:p,publicPhase:frame.phase,publicStage:frame.stage,invalid,...result});break;}
      if(p<1&&frame.index!==segment.index)failures.push({segment:si,progress:p,reason:"public step mismatch",actual:frame.index,expected:segment.index});
    }
    segments.push({index:si,phase:segment.phase,stage:segment.stage,checked:count,maximum:local});
    console.log(JSON.stringify({id,segment:si,phase:segment.phase,checked:count,passed:!failures.length,maximum:local}));
    if(failures.length)break;
  }
  let seamGeometryChecks=0;
  if(turnsOnly)for(const segment of program.segments)for(const time of [segment.start,Math.min(program.duration,segment.start+segment.duration-1e-10)]) {
    const frame=program.sample(time),result=geometryAt(frame,moves);seamGeometryChecks++;
    for(const k of Object.keys(maximum)as(keyof Metric)[])maximum[k]=Math.max(maximum[k],result.metric[k]);
    const invalid=failed(result.metric);if(invalid.length)failures.push({reason:"actual compiled seam geometry",time,phase:frame.phase,invalid,...result});
  }
  const seamCheck=boundaries(program);
  return {id,passed:!failures.length&&seamCheck.passed,checked,seamGeometryChecks,maximum,minimumSupportAreaM2,segments,seamCheck,failures};
}

// A real source table is used for each negative control; only the intended
// contract violation changes. These controls do not count as valid geometry.
function primitiveFromSource():RecordedFingerPrimitive {
  return {notation:"y",rotationContactsInEntryFrame:true,segments:structuredClone(productionData.primitives.y).map((s:any)=>({
    ...s,stage:s.frames.some((f:any)=>f.turning)?"TURN":"PREPARE",active:s.id.startsWith("right")?"right":"left",
  }))};
}
function rejected(action:()=>unknown){try{action();return false;}catch{return true;}}
function contractControls() {
  const start=primitiveFromSource(),wrongEnd=primitiveFromSource();
  wrongEnd.segments.at(-1)!.frames.at(-1)!.cubeAngle=0;
  const extra=primitiveFromSource(),segment=extra.segments[0],added=structuredClone(segment.frames[0].contacts[0]);
  // Distinct actual left low contact, added only to the last frame of a segment.
  const original=fingerLibrary.hands.left.contacts[0];
  Object.assign(added,{...original,side:"left",role:"support"});segment.frames.at(-1)!.contacts.push(added);
  const missing=primitiveFromSource();missing.segments[0].frames.at(-1)!.contacts.pop();
  const sampleAll=(p:RecordedFingerPrimitive)=>{const program=compileRecordedFingerMove(parseMove("y"),p);for(const s of program.segments)for(let i=0;i<=128;i++)s.sample(i/128);};
  return {validRecordAccepted:!rejected(()=>sampleAll(start)),notationMismatchRejected:rejected(()=>compileRecordedFingerMove(parseMove("y'"),start)),
    incompleteAngleRejected:rejected(()=>compileRecordedFingerMove(parseMove("y"),wrongEnd)),
    removedContactInsideSegmentRejected:rejected(()=>sampleAll(missing)),addedContactInsideSegmentRejected:rejected(()=>sampleAll(extra)),
    removedContactRejectedAtCompile:rejected(()=>compileRecordedFingerMove(parseMove("y"),missing)),
    addedContactRejectedAtCompile:rejected(()=>compileRecordedFingerMove(parseMove("y"),extra))};
}
const controls=contractControls();
function geometryFingerprint(program:FingerProgram) {
  const hash=createHash("sha256");
  for(const segment of program.segments)for(let i=0;i<=256;i++) {
    const frame=segment.sample(i/256);
    const hand=(side:Side)=>[frame[side].position.toArray(),frame[side].quaternion.toArray(),Object.entries(frame[side].joints??{}).sort(([a],[b])=>a.localeCompare(b))];
    hash.update(JSON.stringify([segment.stage,segment.active,segment.finger,hand("left"),hand("right"),frame.angle,
      frame.contacts.map(c=>[c.side,c.finger,c.role,c.point.toArray(),c.normal.toArray(),c.padOffset.toArray()])],
      (_key,value)=>typeof value==="number"&&Object.is(value,-0)?"-0":value));
  }
  return hash.digest("hex");
}
const primitivePrograms:{id:string;program:FingerProgram}[]=[],assemblyDefinitions:{id:string;blocks:FingerProgram[];program?:FingerProgram}[]=[],additionalProvenance:any[]=[];
let packedLibraryCheck:any;
if(mode==="mixed") {
  const {compileCompetitiveExecution}=await import("../src/scene/competitive-program");
  const {getCompetitivePrimitives}=await import("../src/scene/competitive-library");
  const thumb=JSON.parse(readFileSync("evidence/competitive-thumb-primitives.json","utf8"));
  const down=JSON.parse(readFileSync("evidence/competitive-down-primitives.json","utf8"));
  const originals:RecordedFingerPrimitive[]=[...thumb.variants,...down.primitives,...Object.entries(acceptedData.primitives).map(([notation,value])=>({
    notation,rotationContactsInEntryFrame:true,segments:(value as any[]).map(s=>({ ...s,
      stage:s.frames.some((f:any)=>f.turning)?"TURN":"PREPARE",active:s.frames.some((f:any)=>f.turning)?s.frames.find((f:any)=>f.turning).contacts.find((c:any)=>c.role==="drive").side:s.id.startsWith("right")?"right":"left",
    })),
  }))];
  const checks=[];
  for(const notation of [...new Set(originals.map(p=>p.notation))]) {
    const source=originals.filter(p=>p.notation===notation).map(p=>geometryFingerprint(compileRecordedFingerMove(parseMove(notation),p))).sort();
    const packed=getCompetitivePrimitives(notation).map(p=>geometryFingerprint(compileRecordedFingerMove(parseMove(notation),p))).sort();
    checks.push({notation,sourceVariants:source.length,packedVariants:packed.length,source,packed,passed:JSON.stringify(source)===JSON.stringify(packed)});
  }
  packedLibraryCheck={passed:checks.every(c=>c.passed),checks,scope:"Actual compiled samplers for all 10 raw vs packed variants at 257 points/segment; poses, sorted joint values, contacts, angle, stage, active and finger all enter the exact hash."};
  const algorithm="F F' D2 D2' U2 y R U R' y' F D2",program=compileCompetitiveExecution(parseAlgorithm(algorithm)),retimed=retimeFingerProgram(program);
  primitivePrograms.push({id:"mixed-production",program},{id:"mixed-production-retimed",program:retimed});
  assemblyDefinitions.push({id:"mixed-production",blocks:[program],program},{id:"mixed-production-retimed",blocks:[retimed],program:retimed});
  additionalProvenance.push({algorithm,steps:program.steps.map(s=>s.move.notation),removedSegments:program.removedSegments,
    actualTurnFingers:[...new Set(program.segments.filter(s=>s.stage==="TURN"&&s.finger).map(s=>s.finger))].sort(),
    actualRotationTurns:program.segments.filter(s=>s.stage==="TURN"&&program.steps[s.index].move.kind==="rotation").length});
} else if(mode==="thumb") {
  const thumb=JSON.parse(readFileSync("evidence/competitive-thumb-primitives.json","utf8"));
  for(const variant of thumb.variants) {
    if(sha(variant.source.path)!==variant.source.sha256)throw new Error(`Thumb source changed: ${variant.source.path}`);
    additionalProvenance.push(variant.source);
    primitivePrograms.push({id:variant.id,program:compileRecordedFingerMove(parseMove(variant.notation),variant)});
  }
  assemblyDefinitions.push({id:"left-thumb-forward-reverse-retained",blocks:[primitivePrograms[0].program,primitivePrograms[2].program]},
    {id:"right-thumb-forward-reverse-retained",blocks:[primitivePrograms[1].program,primitivePrograms[3].program]});
} else if(mode==="down") {
  const down=JSON.parse(readFileSync("evidence/competitive-down-primitives.json","utf8"));
  for(const input of down.sourceHashes)if(sha(input.path)!==input.sha256)throw new Error(`Down source changed: ${input.path}`);
  additionalProvenance.push(...down.sourceHashes);
  for(const variant of down.primitives)primitivePrograms.push({id:`down-${variant.notation}`,program:compileRecordedFingerMove(parseMove(variant.notation),variant)});
  assemblyDefinitions.push({id:"down-ring-and-little-retained",blocks:primitivePrograms.map(p=>p.program)});
} else {
  const y=compileCompetitiveRotation(parseMove("y")),yp=compileCompetitiveRotation(parseMove("y'"));
  primitivePrograms.push({id:"production-y",program:y},{id:"production-y-prime",program:yp});
  assemblyDefinitions.push({id:"rotation-family-seams",blocks:[y,compileFingerProgram(parseAlgorithm("R U R'")),yp,compileDirectFingerProgram(parseAlgorithm("F F F'"))]},
    {id:"retained-front-grip",blocks:[compileDirectFingerProgram(parseAlgorithm("F F F'"))]});
}
const assemblyCases=assemblyDefinitions.map(({id,blocks,program:provided})=>{
  const program=provided??assembleFingerPrograms(blocks,5,true),sourceSamplers=new Set(blocks.flatMap(p=>p.segments.map(s=>s.sample)));
  const check=boundaries(program),moves=program.steps.map(s=>s.move),contactFailures:any[]=[];let sampled=0;
  for(const [si,s]of program.segments.entries())for(let i=0;i<=256;i++){
    const time=s.start+s.duration*i/256,frame=program.sample(time),move=frame.stage==="TURN"&&!frame.complete?moves[frame.index]:undefined;sampled++;
    for(const c of frame.contacts??[])if(measureContact(frame[c.side],c,move,frame.angle,frame.orientation).error*1000>thresholdMM)contactFailures.push({si,i,side:c.side,finger:c.finger});
    if(!hasMeasuredSupport(frame,frame.contacts??[],move,frame.angle,frame.orientation))contactFailures.push({si,i,reason:"support"});
  }
  return {id,passed:check.passed&&!contactFailures.length,steps:moves.map(m=>m.notation),removedSegments:program.removedSegments,
    seamCheck:check,fkContactSamples:sampled,contactFailures:contactFailures.slice(0,8),sourceSamplerIdentityReused:program.segments.filter(s=>sourceSamplers.has(s.sample)).length,
    note:"Assembly interior checks here are FK/contact and callback-identity reuse, not new STL proof. New y primitive samplers receive the full actual-STL sweep separately."};
});
const geometry=["quick","contracts"].includes(mode)?[]:primitivePrograms.map(({id,program})=>auditGeometry(id,program,mode==="mixed"));
const findings:any[]=[];
if(!controls.addedContactInsideSegmentRejected)findings.push({severity:"contract-gap",file:"src/scene/recorded-finger-program.ts",reason:"An extra contact only in the next/last frame is silently ignored until it becomes a current frame; a.contacts.map checks missing/changed indexed contacts but not length equality.",scope:"Synthetic invalid record; current y/y-prime data has no in-segment contact cardinality changes."});
const changedSources=sources.filter(s=>sha(s.path)!==s.sha256),outputPath=`evidence/competitive-compiler-${mode}.json`;
const productionCasesPassed=Object.values(calibratedDataReuse).every(v=>v!==false)&&assemblyCases.every(c=>c.passed)&&geometry.every(c=>c.passed)&&(!packedLibraryCheck||packedLibraryCheck.passed);
const codeContractPassed=Object.values(controls).every(Boolean);
const result={date:new Date().toISOString(),mode,sources,changedSources,assetSHA256,calibratedDataReuse,packedLibraryCheck,controls,findings,assemblyCases,geometry,additionalProvenance,productionCasesPassed,codeContractPassed,
  passed:!changedSources.length&&productionCasesPassed&&codeContractPassed,
  sampling:mode==="mixed"?"Actual mixed production and retimed TURN samplers: 129 frames at p=k/128 plus 128 interleaved progress midpoints, plus actual segment start/end seam geometry. Every segment also has the full FK/support grid. Packed variants match raw compiled geometry fingerprints; no full interior STL re-sweep of previously accepted PREPARE paths.":"Every recorded primitive segment: 129 actual public sampler frames at p=k/128 plus 128 interleaved progress midpoints. Geometry uses actual URDFLoader STL meshes and arm proxies; exported-record grid acceptance is not used as a substitute.",
  limitations:[mode==="thumb"?"Four thumb variants use the current compileRecordedFingerMove directly; packed import equality is checked separately in mixed mode.":mode==="down"?"Four down variants use the current compileRecordedFingerMove directly; packed import equality is checked separately in mixed mode.":mode==="mixed"?"One bounded mixed formula covers thumb/index/middle/ring/little, explicit y/y-prime, retained seams and the production retimer. It is not an exhaustive arbitrary-formula or full-solver acceptance.":"Current y/y-prime primitive consumer and bounded assembly examples only; other modes have separate results.","FK support/contacts and full STL/arm checks are reported separately; assembly callback identity reuses existing paths and does not claim a fresh full STL sweep for old R/U/F primitives.","Mesh vertex containment and existing arm solids are sampled checks, not continuous triangle intersections, physical force closure, actuator limits or browser fluidity."]};
writeFileSync(outputPath,JSON.stringify(result,null,2)+"\n");cube.dispose();
console.log(JSON.stringify({outputPath,passed:result.passed,controls,findings,changedSources,geometry:geometry.map(({id,passed,checked,maximum})=>({id,passed,checked,maximum}))}));
if(!result.passed)process.exitCode=1;

