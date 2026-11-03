import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import shortCollision from './audit-fixtures/oll31-v51-short-collision.json';
import { Quaternion, Vector3 } from 'three';
import { parseMove } from '../core/cube';
import { auditArmConnections, auditArmHandVolumes, auditArmVolumes, auditFingerPalmVolumes, auditFingerSelfVolumes, capsuleBoxClearance, frameCubeShapes, jointMotionDiagnostics, auditSampleTimes, planGeometryRefinement, obbPenetration, refineJointMotionDiagnostic, segmentBoxDistance, segmentSampleTimes, segmentSegmentDistance, type ActualJointSample, type RoundedBox } from './geometry-audit';
import rigMetadata from '../../art/teaching-hand/rig.json';
import type { Vec3 } from '../core/cube';

describe('independent geometric collision measurements',()=> {
  it('handles segment-to-box face, edge, vertex, crossing and point cases',()=> {
    expect(segmentBoxDistance([2,0,0],[2,2,0],[1,1,1])).toBeCloseTo(1,10);
    expect(segmentBoxDistance([2,2,-2],[2,2,2],[1,1,1])).toBeCloseTo(Math.sqrt(2),10);
    expect(segmentBoxDistance([2,2,2],[3,3,3],[1,1,1])).toBeCloseTo(Math.sqrt(3),10);
    expect(segmentBoxDistance([-3,0,0],[3,0,0],[1,1,1])).toBe(0);
    expect(segmentBoxDistance([0,0,0],[0,0,0],[1,1,1])).toBe(0);
    expect(segmentBoxDistance([-2,2,0],[2,-2,0],[1,1,1])).toBe(0);
  });
  it('handles skew, intersecting, parallel, collinear and degenerate segments',()=> {
    expect(segmentSegmentDistance([-1,0,0],[1,0,0],[0,-1,1],[0,1,1])).toBeCloseTo(1,10);
    expect(segmentSegmentDistance([-1,0,0],[1,0,0],[0,-1,0],[0,1,0])).toBe(0);
    expect(segmentSegmentDistance([0,0,0],[1,0,0],[0,2,0],[1,2,0])).toBe(2);
    expect(segmentSegmentDistance([0,0,0],[1,0,0],[2,0,0],[3,0,0])).toBe(1);
    expect(segmentSegmentDistance([0,0,0],[0,0,0],[1,0,0],[2,0,0])).toBe(1);
  });
  it('transforms a rotating box instead of testing against a stationary cube hull',()=> {
    const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4).toArray();
    const box:RoundedBox={center:[0,0,0],rotation,half:[.02,.01,.02],rounding:0};
    const point:[number,number,number]=[.026,0,0];
    expect(capsuleBoxClearance({a:point,b:point},.001,box)).toBeCloseTo(-.001,10);
    expect(capsuleBoxClearance({a:point,b:point},.001,{...box,rotation:[0,0,0,1]})).toBeCloseTo(.005,10);
  });
  it('creates 26 bodies and 54 stickers and rotates only selected cubies',()=> {
    const shapes=frameCubeShapes({move:parseMove('M'),angle:Math.PI/4});
    expect(shapes).toHaveLength(80);
    const right=shapes.find(shape=>shape.label==='body'&&shape.cubie.join(',')==='1,1,1')!;
    const middle=shapes.find(shape=>shape.label==='body'&&shape.cubie.join(',')==='0,1,1')!;
    expect(right.rotation).toEqual([0,0,0,1]);
    expect(middle.rotation).not.toEqual([0,0,0,1]);
    expect(right.center).toEqual([.03,.03,.03]);
  });
  it('uses all separating axes for intersecting and separated rotated palm boxes',()=> {
    const a:RoundedBox={center:[0,0,0],rotation:[0,0,0,1],half:[.01,.03,.02],rounding:0};
    expect(obbPenetration(a,{...a,center:[.025,0,0]})).toBeCloseTo(-.005,10);
    expect(obbPenetration(a,{...a,center:[.015,0,0]})).toBeCloseTo(.005,10);
    const tilted:RoundedBox={...a,center:[.021,0,0],rotation:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4).toArray()};
    expect(obbPenetration(a,tilted)).toBeGreaterThan(0);
    expect(obbPenetration(a,{...tilted,center:[.05,0,0]})).toBeLessThan(0);
  });
  it('always includes phase midpoints and the pre-commit endpoint',()=> {
    for(const count of [3,5,7]) {
      const times=segmentSampleTimes(10,2,count);
      expect(times).toContain(11);
      expect(times[0]).toBe(10);
      expect(times.at(-1)).toBeLessThan(12);
      expect(times.at(-1)).toBeGreaterThan(11.999999);
    }
    expect(()=>segmentSampleTimes(0,0,3)).toThrow();
  });
  it('detects the unrotated wrist offset even when the arm itself remains rigid',()=> {
    const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2).toArray();
    const palm={palm:[0,0,0] as Vec3,rotation},pose={left:palm,right:palm};
    const wrist=new Vector3().fromArray(rigMetadata.wristAttachment).applyQuaternion(new Quaternion().fromArray(rotation));
    const lengths=rigMetadata.armLengths;
    const arm={hand:'right' as const,shoulder:wrist.clone().add(new Vector3(0,-lengths[0]-lengths[1],0)).toArray() as Vec3,elbow:wrist.clone().add(new Vector3(0,-lengths[1],0)).toArray() as Vec3,wrist:wrist.toArray() as Vec3,target:wrist.toArray() as Vec3,reachError:0};
    expect(auditArmConnections(pose,[arm]).confirmed).toEqual([]);
    const badOffset=new Vector3().fromArray(rigMetadata.wristAttachment).sub(wrist);
    const detached={...arm,shoulder:new Vector3().fromArray(arm.shoulder).add(badOffset).toArray() as Vec3,elbow:new Vector3().fromArray(arm.elbow).add(badOffset).toArray() as Vec3,wrist:rigMetadata.wristAttachment as Vec3,target:rigMetadata.wristAttachment as Vec3};
    const result=auditArmConnections(pose,[detached]);
    expect(result.confirmed.some(issue=>issue.kind==='arm-connection')).toBe(true);
    expect(result.maximumArmLengthErrorMetres).toBeLessThan(1e-9);
    expect(result.maximumArmAttachmentErrorMetres).toBeGreaterThan(.04);
    expect(auditArmConnections(pose,[{...arm,elbow:[0,0,0]}]).confirmed.some(issue=>issue.kind==='arm-non-rigid')).toBe(true);
  });
  it('checks arm housing interiors and wrist couplers, not just endpoints',()=> {
    const arm={hand:'left' as const,shoulder:[-.215,-.23,.04] as Vec3,elbow:[-.12637,-.07755,-.05435] as Vec3,wrist:[.012,-.033,.068] as Vec3,target:[.012,-.033,.068] as Vec3,reachError:0};
    const crossing=auditArmVolumes({angle:0},[arm]);
    expect(crossing.confirmed.some(issue=>issue.detail.includes('forearm housing'))).toBe(true);
    expect(Math.max(...crossing.confirmed.map(issue=>issue.depthMetres))).toBeGreaterThan(.005);
    const coupler=auditArmVolumes({angle:0},[{...arm,shoulder:[.3,0,0],elbow:[.2,0,0],wrist:[.049,0,0]}]);
    expect(coupler.confirmed.some(issue=>issue.detail.includes('wrist coupler'))).toBe(true);
    expect(auditArmVolumes({angle:0},[{...arm,shoulder:[.6,.3,.3],elbow:[.4,.3,.3],wrist:[.21,.3,.3]}]).confirmed).toEqual([]);
  });
  it('exempts only the MCP connection, not shafts or fingertips crossing a palm',()=> {
    const rotation:[number,number,number,number]=[0,0,0,1];
    const pose={left:{palm:[0,0,0] as Vec3,rotation},right:{palm:[1,0,0] as Vec3,rotation}};
    const finger={hand:'left' as const,finger:'index' as const,joints:[[.004,0,0],[.049,0,0],[.089,0,0],[.108,0,0]] as [Vec3,Vec3,Vec3,Vec3],reachError:0,minimumClearance:0};
    expect(auditFingerPalmVolumes(pose,[finger]).confirmed).toEqual([]);
    const backwards={...finger,joints:[[.004,0,0],[-.041,0,0],[-.081,0,0],[-.1,0,0]] as [Vec3,Vec3,Vec3,Vec3]};
    expect(auditFingerPalmVolumes(pose,[backwards]).confirmed.some(issue=>issue.detail.startsWith('link-0'))).toBe(true);
    const distal={...finger,joints:[[.004,0,0],[.049,0,0],[.009,0,0],[-.01,0,0]] as [Vec3,Vec3,Vec3,Vec3]};
    expect(auditFingerPalmVolumes(pose,[distal]).confirmed.some(issue=>issue.detail.startsWith('link-2'))).toBe(true);
    const opposite={...pose,right:{palm:[.004,0,0] as Vec3,rotation}};
    expect(auditFingerPalmVolumes(opposite,[finger]).confirmed.some(issue=>issue.otherHand==='right'&&issue.detail.startsWith('joint-0'))).toBe(true);
  });
  it('detects crossing arms and folded same-arm housings outside their elbow joint',()=> {
    const rotation:[number,number,number,number]=[0,0,0,1];
    const pose={left:{palm:[1,1,1] as Vec3,rotation},right:{palm:[2,2,2] as Vec3,rotation}};
    const left={hand:'left' as const,shoulder:[-.1,0,0] as Vec3,elbow:[.1,0,0] as Vec3,wrist:[.29,0,0] as Vec3,target:[.29,0,0] as Vec3,reachError:0};
    expect(auditArmHandVolumes(pose,[left],[]).confirmed).toEqual([]);
    const right={...left,hand:'right' as const,shoulder:[0,-.1,0] as Vec3,elbow:[0,.1,0] as Vec3,wrist:[0,.29,0] as Vec3};
    const crossing=auditArmHandVolumes(pose,[left,right],[]);
    expect(crossing.confirmed.some(issue=>issue.kind==='arm-arm-penetration'&&issue.hand!==issue.otherHand)).toBe(true);
    const folded=auditArmHandVolumes(pose,[{...left,wrist:[-.09,0,0]}],[]);
    expect(folded.confirmed.some(issue=>issue.kind==='arm-arm-penetration'&&issue.detail.includes('outside the common elbow'))).toBe(true);
  });
  it('treats a fixed MCP mount as solid for other fingers while preserving its own joint',()=> {
    const rotation:[number,number,number,number]=[0,0,0,1];
    const pose={left:{palm:[0,0,0] as Vec3,rotation},right:{palm:[1,0,0] as Vec3,rotation}};
    const base=rigMetadata.baseOffsetsRight.index;
    const joint=[-base[0],base[1],base[2]] as Vec3;
    const finger={hand:'left' as const,finger:'index' as const,joints:[joint,[joint[0]+.045,joint[1],joint[2]],[joint[0]+.085,joint[1],joint[2]],[joint[0]+.104,joint[1],joint[2]]] as [Vec3,Vec3,Vec3,Vec3],reachError:0,minimumClearance:0};
    expect(auditFingerPalmVolumes(pose,[finger]).confirmed).toEqual([]);
    const mountedCenter=[joint[0]-rigMetadata.geometry.mcpMountLength/2,joint[1],joint[2]] as Vec3;
    const intruder={...finger,finger:'ring' as const,joints:[mountedCenter,...finger.joints.slice(1)] as [Vec3,Vec3,Vec3,Vec3]};
    expect(auditFingerPalmVolumes(pose,[intruder]).confirmed.some(issue=>issue.detail.includes('index MCP mount')&&issue.detail.startsWith('joint-0'))).toBe(true);
  });
  it('does not exempt adjacent whole finger shafts folded through each other',()=> {
    const finger={hand:'left' as const,finger:'index' as const,joints:[[0,0,0],[.045,0,0],[.085,0,0],[.104,0,0]] as [Vec3,Vec3,Vec3,Vec3],reachError:0,minimumClearance:0};
    expect(auditFingerSelfVolumes([finger]).confirmed).toEqual([]);
    const folded={...finger,joints:[[0,0,0],[.045,0,0],[.005,0,0],[.005,.019,0]] as [Vec3,Vec3,Vec3,Vec3]};
    expect(auditFingerSelfVolumes([folded]).confirmed.some(issue=>issue.detail==='link-0 intersects link-1 outside the common finger joint assembly ball.')).toBe(true);
  });
  it('allows the wrist assembly but catches forearms through palms and fingers',()=> {
    const rotation:[number,number,number,number]=[0,0,0,1];
    const pose={left:{palm:[0,0,0] as Vec3,rotation},right:{palm:[1,0,0] as Vec3,rotation}};
    const wrist=rigMetadata.wristAttachment as Vec3;
    const arm={hand:'left' as const,shoulder:[0,wrist[1]-.39,wrist[2]] as Vec3,elbow:[0,wrist[1]-.19,wrist[2]] as Vec3,wrist,target:wrist,reachError:0};
    expect(auditArmHandVolumes(pose,[arm],[]).confirmed).toEqual([]);
    const crossing={...arm,shoulder:[0,wrist[1]+.39,wrist[2]] as Vec3,elbow:[0,wrist[1]+.19,wrist[2]] as Vec3};
    expect(auditArmHandVolumes(pose,[crossing],[]).confirmed.some(issue=>issue.kind==='arm-palm-penetration')).toBe(true);
    const finger={hand:'left' as const,finger:'index' as const,joints:[[-.04,-.12,wrist[2]],[.005,-.12,wrist[2]],[.045,-.12,wrist[2]],[.064,-.12,wrist[2]]] as [Vec3,Vec3,Vec3,Vec3],reachError:0,minimumClearance:0};
    expect(auditArmHandVolumes(pose,[arm],[finger]).confirmed.some(issue=>issue.kind==='arm-finger-penetration')).toBe(true);
    const opposite={...pose,right:{palm:wrist,rotation}};
    expect(auditArmHandVolumes(opposite,[arm],[]).confirmed.some(issue=>issue.kind==='arm-palm-penetration'&&issue.otherHand==='right'&&issue.detail.includes('wrist coupler'))).toBe(true);
  });
  it('locates an interior 51 mm finger jump even when phase boundaries are unchanged',()=> {
    const finger={hand:'right' as const,finger:'ring' as const,joints:[[0,0,0],[0,.045,0],[0,.085,0],[0,.104,0]] as [Vec3,Vec3,Vec3,Vec3],reachError:0,minimumClearance:0};
    const before:ActualJointSample={time:2.14,step:1,phase:'衔接',fingers:[finger],arms:[]};
    const after:ActualJointSample={...before,time:2.15,fingers:[{...finger,joints:[[0,0,0],[.051,.045,0],[0,.085,0],[0,.104,0]]}]};
    const diagnostics=jointMotionDiagnostics(before,after),largest=diagnostics.sort((a,b)=>b.displacementMetres-a.displacementMetres)[0];
    expect(largest.finger).toBe('ring');expect(largest.joint).toBe(1);
    expect(largest.displacementMetres).toBeCloseTo(.051,10);
    expect(largest.speedMetresPerSecond).toBeCloseTo(5.1,10);
    expect(()=>jointMotionDiagnostics(before,before)).toThrow();
    const smooth=refineJointMotionDiagnostic(largest,time=>[.051*(time-2.14)/.01,.045,0]);
    expect(smooth.abruptAtTenMicroseconds).toBe(false);
    const jump=refineJointMotionDiagnostic(largest,time=>[time<2.145?0:.051,.045,0]);
    expect(jump.abruptAtTenMicroseconds).toBe(true);
    expect(jump.displacementMetres).toBeCloseTo(.051,10);
  });
  it('targets all merged speed windows at 1 ms, including an interior collision missed at 10 ms',()=> {
    const plan=planGeometryRefinement([{start:4.07,end:4.08},{start:4.08,end:4.09},{start:4.07,end:4.08},{start:8,end:8.01,reason:'known-counterexample'}],10);
    expect(plan.windows).toHaveLength(2);
    expect(plan.durationSeconds).toBeCloseTo(.03,10);
    expect(plan.times.some(time=>Math.abs(time-4.077)<1e-10)).toBe(true);
    expect(plan.times.every(time=>time>=4.07&&time<=4.09||time>=8&&time<=8.01)).toBe(true);
    expect(new Set(plan.times.map(time=>time.toFixed(10))).size).toBe(plan.times.length);
    expect(()=>planGeometryRefinement([{start:2,end:1}],3)).toThrow();
    expect(()=>planGeometryRefinement([],3,.002)).toThrow();
  });
  it('does not create a near-zero final diagnostic interval from floating-point duration noise',()=> {
    const times=auditSampleTimes(0,25.280000000000012,.01);
    expect(times.at(-1)).toBe(25.280000000000012);
    expect(times.at(-1)!-times.at(-2)!).toBeGreaterThan(.009);
    expect(times.filter(time=>Math.abs(time-25.28)<1e-9)).toHaveLength(1);
  });

  it('catches the published v51 OLL31 DIP/shaft collision hidden between clear 10 ms endpoints',()=> {
    const metadata=readFileSync(new URL('../../art/teaching-hand/rig.json',import.meta.url));
    expect(createHash('sha256').update(metadata).digest('hex')).toBe(shortCollision.geometryMetadataSha256);
    const evaluate=(sample:typeof shortCollision.samples[number])=>auditFingerSelfVolumes(sample.fingers as unknown as Parameters<typeof auditFingerSelfVolumes>[0]).confirmed;
    const coarse=shortCollision.samples.filter(sample=>Math.abs(sample.time-4.07)<1e-10||Math.abs(sample.time-4.08)<1e-10);
    expect(coarse).toHaveLength(2);expect(coarse.flatMap(evaluate)).toEqual([]);
    const planned=planGeometryRefinement([{start:4.07,end:4.08,reason:'speed-trigger'}],17);
    const refined=planned.times.flatMap(time=> {
      const sample=shortCollision.samples.find(value=>Math.abs(value.time-time)<1e-10);
      expect(sample).toBeDefined();return evaluate(sample!);
    });
    expect(refined).toHaveLength(4);
    expect(Math.max(...refined.map(issue=>issue.depthMetres))).toBeCloseTo(.0021077974625547838,10);
    expect(refined.every(issue=>issue.kind==='finger-penetration'&&issue.detail==='joint-2 intersects link-0.')).toBe(true);
  });

});
