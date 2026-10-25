/** Independent mesh acceptance of the actual complete solve compiler.
 * Writes only evidence/finger-solve-*; does not change application code or the UR inspector.
 */
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
import { compileFingerSolve } from "../src/scene/finger-solve-program";
import { solveCFOP } from "../src/core/cfop";
import { CubeModel } from "../src/scene/cube-model";
import { NORMALS, parseAlgorithm, applyAlgorithm, snapshots, SOLVED, DEFAULT_PALETTE, type Move } from "../src/core/cube";
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

const filePaths=["src/scene/finger-program.ts","src/scene/finger-face-program.ts","src/scene/finger-solve-program.ts","src/scene/finger-data.ts","src/scene/finger-library.json","src/scene/finger-paths.json","src/scene/finger-faces.json","src/scene/finger-contact.ts","src/scene/arm.ts","src/scene/hand.ts","src/scene/finger-rig.ts","src/scene/finger-rig.json","src/scene/cube-model.ts","src/core/cube.ts","src/core/cfop.ts","src/core/cfop-state.ts"];
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
filePaths.push("src/scene/finger-direct-program.ts","src/scene/finger-direct.json");
const sources=filePaths.map(path=>({path,sha256:sha(path)})),assetsSHA256=assetHasher.copy().digest("hex");
const priorPath="evidence/finger-program-full.json",prior=JSON.parse(readFileSync(priorPath,"utf8"));
const programText=readFileSync("src/scene/finger-program.ts","utf8");
const geometryEquivalentText=programText.replace("  /** Relative duration before fitting the score to the presentation clock. */\n  cost: number;\n","").replace(",cost:total,sample",",sample");
const priorProgramHash=prior.sources.find((s:any)=>s.path==="src/scene/finger-program.ts")?.sha256;
const exactProgram=sha("src/scene/finger-program.ts")===priorProgramHash;
const costOnlyEquivalent=createHash("sha256").update(geometryEquivalentText).digest("hex")===priorProgramHash;
const otherPriorSources=prior.sources.filter((s:any)=>s.path!=="src/scene/finger-program.ts"&&s.path!=="src/core/finger-studies.ts");
const reuseEligible=mode==="full"&&prior.passed&&prior.samplesPerSegment===129&&(exactProgram||costOnlyEquivalent)&&prior.assetsSHA256===assetsSHA256&&otherPriorSources.every((s:any)=>sha(s.path)===s.sha256);
const reuse={eligible:reuseEligible,source:priorPath,sha256:sha(priorPath),exactProgram,costOnlyEquivalent,priorProgramHash,currentProgramHash:sha("src/scene/finger-program.ts"),proof:"If costOnlyEquivalent is true, deleting only the new cost interface comment/field and returned cost:total reproduces the prior source SHA-256 exactly; every geometry statement is unchanged. Reuse additionally requires unchanged data/arm/assets and an exact 129-sample geometry/contact fingerprint per segment.",matchedSegments:0,uniquePriorSegments:0};
function keyOf(f:Frame,move?:Move) {
  // PREPARE/HOLD have an aligned stationary cube. Their stored accumulated
  // angle has no effect on geometry or contacts and is intentionally ignored.
  return JSON.stringify({f:move?f:{...f,cubeAngle:0},move:move?{face:move.face,layers:move.layers??[1]}:null});
}
function segmentKey(segment:any,move?:Move) {
  const h=createHash("sha256");
  for(let i=0;i<=128;i++)h.update(keyOf(convert(segment.sample(i/128)),move));
  return h.digest("hex");
}
const priorSegments=new Map<string,any>();
if(reuseEligible) for(const study of prior.studies) {
  const program=compileFingerProgram(parseAlgorithm(study.algorithm));
  for(const result of study.segments) {
    if(!result.passed)continue;
    const segment=program.segments[result.segmentIndex],move=segment.stage==="TURN"?program.steps[segment.index].move:undefined;
    priorSegments.set(segmentKey(segment,move),{sourceStudy:study.id,sourceSegment:result.segmentIndex,maximum:result.maximum,samples:129});
  }
}
reuse.uniquePriorSegments=priorSegments.size;
console.log(JSON.stringify({reuse}));
const seeded=applyAlgorithm(SOLVED,"R U2 F' L D B2 R' F2 U L2 D' B R2 U' F");
const observedCandidates=new Map<string,{frame:number;lastAlgorithm:string;lastCost:number;calls:number}>();
const plan=solveCFOP(seeded,{gestureCost:(algorithm)=>{
  const cost=compileFingerSolve(parseAlgorithm(algorithm)).cost,key=algorithm.replace(/2'/g,"2");
  const record=observedCandidates.get(key)??{frame:observedCandidates.size,lastAlgorithm:"",lastCost:0,calls:0};
  record.lastAlgorithm=algorithm;record.lastCost=cost;record.calls++;observedCandidates.set(key,record);return cost;
}});
const allStudies=[
  {id:"f-family",algorithm:"F F' F2 F2'",state:SOLVED},
  {id:"d-family",algorithm:"D D' D2 D2'",state:SOLVED},
  {id:"b-family",algorithm:"B B' B2 B2'",state:SOLVED},
  {id:"mixed",algorithm:"F B F' B' D2 R U R' U' F2",state:SOLVED},
  {id:"demo-cfop",algorithm:plan.solution,state:seeded,phases:plan.phases.map(({name,start,end})=>({name,start,end})),score:plan.score,selectedFrame:plan.selectedFrame},
];
function poseDistance(a:Frame,b:Frame) {
  let positionMM=0,quaternionRadians=0,jointRadians=0;
  for(const side of sides) {
    positionMM=Math.max(positionMM,v(a[side].position).distanceTo(v(b[side].position))*1000);
    quaternionRadians=Math.max(quaternionRadians,q(a[side].quaternion).angleTo(q(b[side].quaternion)));
    for(const name of Object.keys(a[side].joints))jointRadians=Math.max(jointRadians,Math.abs(a[side].joints[name]-b[side].joints[name]));
  }
  return {positionMM,quaternionRadians,jointRadians};
}
const renderedCube=new CubeModel();
function stickerState(state:string,move:Move|undefined,angle:number) {
  renderedCube.update(state,DEFAULT_PALETTE,new Quaternion(),move,angle); renderedCube.root.updateMatrixWorld(true);
  const stickers:string[]=[];
  renderedCube.root.traverse((node)=>{if(node instanceof Mesh&&node.name.startsWith("sticker-"))stickers.push(node.getWorldPosition(new Vector3()).toArray().map(n=>Math.round(n*1e6)).join(",")+":"+(node.material as MeshStandardMaterial).color.getHexString());});
  return stickers.sort().join("|");
}
function checkBoundaries(program:any,moves:Move[],states:string[]) {
  const failures:any[]=[],maximum={positionMM:0,quaternionRadians:0,jointRadians:0},samplerFailures:any[]=[],angleFailures:any[]=[];
  for(let i=0;i<program.segments.length;i++) {
    const segment=program.segments[i];
    if(i) {
      const prev=program.segments[i-1],a=convert(prev.sample(1)),b=convert(segment.sample(0)),delta=poseDistance(a,b);
      for(const k of Object.keys(maximum) as (keyof typeof maximum)[])maximum[k]=Math.max(maximum[k],delta[k]);
      const cubeContinuous=stickerState(states[prev.index],moves[prev.index],a.cubeAngle)===stickerState(states[segment.index],moves[segment.index],b.cubeAngle);
      if(delta.positionMM>1e-4||delta.quaternionRadians>1e-6||delta.jointRadians>1e-7||!cubeContinuous)failures.push({segmentIndex:i,from:prev.phase,to:segment.phase,indices:[prev.index,segment.index],delta,cubeContinuous});
    }
    for(const p of [0,.125,.5,.875,1]) {
      const expected=convert(segment.sample(p)),t=segment.start+segment.duration*p,observed=program.sample(t),delta=poseDistance(expected,convert(observed));
      const publicCubeMatches=stickerState(states[Math.min(observed.index,states.length-1)],moves[observed.index],observed.angle)===stickerState(states[segment.index],moves[segment.index],expected.cubeAngle);
      const interior=p>0&&p<1,indexMatches=!interior||observed.index===segment.index,stageMatches=!interior||observed.stage===segment.stage,angleMatches=!interior||Math.abs(observed.angle-expected.cubeAngle)<1e-8;
      if(delta.positionMM>1e-4||delta.quaternionRadians>1e-6||delta.jointRadians>1e-7||observed.orientation.angleTo(new Quaternion())>1e-8||!publicCubeMatches||!indexMatches||!stageMatches||!angleMatches)samplerFailures.push({segmentIndex:i,phase:segment.phase,progress:p,time:t,delta,orientation:observed.orientation.toArray(),publicCubeMatches,indexMatches,stageMatches,angleMatches});
      if(segment.stage!=="TURN"&&Math.abs(expected.cubeAngle/(Math.PI/2)-Math.round(expected.cubeAngle/(Math.PI/2)))>1e-8)angleFailures.push({segmentIndex:i,phase:segment.phase,progress:p,angle:expected.cubeAngle});
    }
  }
  const end=program.sample(program.duration),complete=end.complete&&end.index===moves.length&&end.orientation.angleTo(new Quaternion())<1e-8;
  const endCube=stickerState(states[Math.min(end.index,states.length-1)],moves[end.index],end.angle)===stickerState(states.at(-1)!,undefined,0);
  if(!complete||!endCube)samplerFailures.push({end:true,complete,index:end.index,expectedIndex:moves.length,endCube});
  return {passed:!failures.length&&!samplerFailures.length&&!angleFailures.length,maximum,failures,samplerFailures,angleFailures,endIndex:end.index,checkedBoundaries:Math.max(0,program.segments.length-1)};
}

if(mode==="timing") {
  const median=(xs:number[])=>{const a=[...xs].sort((a,b)=>a-b),m=(a.length-1)/2;return(a[Math.floor(m)]+a[Math.ceil(m)])/2;};
  const p90=(xs:number[])=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*.9)-1)];
  function timedRecord(id:string,algorithm:string,extra:Record<string,unknown>={}) {
    const moves=parseAlgorithm(algorithm),program=compileFingerSolve(moves,5),turns=program.segments.map((s,index)=>({...s,segmentIndex:index})).filter(s=>s.stage==="TURN");
    const byHz:any={};
    for(const hz of [60,120]) {
      const counts=new Map(turns.map(s=>[s.segmentIndex,0])),delta:{left:number[];right:number[];either:number[]}={left:[],right:[],either:[]};
      let previous:any=null,segmentIndex=0;
      for(let k=0;k<=5*hz;k++) {
        const t=k/hz,frame=program.sample(t);
        while(segmentIndex+1<program.segments.length&&program.segments[segmentIndex+1].start<=t)segmentIndex++;
        const s=program.segments[segmentIndex];
        if(frame.stage==="TURN"&&frame.progress>1e-8&&frame.progress<1-1e-8&&s.stage==="TURN")counts.set(segmentIndex,(counts.get(segmentIndex)??0)+1);
        if(previous) {
          const left=frame.left.position.distanceTo(previous.left.position)*1000,right=frame.right.position.distanceTo(previous.right.position)*1000;
          delta.left.push(left);delta.right.push(right);delta.either.push(Math.max(left,right));
        }
        previous=frame;
      }
      const values=turns.map(s=>counts.get(s.segmentIndex)??0),moveCounts=moves.map((_,index)=>turns.filter(s=>s.index===index).reduce((n,s)=>n+(counts.get(s.segmentIndex)??0),0));
      byHz[hz]={renderIntervals:delta.either.length,turnSegments:turns.length,zeroFrameTurns:values.filter(n=>n===0).length,oneFrameTurns:values.filter(n=>n===1).length,minTurnSamples:Math.min(...values),medianTurnSamples:median(values),maxTurnSamples:Math.max(...values),minSamplesPerNotationMove:Math.min(...moveCounts),medianSamplesPerNotationMove:median(moveCounts),wristFrameDisplacementMM:{maximumOfEither:{max:Math.max(...delta.either),p90:p90(delta.either)},left:{max:Math.max(...delta.left),p90:p90(delta.left)},right:{max:Math.max(...delta.right),p90:p90(delta.right)}},turnCounts:turns.map((s,i)=>({segmentIndex:s.segmentIndex,stepIndex:s.index,move:moves[s.index].notation,phase:s.phase,durationMS:s.duration*1000,samples:values[i]}))};
    }
    const durations=program.segments.map(s=>s.duration*1000);
    return {id,algorithm,...extra,moves:moves.length,cost:program.cost,segments:program.segments.length,statistics:program.statistics,phaseDurationMS:{min:Math.min(...durations),median:median(durations),max:Math.max(...durations),under60HzFrame:durations.filter(x=>x<1000/60).length,under120HzFrame:durations.filter(x=>x<1000/120).length},turnTimeSeconds:turns.reduce((n,s)=>n+s.duration,0),byHz};
  }
  const groups=[...observedCandidates.values()],mappingValid=groups.length===4&&plan.candidates.every(c=>{const g=groups.find(g=>g.frame===c.frame);return g&&Math.abs(g.lastCost-c.score)<1e-9&&parseAlgorithm(g.lastAlgorithm).length===c.moveCount;});
  const candidates=mappingValid?plan.candidates.map(c=>{const g=groups.find(g=>g.frame===c.frame)!;return timedRecord(`cfop-frame-${c.frame}`,g.lastAlgorithm,{frame:c.frame,selected:c.frame===plan.selectedFrame,recordedScore:c.score,costCallbackCalls:g.calls});}):[];
  const legacyPath="evidence/real-photo-session.json",legacy=JSON.parse(readFileSync(legacyPath,"utf8"));
  const comparison=timedRecord("accepted-photo-short21",legacy.solution,{source:legacyPath,sourceSHA256:sha(legacyPath),sourceFacelets:legacy.facelets,sameInitialStateAsCurrentDemo:legacy.facelets===seeded,independentlySolvesOwnState:applyAlgorithm(legacy.facelets,legacy.solution)===SOLVED,geometryScope:"Timing through the same new compiler only; no new geometry sweep for this legacy comparison."});
  const program=compileFingerSolve(parseAlgorithm(plan.solution)),actualSamplerCheck=checkBoundaries(program,parseAlgorithm(plan.solution),snapshots(seeded,parseAlgorithm(plan.solution)));
  const output="evidence/finger-solve-timing.json";
  const result={date:new Date().toISOString(),durationSeconds:5,sources,changedSources:sources.filter(s=>sha(s.path)!==s.sha256),geometryEvidence:{path:"evidence/finger-solve-full.json",sha256:sha("evidence/finger-solve-full.json")},mappingValid,candidateMetadata:plan.candidates,candidates,comparison,actualSamplerCheck,samplingConvention:"Ideal fixed sample grid t=k/Hz locked to playback start; count only public sample() TURN frames with strict 0<progress<1. Wrist per-frame displacement is root translation between consecutive public samples. Report maximum across either wrist each frame; p90 uses nearest rank. This is a deterministic temporal-resolution estimate, not measured browser FPS or perceived fluidity.",comparisonCaveat:"The accepted old 21-move photo sequence starts from a different state than the current seeded CFOP demonstration. This compares their presentation load through the same compiler, not solver quality on an identical cube."};
  writeFileSync(output,JSON.stringify(result,null,2)+"\n");
  for(const record of [...candidates,comparison])console.log(JSON.stringify({id:record.id,moves:record.moves,cost:record.cost,segments:record.segments,phaseDurationMS:record.phaseDurationMS,Hz60:{...record.byHz[60],turnCounts:undefined},Hz120:{...record.byHz[120],turnCounts:undefined}}));
  console.log(JSON.stringify({output,mappingValid,actualSamplerCheck:actualSamplerCheck.passed,firstFailure:actualSamplerCheck.samplerFailures[0],changedSources:result.changedSources}));
  renderedCube.dispose();process.exit(mappingValid&&actualSamplerCheck.passed&&!result.changedSources.length?0:1);
}
const results:any[]=[],sampleCache=new Map<string,ReturnType<typeof inspect>>(),segmentCache=new Map<string,any>();
for(const study of allStudies.filter(s=>!studyFilter||s.id===studyFilter)) {
  const moves=parseAlgorithm(study.algorithm),program=compileFingerSolve(moves),states=snapshots(study.state,moves),boundaries=checkBoundaries(program,moves,states),segments:any[]=[];
  console.log(JSON.stringify({study:study.id,moves:moves.length,totalSegments:program.segments.length,boundaries:boundaries.passed,firstBoundaryFailure:boundaries.failures[0],firstSamplerFailure:boundaries.samplerFailures[0]}));
  for(let segmentIndex=0;segmentIndex<program.segments.length;segmentIndex++) {
    const segment=program.segments[segmentIndex];if(phaseExpression&&!phaseExpression.test(segment.phase))continue;
    const cubeMove=segment.stage==="TURN"?program.steps[segment.index].move:undefined;
    const move=program.steps[segment.index].move,base={segmentIndex,stepIndex:segment.index,move:move.notation,stage:segment.stage,phase:segment.phase,start:segment.start,duration:segment.duration};
    const fingerprint=coarse?undefined:segmentKey(segment,cubeMove);
    if(fingerprint&&priorSegments.has(fingerprint)) {
      const proof=priorSegments.get(fingerprint);reuse.matchedSegments++;
      segments.push({...base,fingerprint,passed:true,samples:129,reused:{kind:"prior-ur-full",...proof},maximum:proof.maximum,failures:[]});continue;
    }
    if(fingerprint&&segmentCache.has(fingerprint)) {
      const proof=segmentCache.get(fingerprint);segments.push({...base,fingerprint,passed:proof.passed,samples:129,reused:{kind:"identical-segment",study:proof.study,segmentIndex:proof.segmentIndex},maximum:proof.maximum,failures:proof.failures});continue;
    }
    const maximum=zero(),failures:any[]=[],peaks:Record<string,unknown>={};
    for(let i=0;i<=divisions;i++) {
      const progress=i/divisions,f=convert(segment.sample(progress)),key=keyOf(f,cubeMove);
      let measurement=sampleCache.get(key);if(!measurement){measurement=inspect(f,cubeMove);sampleCache.set(key,measurement);}
      const where={study:study.id,...base,active:segment.active,activeFinger:segment.finger,progress,time:segment.start+segment.duration*progress};
      for(const name of Object.keys(maximum) as (keyof Metric)[])if(measurement.metric[name]>maximum[name]){maximum[name]=measurement.metric[name];peaks[name]={...where,value:maximum[name],detail:measurement.detail};}
      const invalid=failed(measurement.metric);if(invalid.length)failures.push({...where,invalid,...measurement,frame:failures.length===0?f:undefined});
    }
    const result={...base,fingerprint,passed:!failures.length,samples:divisions+1,maximum,peaks,failures};segments.push(result);
    if(fingerprint)segmentCache.set(fingerprint,{...result,study:study.id});
    if(!result.passed)console.log(JSON.stringify({study:study.id,segmentIndex,phase:segment.phase,maximum,first:failures[0]?.detail}));
  }
  const result={...study,moves:moves.length,sourceState:study.state,finalSolved:states.at(-1)===SOLVED,totalSegments:program.segments.length,checkedSegments:segments.length,passed:boundaries.passed&&segments.every(s=>s.passed)&&(study.id!=="demo-cfop"||states.at(-1)===SOLVED),boundaries,statistics:program.statistics,segments};results.push(result);
  console.log(JSON.stringify({study:study.id,passed:result.passed,checkedSegments:segments.length,reused:segments.filter(s=>s.reused).length,failedSegments:segments.filter(s=>!s.passed).length}));
}
renderedCube.dispose();
const changedSources=sources.filter(s=>sha(s.path)!==s.sha256),label=arg("--label",mode+(studyFilter?"-"+studyFilter:"")),output=`evidence/finger-solve-${label}.json`;
const result={date:new Date().toISOString(),mode,thresholdMM,samplesPerSegment:divisions+1,scope:coarse?"Actual complete compiler: coarse full-hand cube and independent URDF contact/support checks; actual segment and public-sampler boundaries, stickers, identity and quarter-aligned non-TURN states. Other mesh metrics deferred.":"Actual complete compiler at 65 base samples plus 64 interleaved progress midpoints per novel segment. Full hand/cube, different-finger/interhand vertex containment, upper/forearm body/reach, actual URDF contacts/support; prior UR samples reused only under recorded hash/geometry-equivalence and exact state fingerprints; all actual boundaries checked.",sources,changedSources,assetsSHA256,scriptSHA256:sha("scripts/inspect-finger-solve.ts"),reuse,passed:!changedSources.length&&results.every(r=>r.passed),studies:results,uniqueSampleStates:sampleCache.size,newUniqueSegments:segmentCache.size,limitations:["Non-TURN uses the full aligned cube box and contact checking without a moving-layer restriction.","65+64 here samples the compiler's actual normalized progress, including its smooth time law; it is not a uniform resampling of source-table indices.","Visual support requires three actual pad contacts with triangle area >0.00015 m2; it is not force closure.","Self tests exclude adjacent links of the same finger and intentional wrist attachments. Arm checks cover upper/forearm solids, not arbitrary decorative-arm mesh intersections.","Sampled vertices and containment are not continuous triangle intersection or hardware proof."]};
writeFileSync(output,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify({output,passed:result.passed,changedSources,uniqueSampleStates:sampleCache.size,newUniqueSegments:segmentCache.size,reusedUR:reuse.matchedSegments}));
if(!result.passed)process.exitCode=1;
