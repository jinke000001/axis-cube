import {describe,expect,it} from 'vitest';
import {Quaternion,Vector3} from 'three';
import type {Vec3} from '../core/cube';
import {interpolateFingerDirections,interpolateSwingFingerDirections} from './finger-path';
describe('free finger joint interpolation',()=> {
  it('preserves the folded shape during a rigid 180 degree MCP reorientation',()=> {
    const from:Vec3[]=[[0,1,0],[.8,-.6,0],[.6,.8,0]];
    const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI);
    const to=from.map(d=>new Vector3().fromArray(d).applyQuaternion(rotation).toArray() as Vec3);
    const tip=(directions:Vec3[])=>directions.reduce((p,d,i)=>p.addScaledVector(new Vector3().fromArray(d),[.045,.04,.019][i]),new Vector3()).length();
    for(let i=0;i<=20;i++) {
      const result=interpolateFingerDirections(from,to,i/20);
      expect(tip(result)).toBeCloseTo(tip(from),10);
      for(const direction of result)expect(new Vector3().fromArray(direction).length()).toBeCloseTo(1,10);
    }
    const result=interpolateFingerDirections(from,to,1);
    for(let i=0;i<3;i++)expect(new Vector3().fromArray(result[i]).distanceTo(new Vector3().fromArray(to[i]))).toBeLessThan(1e-10);
  });
  it('does not turn fold-plane twist into an inward MCP-axis detour',()=> {
    // F2L01's upper approach had a 144-degree fold-plane twist. Whole-frame
    // slerp drove the first bone's x to -0.55 even though both ends face out.
    const from:Vec3[]=[[0,1,0],[.29174967034735666,-.5766796765191541,.7631007014424588],
      [.25508438953938656,-.38933686767878517,-.8850699168310888]];
    const to:Vec3[]=[[.18455735622762925,-.402599870934093,.8965778974445666],
      [.5186623898300307,.4171904599934114,.7462850966395397],[.6301885752914568,.6469715687966036,-.4292902849366448]];
    for(let sample=0;sample<=100;sample++) {
      const actual=interpolateSwingFingerDirections(from,to,sample/100);
      expect(actual[0][0]).toBeGreaterThanOrEqual(-1e-10);
      for(const d of actual)expect(new Vector3(...d).length()).toBeCloseTo(1,10);
    }
    expect(interpolateSwingFingerDirections(from,to,0)).toEqual(from);
    expect(interpolateSwingFingerDirections(from,to,1)).toEqual(to);
  });
  it('keeps the observed OLL50 free approach within its endpoint bend ranges',()=> {
    // Published v34: this 120° → 69.7° PIP transition incorrectly extended
    // to 40.7° mid-flight, producing an unnecessary swing through neighbours.
    const from:Vec3[]=[[.19104797766271445,-.7974176577540127,-.5723860142710435],
      [.3600710251294464,.8970948649732642,-.25606573394507615],[-1,0,0]];
    const to:Vec3[]=[[-.4327215817938084,.19452828229707148,-.880290168090281],
      [-.992153680992685,-.10291909036697368,.07098404138044245],[-.8036745338858239,-.39868282162961444,.4417683231297294]];
    const bend=(d:Vec3[],i:number)=>Math.acos(Math.max(-1,Math.min(1,new Vector3().fromArray(d[i]).dot(new Vector3().fromArray(d[i+1])))));
    for(let k=0;k<=100;k++) {
      const result=interpolateFingerDirections(from,to,k/100);
      for(const i of [0,1]) {
        expect(bend(result,i)).toBeGreaterThanOrEqual(Math.min(bend(from,i),bend(to,i))-1e-10);
        expect(bend(result,i)).toBeLessThanOrEqual(Math.max(bend(from,i),bend(to,i))+1e-10);
      }
    }
  });

});
