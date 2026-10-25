import { describe, expect, it } from "vitest";
import { applyAlgorithm, DEFAULT_PALETTE, parseAlgorithm, snapshots, SOLVED } from "../core/cube";
import { solveCFOP } from "../core/cfop";
import { compileFingerSolve } from "./finger-solve-program";
import { hasMeasuredSupport, measureContact } from "./finger-contact";
import { CubeModel } from "./cube-model";
import { Mesh, MeshStandardMaterial, Vector3 } from "three";

const cases=["F F' F2 F2'","D D' D2 D2'","B B' B2 B2'","F B F' B' D2 R U R' U' F2","U R U' R' U' L' U L","x U x'","M M' M2 M2'","Rw U Rw' Lw U' Lw2'","x2 R x2'"];
describe("complete finger score",()=>{
  it.each(cases)("%s joins measured poses and preserves actual support",(algorithm)=>{
    const program=compileFingerSolve(parseAlgorithm(algorithm));
    for(let i=0;i<program.segments.length;i++){
      const segment=program.segments[i];
      if(i){
        const a=program.segments[i-1].sample(1),b=segment.sample(0);
        for(const side of ["left","right"] as const){
          expect(a[side].position.distanceTo(b[side].position),`${i} ${segment.phase}`).toBeLessThan(1e-7);
          expect(a[side].quaternion.angleTo(b[side].quaternion)).toBeLessThan(1e-7);
          for(const key of Object.keys(a[side].joints!))expect(Math.abs(a[side].joints![key]-b[side].joints![key])).toBeLessThan(1e-7);
        }
      }
      for(let j=0;j<=16;j++){
        const frame=segment.sample(j/16),move=segment.stage==='TURN'?program.steps[segment.index].move:undefined;
        expect(hasMeasuredSupport(frame,frame.contacts,move,frame.angle),`${i} ${segment.phase} support`).toBe(true);
        for(const contact of frame.contacts)expect(measureContact(frame[contact.side],contact,move,frame.angle).valid,`${i} ${segment.phase} ${contact.side}/${contact.finger}`).toBe(true);
      }
    }
    expect(program.sample(5).complete).toBe(true);expect(program.sample(5).index).toBe(program.steps.length);
    expect(applyAlgorithm(SOLVED,program.steps.map((step)=>step.move))).toBe(applyAlgorithm(SOLVED,algorithm));
  });
  it("plays a genuine full CFOP solve with 54-sticker continuity at every move boundary",()=>{
    const state=applyAlgorithm(SOLVED,"R U2 F' L D B2 R' F2 U L2 D' B R2 U' F");
    const solved=solveCFOP(state),moves=parseAlgorithm(solved.solution),states=snapshots(state,moves),program=compileFingerSolve(moves),cube=new CubeModel();
    const visual=()=>{
      cube.root.updateMatrixWorld(true);const stickers:string[]=[];
      cube.root.traverse((node)=>{if(node instanceof Mesh&&node.name.startsWith('sticker-'))stickers.push(node.getWorldPosition(new Vector3()).toArray().map(v=>Math.round(v*1e5)).join(',')+':'+(node.material as MeshStandardMaterial).color.getHexString());});
      return stickers.sort();
    };
    for(let i=0;i<moves.length;i++){
      const turn=program.segments.filter(s=>s.index===i&&s.stage==='TURN').at(-1)!;
      const end=turn.sample(1);
      cube.update(states[i],DEFAULT_PALETTE,program.sample(0).orientation,moves[i],end.angle);
      const before=visual();cube.update(states[i+1],DEFAULT_PALETTE,program.sample(0).orientation);
      expect(visual(),`${i} ${moves[i].notation}`).toEqual(before);
    }
    expect(states.at(-1)).toBe(SOLVED);expect(program.statistics.fingerTurns).toBeGreaterThan(0);
    expect(program.statistics.reorientations).toBe(0);expect(program.sample(5).index).toBe(moves.length);
    cube.dispose();
  });
});
