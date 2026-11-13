import inventory from './runtime-demonstrations.json';
import { getFormula } from '../demonstrator/catalog';
import { formulaKey } from './formula-key';

const entries = new Map(inventory.entries.map(e => [e.id, e]));
const verified = new Map<string, boolean>();

export const isDemonstrationAvailable = (id: string) => {
  const cached = verified.get(id);
  if (cached !== undefined) return cached;
  const f = getFormula(id);
  const e = entries.get(id);
  const ok = !!f && !!e && e.sourceKey === formulaKey(f);
  verified.set(id, ok);
  return ok;
};

export const availableDemonstrationCount = inventory.entries.filter(e => isDemonstrationAvailable(e.id)).length;
export const approvedEntry = (id: string) => (isDemonstrationAvailable(id) ? entries.get(id) : undefined);

