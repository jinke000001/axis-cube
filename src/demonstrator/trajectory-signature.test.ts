import {describe,expect,it} from 'vitest';
import {FORMULAS} from './catalog';
import {compileTeachingMotion} from './motion';
import {teachingTrajectorySignature} from './rig';
describe('cross-browser trajectory identity',()=> {
  it('ignores engine-scale floating-point changes in derived poses and anchor coordinates',()=> {
    const program=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-f2l-40')!);
    const changed=structuredClone(program);
    for(const phase of changed.segments) {
      phase.start+=1e-13;phase.duration+=1e-13;
      for(const pose of [phase.from,phase.to])for(const hand of ['left','right'] as const) {
        pose[hand].palm[0]+=1e-12;pose[hand].rotation[3]+=1e-14;
        pose[hand].tips.index.point[2]-=1e-12;
      }
      for(const contact of phase.contacts) {contact.local[0]+=1e-13;contact.normal[1]-=1e-13;}
    }
    expect(teachingTrajectorySignature(changed)).toBe(teachingTrajectorySignature(program));
  });
  it('binds original moves, groups, active fingers, initial state and authored timing',()=> {
    const program=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-f2l-40')!);
    const signature=teachingTrajectorySignature(program);
    for(const mutate of [
      (p:typeof program)=>{p.steps[0].move.turns=3;},
      (p:typeof program)=>{p.steps[0].group+=1;},
      (p:typeof program)=>{p.steps[0].driver.finger=p.steps[0].driver.finger==='middle'?'index':'middle';},
      (p:typeof program)=>{p.initialState=p.initialState.split('').reverse().join('');},
      (p:typeof program)=>{p.segments[0].duration+=.01;},
    ]) {const changed=structuredClone(program);mutate(changed);expect(teachingTrajectorySignature(changed)).not.toBe(signature);}
  });
  it('binds receiver pad guides separately from physical held contacts',()=> {
    const program=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!);
    const signature=teachingTrajectorySignature(program),changed=structuredClone(program);
    const phase=changed.segments.find(s=>s.padGuides?.length)!;
    phase.padGuides![0].local[1]+=.005;
    expect(teachingTrajectorySignature(changed)).not.toBe(signature);
    expect(phase.contacts).toEqual(program.segments[changed.segments.indexOf(phase)].contacts);
  });
  it('binds an external receiving path separately from physical support',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!),changed=structuredClone(p);
    changed.externalReceptions![0].distance+=.01;
    expect(teachingTrajectorySignature(changed)).not.toBe(teachingTrajectorySignature(p));
    expect(changed.segments.map(s=>s.contacts)).toEqual(p.segments.map(s=>s.contacts));
  });
  it('binds authored short departure distances rather than ignoring them as derived pose floats',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-f2l-01')!),changed=structuredClone(p);
    changed.flickTransitions![0].releaseClearance+=.002;
    expect(teachingTrajectorySignature(changed)).not.toBe(teachingTrajectorySignature(p));
  });
  it('binds a corner toolpath without converting it to physical support',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!),changed=structuredClone(p);
    changed.cornerReceptions![0].clearance+=.002;
    expect(teachingTrajectorySignature(changed)).not.toBe(teachingTrajectorySignature(p));
    expect(changed.segments.map(s=>s.contacts)).toEqual(p.segments.map(s=>s.contacts));
  });
});
