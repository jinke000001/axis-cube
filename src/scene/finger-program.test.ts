import { describe, expect, it } from "vitest";
import { FINGER_STUDIES } from "../core/finger-studies";
import { parseAlgorithm } from "../core/cube";
import { compileFingerProgram } from "./finger-program";
import { hasMeasuredSupport, measureContact } from "./finger-contact";
import { fingerJoints } from "./finger-rig";

describe("joined finger phrases", () => {
  it.each(FINGER_STUDIES.map((s)=>[s.name,s.algorithm]))("%s has continuous joins and real drive/support contacts", (_name,algorithm) => {
    const program=compileFingerProgram(parseAlgorithm(algorithm));
    for(let i=0;i<program.segments.length;i++) {
      const segment=program.segments[i];
      if(i) {
        const previous=program.segments[i-1].sample(1),next=segment.sample(0);
        for(const side of ["left","right"] as const) {
          expect(previous[side].position.distanceTo(next[side].position),`${i} ${segment.phase} wrist`).toBeLessThan(1e-8);
          expect(previous[side].quaternion.angleTo(next[side].quaternion)).toBeLessThan(1e-7);
          for(const joint of Object.keys(previous[side].joints!))expect(Math.abs(previous[side].joints![joint]-next[side].joints![joint]),`${i} ${segment.phase} ${joint}`).toBeLessThan(1e-8);
        }
      }
      for(let j=0;j<=32;j++) {
        const frame=segment.sample(j/32),move=segment.stage==="TURN"?program.steps[segment.index].move:undefined;
        expect(hasMeasuredSupport(frame,frame.contacts,move,frame.angle),`${i} ${segment.phase} support at ${j}`).toBe(true);
        for(const contact of frame.contacts)expect(measureContact(frame[contact.side],contact,move,frame.angle).valid,`${i} ${segment.phase} contact ${contact.side}/${contact.finger} at ${j}`).toBe(true);
        if(move)expect(frame.contacts.some((c)=>c.role==="drive")).toBe(true);
        for(const side of ["left","right"] as const)for(const finger of [1,2,3,4,5] as const)for(const joint of fingerJoints(side,finger)) {
          expect(frame[side].joints![joint.name]).toBeGreaterThanOrEqual(joint.lower-1e-8);
          expect(frame[side].joints![joint.name]).toBeLessThanOrEqual(joint.upper+1e-8);
        }
      }
    }
    expect(program.sample(5).complete).toBe(true);
    expect(program.sample(5).index).toBe(parseAlgorithm(algorithm).length);
    expect(program.duration).toBe(5);
  });
  it("keeps the cube frame fixed and gives the same pose during reverse seeking", () => {
    const program=compileFingerProgram(parseAlgorithm("R U R' U R U2' R'"));
    const times=Array.from({length:601},(_,i)=>i/120);
    const forward=times.map((time)=>JSON.stringify(program.sample(time)));
    [...times].reverse().forEach((time,i)=>{
      expect(JSON.stringify(program.sample(time))).toBe(forward[600-i]);
      expect(program.sample(time).orientation.toArray()).toEqual([0,0,0,1]);
    });
    expect(program.statistics.retainedWrists).toBeGreaterThan(0);
  });
});
