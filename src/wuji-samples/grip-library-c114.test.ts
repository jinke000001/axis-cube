import { describe, it, expect } from "vitest";
import {
  applyAlgorithm,
  FACES,
  moveAngle,
  type Move,
  normalizeColors,
  snapshots,
  SLOTS,
  SOLVED,
  validateFacelets,
} from "../core/cube";
import { getFormula } from "../demonstrator/catalog";
import { hasMeasuredSupport, measureContact } from "../scene/finger-contact";
import { fingerJoints, type FingerIndex } from "../scene/finger-rig";
import diagrams from "../../evidence/museum-upgrade-2026-11-01/formulas/source-diagram-fixtures.json";
import arrows from "../../evidence/museum-upgrade-2026-11-01/formulas/pll-arrow-fixtures.json";
import{createGripLibraryC114}from'./grip-library-c114';
import inventory from'../wuji-exhibition-u8-r1/accepted-demonstrations.json';
const NEW_IDS=inventory.entries.map(r=>r.id);
const sides = ["left", "right"] as const,
  base = applyAlgorithm(SOLVED, "x2");
/** Net center orientation comes from the printed moves, including wide/slice
 * turns. Enumerate only the 24 proper rigid cube orientations. */
function stageReference(moves:Move[]){
 const centers=(s:string)=>[4,13,22,31,40,49].map(i=>s[i]).join(''),expected=centers(applyAlgorithm(base,moves)),queue=[base],seen=new Set(queue);
 for(let i=0;i<queue.length;i++){const state=queue[i];if(centers(state)===expected)return state;for(const rotation of ['x','y','z']){const next=applyAlgorithm(state,rotation);if(!seen.has(next)){seen.add(next);queue.push(next);}}}
 throw new Error('Printed centers do not form a proper rigid orientation');
}
describe("C114 migration all121 original source contract", () => {
  for (const id of NEW_IDS) {
    const source = getFormula(id)!,
      p = createGripLibraryC114(id),
      moves = source.steps.map((s) => s.move),
      states = snapshots(source.initialState, moves), finalBase=stageReference(moves);
    it(`${id}: independent original diagram, cross/other slots, exact source steps and directions`, () => {
      if(source.case.stage==='F2L'){
        const fixture=diagrams.f2l.find(f=>f.number===source.case.sourceNumber)!;
        expect(fixture).toBeDefined();
        for(const face of ['U','F','R'] as const)fixture[face].split('').forEach((c,i)=>{if(c!=='.')expect(source.initialState[FACES.indexOf(face)*9+i]).toBe(c);});
      }else if(source.case.stage==='OLL'){
        const fixture=diagrams.oll.find(f=>f.number===source.case.sourceNumber)!;
        expect(fixture).toBeDefined();
        expect(source.initialState.slice(0,9).split('').map(c=>c==='D'?'1':'0').join('')).toBe(fixture.top);
        expect([47,46,45,11,10,9,18,19,20,36,37,38].map(i=>source.initialState[i]==='D'?'1':'0').join('')).toBe(fixture.bars);
        expect(source.case.recognitionFixture).toEqual({kind:'oll',top:fixture.top,bars:fixture.bars});
      }
      if(source.case.stage==='PLL'){
        expect(source.initialState.slice(0,9)).toBe('DDDDDDDDD');
        const fixture=arrows.cases.find(f=>f.number===source.case.sourceNumber)!;
        const piece=(state:string,i:number)=>SLOTS.filter(s=>s.position.every((v,j)=>v===SLOTS[i].position[j])).map(s=>state[s.index]).sort().join('');
        const homes=Array.from({length:9},(_,i)=>piece(base,i)),expected=Array.from({length:9},(_,i)=>i);
        for(const cycle of fixture.cycles)cycle.forEach((slot,i)=>expected[slot]=cycle[(i+1)%cycle.length]);
        expect(expected.map((_,i)=>homes.indexOf(piece(source.initialState,i)))).toEqual(expected);
        expect(source.case.recognitionFixture).toEqual({kind:'pll',cycles:fixture.cycles});
      }
      const n = normalizeColors(source.initialState);
      expect(validateFacelets(n.facelets, n.palette).valid).toBe(true);
      for (const slot of SLOTS.filter(
        (s) =>
          s.position[1] < 1 && (source.case.stage!=="F2L" || !(s.position[0] === 1 && s.position[2] === 1)),
      ))
        {expect(states[0][slot.index]).toBe(base[slot.index]);expect(states.at(-1)![slot.index]).toBe(finalBase[slot.index]);}
      expect(states.at(-1)).toBe(finalBase);
      expect(p.steps.map((s) => s.move)).toEqual(moves);
      for (const step of source.steps) {
        const own = p.segments.filter((s) => s.index === step.index),
          turns = own.filter((s) => s.stage === "TURN");
        expect(turns).toHaveLength(step.move.notation==="y'"||step.move.turns === 2 && (['U','D'].includes(step.move.face)||step.move.kind==='slice') ? 2 : 1);
        expect(turns[0].sample(0).angle).toBeCloseTo(0, 9);
        expect(turns.at(-1)!.sample(1).angle).toBeCloseTo(
          moveAngle(step.move),
          9,
        );
        if (step.move.turns === 2 && step.move.face==='U') {
          expect(turns.map((t) => t.finger)).toEqual([2, 3]);
          expect(turns[0].sample(1).angle).toBeCloseTo(
            turns[1].sample(0).angle,
            9,
          );
        }
        if (step.hint) {
          const drive = turns[0]
            .sample(0.5)
            .contacts.find((c) => c.role === "drive")!;
          if(step.hint.hand)expect(drive.side).toBe(step.hint.hand);
          expect(drive.finger).toBe(step.hint.finger === "ring" ? 4 : step.hint.finger === "thumb" ? 1 : 2);
        }
        expect(p.sample(own[0].start).index).toBe(step.index);
        expect(applyAlgorithm(states[step.index], [step.move])).toBe(
          states[step.index + 1],
        );
      }
    });
    it(`${id}: contact/support, original limits and continuous seekable boundaries`, () => {
      const probes: number[] = [];
      for (let i = 0; i < p.segments.length; i++) {
        const s = p.segments[i],
          next = p.segments[i + 1];
        probes.push(s.start, s.start + s.duration * 0.5);
        for (const progress of [0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
          const f = s.sample(progress),
            move = (["TURN", "CONTACT"].includes(s.stage)||moves[s.index].kind==='rotation'&&f.contacts.some(c=>c.role==='drive'))
              ? moves[s.index]
              : undefined;
          expect(hasMeasuredSupport(f, f.contacts, move, f.angle)).toBe(true);
          for (const c of f.contacts)
            expect(measureContact(f[c.side], c, move, f.angle).valid).toBe(
              true,
            );
          for (const side of sides)
            for (let digit = 1; digit <= 5; digit++)
              for (const j of fingerJoints(side, digit as FingerIndex)) {
                const a = f[side].joints![j.name];
                expect(a).toBeGreaterThanOrEqual(j.lower - 1e-8);
                expect(a).toBeLessThanOrEqual(j.upper + 1e-8);
              }
          if (s.stage !== "TURN")
            expect(f.angle).toBeCloseTo(s.sample(0).angle, 9);
        }
        if (next) {
          const a = s.sample(1),
            b = next.sample(0);
          for (const side of sides) {
            expect(a[side].position.distanceTo(b[side].position)).toBeLessThan(
              1e-7,
            );
            expect(a[side].quaternion.angleTo(b[side].quaternion)).toBeLessThan(
              1e-6,
            );
            for (const [k, v] of Object.entries(a[side].joints!))
              expect(v).toBeCloseTo(b[side].joints![k], 7);
          }
        }
      }
      const forward = probes.map((t) => JSON.stringify(p.sample(t)));
      for (let i = probes.length - 1; i >= 0; i--)
        expect(JSON.stringify(p.sample(probes[i]))).toBe(forward[i]);
      expect(p.sample(p.duration)).toMatchObject({
        complete: true,
        index: moves.length,
        angle: 0,
      });
    });
  }
});
