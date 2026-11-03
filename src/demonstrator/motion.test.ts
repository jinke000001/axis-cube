import { describe,expect,it } from 'vitest';
import {Quaternion,Vector3} from 'three';
import { applyMove, moveAngle, moveAffects } from '../core/cube';
import { FORMULAS } from './catalog';
import { compileTeachingMotion,sampleTeachingMotion,teachingBoundaryTime,validateTeachingMotion,contactPoint,TIP_RADIUS } from './motion';
import {FINGER_BASES} from './rig-spec';

describe('source-step mechanical timeline',()=> {
  it('executes all 121 original sequences directly, including middle and wide layers',()=> {
    expect(FORMULAS).toHaveLength(121);
    for(const formula of FORMULAS) {
      const program=compileTeachingMotion(formula);
      expect(program.steps.map(s=>s.move),formula.id).toEqual(formula.steps.map(s=>s.move));
      expect(validateTeachingMotion(program).errors,formula.id).toEqual([]);
      let state=formula.initialState;
      for(let i=0;i<formula.steps.length;i++) {
        expect(sampleTeachingMotion(program,teachingBoundaryTime(program,i)).state,`${formula.id}:${i}`).toBe(state);
        state=applyMove(state,formula.steps[i].move);
        const turns=program.steps[i].segments.map(n=>program.segments[n]).filter(s=>s.phase==='drive');
        expect(turns.reduce((sum,s)=>sum+s.angleTo-s.angleFrom,0)).toBeCloseTo(moveAngle(formula.steps[i].move),10);
      }
      expect(sampleTeachingMotion(program,program.duration).state).toBe(state);
    }
  });
  it('keeps the printed first finger and separates half-turn relay from repeated tokens',()=> {
    for(const formula of FORMULAS) {
      const program=compileTeachingMotion(formula);
      for(const source of formula.steps) {
        const step=program.steps[source.index];
        if(source.hint) {
          expect(step.driver.finger,`${formula.id}:${source.index}`).toBe(source.hint.finger);
          if(source.hint.hand)expect(step.driver.hand).toBe(source.hint.hand);
        }
        const drives=step.segments.map(n=>program.segments[n]).filter(s=>s.phase==='drive');
        expect(drives.length).toBe(source.move.turns===2?2:1);
        for(const segment of drives) {
          if(source.hint){expect(segment.finger,`${formula.id}:${source.index}`).toBe(source.hint.finger);if(source.hint.hand)expect(segment.hand).toBe(source.hint.hand);}
          expect(new Set(segment.contacts.map(c=>`${c.hand}-${c.finger}`)).size).toBe(segment.contacts.length);
        }
      }
    }
  });
  it('keeps unchanged R-to-U supports held and supplies support throughout every source turn',()=> {
    const program=compileTeachingMotion(FORMULAS.find(x=>x.id==='gan-f2l-40')!);
    const first=program.segments.find(s=>s.phase==='drive')!;
    const retained=first.contacts.filter(c=>c.role==='support'&&c.hand==='left');
    expect(retained.map(c=>c.finger).sort()).toEqual(['index','thumb']);
    for(const segment of [1,2].flatMap(step=>program.steps[step].segments.map(i=>program.segments[i]))) {
      expect(segment.contacts.filter(c=>c.hand==='left'&&c.role==='support')).toEqual(retained);
      expect(segment.phase==='handoff'&&segment.hand==='left').toBe(false);
    }
    for(const formula of FORMULAS)for(const segment of compileTeachingMotion(formula).segments.filter(s=>s.phase==='drive')) {
      const move=formula.steps[segment.step].move;
      if(move.kind==='rotation')expect(new Set(segment.contacts.map(c=>c.hand)).size).toBe(2);
      else expect(segment.contacts.filter(c=>c.role==='support'&&!c.rotating).length,`${formula.id}:${segment.step}`).toBeGreaterThanOrEqual(2);
    }
  });
  it('clears the first flick before a relay and retires an unused wide-layer middle finger',()=> {
    const program=compileTeachingMotion(FORMULAS.find(x=>x.id==='gan-f2l-01')!);
    const half=program.steps.find(step=>step.move.face==='U'&&step.move.turns===2)!;
    const parts=half.segments.map(i=>program.segments[i]),drives=parts.filter(s=>s.phase==='drive');
    expect(drives[0].finger).not.toBe(drives[1].finger);
    const retreat=parts.find(s=>s.start>drives[0].start&&s.start<drives[1].start&&s.phase==='handoff')!;
    expect(retreat.to[drives[0].hand].tips[drives[0].finger].resting).toBe(true);
    expect(retreat.angleTo).toBe(retreat.angleFrom);
    expect(retreat.contacts.every(c=>!(c.hand===drives[0].hand&&c.finger===drives[0].finger))).toBe(true);
    for(let n=0;n<=32;n++) {
      const second=drives[1],frame=sampleTeachingMotion(program,second.start+second.duration*n/32),hand=frame.pose[second.hand];
      const base=FINGER_BASES[second.finger],origin=new Vector3((second.hand==='right'?1:-1)*base[0],base[1],base[2])
        .applyQuaternion(new Quaternion().fromArray(hand.rotation)).add(new Vector3().fromArray(hand.palm));
      // Regression: the old relay passed within 28 mm of the MCP, forcing
      // an extreme fold through the index mounting post.
      expect(origin.distanceTo(new Vector3().fromArray(hand.tips[second.finger].point))).toBeGreaterThan(.045);
    }
    const wide=compileTeachingMotion(FORMULAS.find(x=>x.id==='gan-pll-16')!);
    expect(wide.steps[1].move.kind).toBe('wide');
    expect(wide.boundaries[2].left.tips.middle.resting).toBe(true);
    expect(wide.boundaries.slice(2).every(pose=>pose.left.tips.middle.resting)).toBe(true);
  });
  it('opens the first U2 quarter as well as the relay without changing source finger choices',()=> {
    for(const [id,sourceIndex] of [['gan-f2l-01',6],['gan-oll-01',7]] as const) {
      const formula=FORMULAS.find(f=>f.id===id)!,program=compileTeachingMotion(formula);
      expect(formula.steps[sourceIndex].hint).toBeUndefined();
      const drives=program.segments.filter(s=>s.step===sourceIndex&&s.phase==='drive');
      expect(drives.map(s=>s.finger)).toEqual(['index','middle']);
      const retirement=program.segments.find(s=>s.step===sourceIndex&&s.phase==='handoff'&&s.instruction.startsWith('指腹离开后再收拢中指'))!;
      expect(retirement).toBeDefined();
      expect(retirement.contacts.some(c=>c.hand==='left'&&c.finger==='middle')).toBe(false);
      expect(retirement.to.left.tips.middle.resting).toBe(true);
      expect(program.boundaries[sourceIndex+1].left.tips.middle.resting).toBe(true);
      for(const drive of drives)for(let sample=0;sample<=128;sample++) {
        const frame=sampleTeachingMotion(program,drive.start+drive.duration*Math.min(sample/128,1-1e-7));
        const hand=frame.pose[drive.hand],base=FINGER_BASES[drive.finger];
        const origin=new Vector3((drive.hand==='right'?1:-1)*base[0],base[1],base[2])
          .applyQuaternion(new Quaternion(...hand.rotation)).add(new Vector3(...hand.palm));
        // First quarter previously passed within 16.7 mm of its MCP.
        // This checks shared access; actual rigid-link clearance is separate.
        expect(origin.distanceTo(new Vector3(...hand.tips[drive.finger].point))).toBeGreaterThan(.044);
      }
    }
  });
  it('opens room for a thumb through the complete F sweep without an extra cube turn',()=> {
    const program=compileTeachingMotion(FORMULAS.find(x=>x.id==='gan-oll-31')!);
    const access=program.segments.find(s=>s.step===3&&s.instruction.includes('掌根'))!;
    expect(access).toBeDefined();
    expect(access.angleTo).toBe(access.angleFrom);
    expect(access.contacts.every(c=>c.hand==='left')).toBe(true);
    const drive=program.segments.find(s=>s.step===3&&s.phase==='drive')!;
    for(let sample=0;sample<=64;sample++) {
      const frame=sampleTeachingMotion(program,drive.start+drive.duration*sample/64),hand=frame.pose.right;
      const origin=new Vector3(...FINGER_BASES.thumb).applyQuaternion(new Quaternion().fromArray(hand.rotation)).add(new Vector3(...hand.palm));
      // The old endpoint-valid pose came within 15 mm midway through F,
      // folding the first two physical links into one another.
      expect(origin.distanceTo(new Vector3(...hand.tips.thumb.point))).toBeGreaterThan(.045);
    }
  });
  it('retains a receiving grip through handoffs, regrips and exact phase boundaries',()=> {
    for(const formula of FORMULAS) {
      const program=compileTeachingMotion(formula);
      const times=[program.duration,...new Set(program.segments.flatMap(s=>[Math.max(0,s.start-1e-6),s.start,s.start+1e-6,s.start+s.duration*.5,Math.min(program.duration-1e-8,s.start+s.duration-1e-6)]))];
      for(const time of times) {
        const frame=sampleTeachingMotion(program,time);
        expect(frame.contacts.length,`${formula.id}@${time}`).toBeGreaterThanOrEqual(2);
        for(const contact of frame.contacts) {
          const surface=contactPoint(contact,frame.move,frame.angle),tip=frame.pose[contact.hand].tips[contact.finger];
          expect(Math.hypot(...tip.point.map((v,i)=>v-surface.point[i]-surface.normal[i]*TIP_RADIUS)),`${formula.id}@${time}`).toBeLessThan(1e-7);
          if(frame.phase==='拨动'&&frame.move)expect(moveAffects(frame.move,contact.cubie)).toBe(contact.rotating);
        }
      }
    }
  });
  it('gives both wide-front driving pads space through their shared quarter-turn',()=> {
    const program=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!);
    for(const sourceIndex of [0,5]) {
      const drive=program.segments.find(s=>s.step===sourceIndex&&s.phase==='drive')!;
      const pads=drive.contacts.filter(c=>c.rotating);
      expect(pads.map(c=>c.finger).sort()).toEqual(['index','thumb']);
      for(let sample=0;sample<=128;sample++) {
        const frame=sampleTeachingMotion(program,drive.start+drive.duration*Math.min(sample/128,1-1e-7));
        for(const contact of pads) {
          const hand=frame.pose[contact.hand],base=FINGER_BASES[contact.finger];
          const origin=new Vector3((contact.hand==='right'?1:-1)*base[0],base[1],base[2])
            .applyQuaternion(new Quaternion(...hand.rotation)).add(new Vector3(...hand.palm));
          // The original two-pad grip came within 12–20 mm of one MCP,
          // forcing an extreme fold. Both pads must benefit from one palm.
          expect(origin.distanceTo(new Vector3(...hand.tips[contact.finger].point))).toBeGreaterThan(.028);
        }
      }
    }
  });
  it('withdraws an unloaded front-turn hand with its pads and carries the new pose into the next phase',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!);
    const index=p.segments.findIndex(s=>s.step===0&&s.phase==='release'),segment=p.segments[index];
    const palmDelta=new Vector3(...segment.to.right.palm).sub(new Vector3(...segment.from.right.palm));
    expect(palmDelta.length()).toBeCloseTo(.012,9);
    expect(segment.contacts.every(c=>c.hand==='left')).toBe(true);
    expect(segment.angleTo).toBe(segment.angleFrom);
    for(const finger of ['thumb','index','middle','ring','little'] as const) {
      const from=new Vector3(...segment.from.right.tips[finger].point).sub(new Vector3(...segment.from.right.palm));
      const to=new Vector3(...segment.to.right.tips[finger].point).sub(new Vector3(...segment.to.right.palm));
      expect(to.distanceTo(from)).toBeLessThan(1e-8);
    }
    expect(p.segments[index+1].from).toEqual(segment.to);
  });
  it('receives around the cube exterior under the opposite hand before landing',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!),path=p.externalReceptions![0];
    expect(path.sourceStep).toBe(4);expect(path.waitFromStep).toBe(3);
    expect(path.waitStart).toBe(p.steps[3].start);
    expect(path.start).toBe(p.steps[4].start);
    expect(path.returned-path.start).toBeCloseTo(.7,10);
    expect(path.approachEnd).toBeGreaterThan(path.returned);
    for(const time of [path.start,path.withdrawn,(path.withdrawn+path.unfolded)/2,path.unfolded,path.returned-1e-7]) {
      const frame=sampleTeachingMotion(p,time);
      expect(frame.angle).toBe(0);
      expect(frame.contacts.every(c=>c.hand==='left')).toBe(true);
      expect(frame.contacts.length).toBeGreaterThanOrEqual(2);
    }
    const beginning=sampleTeachingMotion(p,path.start),outside=sampleTeachingMotion(p,path.withdrawn);
    expect(outside.pose.right.palm[0]-beginning.pose.right.palm[0]).toBeCloseTo(path.distance,10);
    expect(sampleTeachingMotion(p,path.returned).pose.right.palm).toEqual(beginning.pose.right.palm);
    const landing=p.segments.find(s=>Math.abs(s.start-path.approachEnd)<1e-7)!;
    expect(landing.padGuides?.some(c=>c.hand==='right'&&c.finger==='index')).toBe(true);
    expect(landing.contacts.some(c=>c.hand==='right'&&c.finger==='index')).toBe(false);
    const leave=p.segments.find(s=>s.step===3&&s.phase==='handoff'&&s.hand==='right'&&s.finger==='middle'&&s.instruction.startsWith('指腹离开后再收拢'))!;
    expect(leave.to.right.tips.middle.resting).toBe(true);
    expect(leave.start+leave.duration).toBeLessThanOrEqual(path.start);
    expect(p.segments.some(s=>s.step===2&&s.instruction.startsWith('指腹离开后再收拢食指'))).toBe(false);
    for(let i=1;i<p.segments.length;i++)expect(p.segments[i].from).toEqual(p.segments[i-1].to);
  });
  it('keeps wrist gripping contacts near the previous grip instead of choosing flick-force extrema',()=> {
    const program=compileTeachingMotion(FORMULAS.find(x=>x.id==='gan-f2l-40')!);
    const receive=program.segments.find(s=>s.step===2&&s.phase==='contact'&&s.instruction.startsWith('先接稳'))!;
    expect(receive).toBeDefined();
    expect(receive.finger).toBe('thumb');
    const before=receive.from.right.tips.thumb.point,after=receive.to.right.tips.thumb.point;
    expect(Math.hypot(...before.map((v,i)=>v-after[i]))).toBeLessThan(.018);
    expect(program.segments.filter(s=>s.step===2&&s.hand==='left'&&s.phase==='handoff')).toHaveLength(0);
  });
  it('seek is deterministic and source boundaries commit both state and pose',()=> {
    const program=compileTeachingMotion(FORMULAS.find(x=>x.id==='gan-pll-01')!);
    const boundary=teachingBoundaryTime(program,4);
    const first=sampleTeachingMotion(program,boundary);
    sampleTeachingMotion(program,program.duration);
    sampleTeachingMotion(program,0);
    expect(sampleTeachingMotion(program,boundary)).toEqual(first);
    expect(first.completed).toBe(4);
    expect(first.pose).toEqual(program.boundaries[4]);
  });
  it('receives new supports along an explicit normal guide before counting them as held',()=> {
    let guides=0;
    for(const formula of FORMULAS) {
      const program=compileTeachingMotion(formula);
      for(const segment of program.segments.filter(s=>s.padGuides?.length))for(const guide of segment.padGuides!) {
        guides++;
        if(guide.positionOnly) {
          expect(segment.contacts.some(c=>c.hand===guide.hand&&c.finger===guide.finger)).toBe(false);
          expect(segment.angleFrom).toBe(segment.angleTo);
          continue;
        }
        expect(['contact','release']).toContain(segment.phase);
        expect(segment.angleTo).toBe(segment.angleFrom);
        const from=new Vector3(...segment.from[guide.hand].tips[guide.finger].point);
        const to=new Vector3(...segment.to[guide.hand].tips[guide.finger].point);
        const direction=segment.phase==='contact'?1:-1;
        expect(from.clone().sub(to).distanceTo(new Vector3(...guide.normal).multiplyScalar(.012*direction))).toBeLessThan(1e-8);
        expect(segment.contacts.some(c=>c.hand===guide.hand&&c.finger===guide.finger)).toBe(false);
        expect(segment.contacts.length).toBeGreaterThanOrEqual(2);
        const landed=sampleTeachingMotion(program,segment.start+segment.duration+1e-7);
        expect(landed.contacts.some(c=>c.hand===guide.hand&&c.finger===guide.finger)).toBe(segment.phase==='contact');
      }
    }
    expect(guides).toBeGreaterThan(0);
  });
  it('leaves the old support only after the receiving hand has established two faces',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-f2l-01')!);
    const parts=p.steps[3].segments.map(i=>p.segments[i]);
    const exit=parts.find(s=>s.phase==='release'&&s.padGuides?.length)!;
    const before=sampleTeachingMotion(p,exit.start-1e-7);
    expect(before.contacts.some(c=>c.hand==='left'&&c.finger==='index')).toBe(true);
    const right=exit.contacts.filter(c=>c.hand==='right');
    expect(right.map(c=>c.finger).sort()).toEqual(['index','thumb']);
    expect(new Vector3(...right[0].normal).dot(new Vector3(...right[1].normal))).toBeLessThan(-.99);
    expect(exit.angleFrom).toBe(0);expect(exit.angleTo).toBe(0);
    expect(exit.contacts.some(c=>c.hand==='left'&&c.finger==='index')).toBe(false);
    const release=parts.filter(s=>s.phase==='release').at(-1)!;
    expect(new Vector3(...release.to.left.tips.index.point).distanceTo(new Vector3(...release.from.left.tips.index.point))).toBeCloseTo(.004,10);
    expect(p.segments[p.segments.indexOf(release)+1].from).toEqual(release.to);
  });
  it('guides a receiver around two exterior faces before adding its physical contact',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-03')!),path=p.cornerReceptions![0];
    expect(path.sourceStep).toBe(5);expect(path.end-path.start).toBeCloseTo(.5,10);
    for(let i=0;i<50;i++) {
      const frame=sampleTeachingMotion(p,path.start+(path.end-path.start)*i/50);
      expect(frame.contacts.some(c=>c.hand==='left'&&c.finger==='index')).toBe(false);
      expect(frame.contacts.length).toBeGreaterThanOrEqual(3);
      expect(frame.angle).toBe(0);
      expect(Math.max(...frame.pose.left.tips.index.point.map(Math.abs))).toBeGreaterThan(.0481);
    }
    expect(sampleTeachingMotion(p,path.end+1e-7).contacts.some(c=>c.hand==='left'&&c.finger==='index')).toBe(true);
    for(let i=1;i<p.segments.length;i++)expect(p.segments[i].from).toEqual(p.segments[i-1].to);
  });
  it('lets an idle ring yield before the second middle stroke without inventing support',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-oll-01')!),path=p.relayYields![0];
    expect(path.sourceStep).toBe(7);expect(path.end-path.start).toBeCloseTo(.79,10);
    const start=sampleTeachingMotion(p,path.start);
    for(let i=0;i<80;i++) {
      const frame=sampleTeachingMotion(p,path.start+(path.end-path.start)*i/80);
      expect(frame.contacts).toEqual(start.contacts);
      expect(frame.contacts).toHaveLength(3);
      expect(frame.contacts.some(c=>c.hand==='left'&&['ring','middle'].includes(c.finger))).toBe(false);
      expect(Math.abs(frame.angle)).toBeCloseTo(Math.PI/2,10);
    }
    for(const time of [path.arrived+1e-6,path.refolded+1e-6]) {
      const segment=p.segments.find(s=>time>=s.start&&time<s.start+s.duration)!;
      expect(segment.padGuides?.some(c=>c.hand==='left'&&c.finger==='middle'&&c.positionOnly)).toBe(true);
    }
    const drives=p.segments.filter(s=>s.step===7&&s.phase==='drive');
    expect(drives.map(s=>s.finger)).toEqual(['index','middle']);
    expect(drives[1].start).toBeGreaterThan(path.end);
    for(let i=1;i<p.segments.length;i++)expect(p.segments[i].from).toEqual(p.segments[i-1].to);
  });

  it('adjusts a supporting joint only after reception and restores it after the upper turn',()=> {
    const p=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-pll-01-alt-1')!),path=p.supportClearances![0];
    const drive=p.segments.find(s=>s.step===9&&s.phase==='drive')!;
    expect(path.ready).toBeLessThanOrEqual(drive.start);
    expect(path.restore).toBe(drive.start+drive.duration);
    expect(path.end).toBe(p.steps[9].end);
    const origin=sampleTeachingMotion(p,path.start);
    for(let i=0;i<100;i++) {
      const frame=sampleTeachingMotion(p,path.start+(path.end-path.start)*i/100);
      expect(frame.contacts.some(c=>c.hand==='right'&&c.finger==='index'&&c.role==='support'&&!c.rotating)).toBe(true);
      expect(frame.pose.right.tips.index.point).toEqual(origin.pose.right.tips.index.point);
      expect(frame.pose.right.palm).toEqual(origin.pose.right.palm);
    }
  });

});
