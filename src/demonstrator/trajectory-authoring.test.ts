import {describe,expect,it,vi} from 'vitest';
import {FORMULAS} from './catalog';
import {compileTeachingMotion,sampleTeachingMotion} from './motion';
import {exportTeachingTrajectory,fitTeachingFrame,solveTeachingPose} from './rig';
import {Vector3} from 'three';
// Isolate the first receiving placement from OLL03's later choreography. A
// shortened source must not retain a real formula ID with authored later steps.
vi.mock('./authored-grips',async importOriginal=> {
  const actual=await importOriginal<typeof import('./authored-grips')>();
  return {...actual,authoredSupportPlacements:(id:string,step:number)=>
    actual.authoredSupportPlacements(id==='authoring-normal-receive-probe'?'gan-oll-03':id,step)};
});
function freeze<T>(value:T):T {
  if(value&&typeof value==='object') {Object.freeze(value);for(const child of Object.values(value))freeze(child);}
  return value;
}
describe('offline teaching choreography',()=> {
  it('keeps source contacts and timing immutable while sharing boundary constraints',()=> {
    const original=FORMULAS.find(f=>f.id==='gan-f2l-40')!;
    const source={...original,id:'authoring-immutable-probe',algorithm:'R',steps:original.steps.slice(0,1),groups:[{...original.groups[0],start:0,end:1}]};
    const program=freeze(compileTeachingMotion(source));
    const before=JSON.stringify(program),result=exportTeachingTrajectory(program);
    expect(JSON.stringify(program)).toBe(before);
    expect(result.times[0]).toBe(0);expect(result.times.at(-1)).toBe(program.duration);
    expect(result.directions.every(row=>row.length===90&&row.every(Number.isFinite))).toBe(true);
    // Approaching/leaving a surface must not swing the pad through the cube,
    // nor may this kinematic guide pretend to supply a physical grip.
    let guided=0;
    for(const segment of program.segments.filter(s=>s.phase==='contact'||s.phase==='release')) {
      for(const blend of [.2,.5,.8]) {
        const raw=sampleTeachingMotion(program,segment.start+segment.duration*blend);
        const frame=fitTeachingFrame(raw),solutions=solveTeachingPose(frame.pose,frame);
        for(const solution of solutions) {
          const from=segment.from[solution.hand].tips[solution.finger],to=segment.to[solution.hand].tips[solution.finger];
          const delta=new Vector3().fromArray(to.point).sub(new Vector3().fromArray(from.point));
          if(delta.length()<1e-7||delta.length()>.025||delta.clone().cross(new Vector3().fromArray(to.normal)).length()>1e-7)continue;
          expect(new Vector3().fromArray(solution.joints[3]).distanceTo(new Vector3().fromArray(raw.pose[solution.hand].tips[solution.finger].point))).toBeLessThan(1e-7);
          expect(raw.contacts.some(c=>c.hand===solution.hand&&c.finger===solution.finger)).toBe(false);
          guided++;
        }
      }
    }
    expect(guided).toBeGreaterThan(0);
  },30000);
  it('keeps a receiving support pad on its authored normal path in actual rigid playback',()=> {
    const original=FORMULAS.find(f=>f.id==='gan-oll-03')!;
    const source={...original,id:'authoring-normal-receive-probe',algorithm:original.steps[0].move.notation,steps:original.steps.slice(0,1),groups:[{...original.groups[0],start:0,end:1}]};
    const program=compileTeachingMotion(source);
    const receiver=program.segments.find(s=>s.padGuides?.some(g=>g.hand==='left'&&g.finger==='thumb'))!;
    expect(receiver).toBeDefined();
    exportTeachingTrajectory(program);
    for(const blend of [.1,.25,.5,.75,.9]) {
      const raw=sampleTeachingMotion(program,receiver.start+receiver.duration*blend);
      const frame=fitTeachingFrame(raw),actual=solveTeachingPose(frame.pose,frame).find(f=>f.hand==='left'&&f.finger==='thumb')!;
      expect(raw.contacts.some(c=>c.hand==='left'&&c.finger==='thumb')).toBe(false);
      expect(new Vector3(...actual.joints[3]).distanceTo(new Vector3(...raw.pose.left.tips.thumb.point))).toBeLessThan(1e-7);
    }
  },30000);
});
