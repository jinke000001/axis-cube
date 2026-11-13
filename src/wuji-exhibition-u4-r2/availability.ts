import { isDemonstrationAvailable, availableDemonstrationCount, approvedEntry as approvedU8Entry } from '../wuji-exhibition-u8-r1/availability';

export { isDemonstrationAvailable, availableDemonstrationCount };
export const approvedEntry = (id: string) => {
  const entry = approvedU8Entry(id);
  return entry ? { ...entry, export: entry.u4Export ?? entry.export } : undefined;
};

