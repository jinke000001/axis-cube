import release from './release-manifest.json';

// Publication eligibility is separate from the complete source-formula library.
// A missing entry never falls back to an older or unverified motion.
const availableIds = new Set(release.demonstrations.map(item => item.id));
export const availableDemonstrationCount = availableIds.size;
export const isDemonstrationAvailable = (id:string):boolean => availableIds.has(id);
