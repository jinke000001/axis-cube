import { createHash } from 'node:crypto';

/** Stable digest of the hand specification. The stored geometryDigest field is excluded. */
export function canonicalizeHandSpec(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeHandSpec).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'geometryDigest');
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeHandSpec(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function handGeometryDigest(spec: unknown): string {
  return createHash('sha256').update(canonicalizeHandSpec(spec)).digest('hex');
}
