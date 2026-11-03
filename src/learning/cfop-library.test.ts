import {describe,expect,it} from 'vitest';
import {applyAlgorithm,FACES,normalizeColors,parseAlgorithm,SLOTS,SOLVED,validateFacelets} from '../core/cube';
import {CFOP_CASES,getCFOPCase,type CFOPCase} from './cfop-library';
import originalDiagrams from '../../evidence/museum-upgrade-2026-11-01/formulas/source-diagram-fixtures.json';
import originalArrows from '../../evidence/museum-upgrade-2026-11-01/formulas/pll-arrow-fixtures.json';

const base = applyAlgorithm(SOLVED,'x2');
const stateOf = (item: CFOPCase) => applyAlgorithm(SOLVED,item.setup);
const centers = (state: string) => FACES.map((_,i)=>state[i*9+4]).join('');
const solvedByCenters = (state: string) => FACES.every((_,i)=>state.slice(i*9,i*9+9)===state[i*9+4].repeat(9));
const piece = (state: string,topIndex: number) => SLOTS
  .filter(s=>s.position.every((v,i)=>v===SLOTS[topIndex].position[i]))
  .map(s=>state[s.index]).sort().join('');
const homes = Array.from({length:9},(_,i)=>piece(base,i));

describe('GAN CFOP reference shelf, source-numbered and independent of visitor input',()=>{
  it('contains exactly 41 F2L + 57 OLL + 21 PLL, with unique source ids and valid lesson links',()=>{
    expect(CFOP_CASES).toHaveLength(119);
    expect(new Set(CFOP_CASES.map(c=>c.id)).size).toBe(119);
    for(const [stage,count] of [['F2L',41],['OLL',57],['PLL',21]] as const){
      const cases=CFOP_CASES.filter(c=>c.stage===stage);
      expect(cases.map(c=>c.sourceNumber)).toEqual(Array.from({length:count},(_,i)=>i+1));
      for(const item of cases){
        expect(item.id).toBe(`gan-${stage.toLowerCase()}-${String(item.sourceNumber).padStart(2,'0')}`);
        expect(getCFOPCase(item.id)).toBe(item);
        expect(item.recognition.trim()).not.toBe('');
        expect(item.orientation).toContain('蓝色中心朝前');
        expect(item.sourceUrl).toBe('https://www.gancube.com/pages/3x3x3-cfop-guide-gancube');
        expect(item.lessonId).toBe(stage==='F2L'?'f2l-foundations':stage==='OLL'?'two-look-oll':'two-look-pll');
      }
    }
    expect(getCFOPCase('oll-1')).toBeUndefined();
    expect(getCFOPCase('gan-oll-58')).toBeUndefined();
  });

  it.each(CFOP_CASES.map(item=>[item.id,item] as const))('%s parses and starts in the chart holding and correct stage',(_id,item)=>{
    expect(parseAlgorithm(item.algorithm).length).toBeGreaterThan(0);
    const state=stateOf(item);
    const normalized=normalizeColors(state);
    expect(validateFacelets(normalized.facelets,normalized.palette).valid).toBe(true);
    expect(centers(state)).toBe(centers(base));
    // These stage preconditions are independent constraints on the generated setup.
    // They reject an arbitrary scramble even if its inverse would return to solved.
    const protectedSlots=SLOTS.filter(s=>item.stage==='F2L'
      ? s.position[1]<1 && !(s.position[0]===1 && s.position[2]===1)
      : s.position[1]<1);
    for(const slot of protectedSlots)expect(state[slot.index],`${slot.face}${slot.index%9}`).toBe(base[slot.index]);
    if(item.stage==='PLL')expect(state.slice(0,9)).toBe('DDDDDDDDD');
    const end=applyAlgorithm(state,item.algorithm);
    expect(solvedByCenters(end)).toBe(true);
    for(const alternate of item.alternateAlgorithms??[]){
      expect(parseAlgorithm(alternate).length).toBeGreaterThan(0);
      expect(solvedByCenters(applyAlgorithm(state,alternate)),alternate).toBe(true);
    }
  });

  it.each(originalDiagrams.f2l.map(f=>[f.number,f] as const))('F2L %s matches all colored stickers independently sampled from the source drawing',(_number,fixture)=>{
    const item=getCFOPCase(`gan-f2l-${String(fixture.number).padStart(2,'0')}`)!;
    const state=stateOf(item);
    expect(item.recognitionFixture).toEqual({kind:'f2l',U:fixture.U,F:fixture.F,R:fixture.R});
    for(const face of ['U','F','R'] as const){
      const offset=FACES.indexOf(face)*9;
      fixture[face].split('').forEach((expected,i)=>{
        if(expected!=='.')expect(state[offset+i],`${face}${i}`).toBe(expected);
      });
    }
  });

  it.each(originalDiagrams.oll.map(f=>[f.number,f] as const))('OLL %s matches all 9 top cells AND all 12 source side bars',(_number,fixture)=>{
    const item=getCFOPCase(`gan-oll-${String(fixture.number).padStart(2,'0')}`)!;
    const state=stateOf(item);
    const top=state.slice(0,9).split('').map(c=>c==='D'?'1':'0').join('');
    const bars=[47,46,45,11,10,9,18,19,20,36,37,38].map(i=>state[i]==='D'?'1':'0').join('');
    expect(item.recognitionFixture).toEqual({kind:'oll',top:fixture.top,bars:fixture.bars});
    expect(top).toBe(fixture.top);
    expect(bars).toBe(fixture.bars);
    expect((top+bars).replaceAll('0','')).toHaveLength(9);
  });

  it.each(originalArrows.cases.map(f=>[f.number,f] as const))('PLL %s matches manually read arrow destinations, including cycle direction',(_number,fixture)=>{
    const item=getCFOPCase(`gan-pll-${String(fixture.number).padStart(2,'0')}`)!;
    const state=stateOf(item);
    const expected=Array.from({length:9},(_,i)=>i);
    for(const cycle of fixture.cycles)cycle.forEach((slot,i)=>expected[slot]=cycle[(i+1)%cycle.length]);
    expect(item.recognitionFixture).toEqual({kind:'pll',cycles:fixture.cycles});
    const actual=expected.map((_,i)=>homes.indexOf(piece(state,i)));
    expect(actual).toEqual(expected);
  });

  it('keeps GAN numbering distinct from common PLL names and preserves the two printed alternatives',()=>{
    expect(getCFOPCase('gan-pll-14')?.name.startsWith('Rb')).toBe(true);
    expect(getCFOPCase('gan-pll-15')?.name.startsWith('Ra')).toBe(true);
    expect(getCFOPCase('gan-pll-20')?.name.startsWith('Nb')).toBe(true);
    expect(getCFOPCase('gan-pll-21')?.name.startsWith('Na')).toBe(true);
    expect(CFOP_CASES.filter(c=>c.alternateAlgorithms?.length).map(c=>c.sourceNumber)).toEqual([1,2]);
  });
});
