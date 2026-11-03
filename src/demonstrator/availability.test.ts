import { describe, expect, it } from 'vitest';
import { FORMULAS, getCaseFormulas } from './catalog';
import release from './release-manifest.json';
import { availableDemonstrationCount, isDemonstrationAvailable } from './availability';

describe('phased demonstration publication', () => {
  it('retains the complete 119-case source library while publishing exactly 54 known demonstrations', () => {
    expect(FORMULAS).toHaveLength(121);
    expect(new Set(FORMULAS.map(item => item.case.id)).size).toBe(119);
    expect(availableDemonstrationCount).toBe(54);
    expect(release.demonstrations).toHaveLength(54);
    const ids=new Set(FORMULAS.map(item=>item.id));
    for(const item of release.demonstrations) {
      expect(ids.has(item.id),item.id).toBe(true);
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.signature).toMatch(/^[a-f0-9]+$/);
    }
    expect(FORMULAS.filter(item=>!isDemonstrationAvailable(item.id))).toHaveLength(67);
  });
  it('fails closed for unverified and unknown formulas, independently of an available alternative', () => {
    expect(isDemonstrationAvailable('gan-pll-01')).toBe(false);
    expect(isDemonstrationAvailable('gan-pll-01-alt-1')).toBe(true);
    expect(getCaseFormulas('gan-pll-01')).toHaveLength(2);
    expect(isDemonstrationAvailable('gan-f2l-03')).toBe(false);
    expect(isDemonstrationAvailable('gan-f2l-99')).toBe(false);
  });
});
