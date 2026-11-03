import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import shortCollision from './audit-fixtures/oll31-v51-short-collision.json';

function teachingHandGltf() {
  const data = readFileSync(new URL('../../public/models/teaching-hand/axis-teaching-hand.glb', import.meta.url));
  const jsonLength = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')) as {
    nodes: { name?: string }[];
    materials: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number } }[];
  };
}

describe('teaching hand skin', () => {
  it('keeps the collision contract and loads a warm-white rounded shell', () => {
    const metadata = readFileSync(new URL('../../art/teaching-hand/rig.json', import.meta.url));
    expect(createHash('sha256').update(metadata).digest('hex')).toBe(shortCollision.geometryMetadataSha256);
    const document = teachingHandGltf();
    const names = document.nodes.map(node => node.name);
    for (const side of ['left', 'right']) {
      expect(names).toContain(`${side}_palm`);
      expect(names).toContain(`${side}_shoulder`);
      expect(names).toContain(`${side}_elbow`);
      for (const finger of ['thumb', 'index', 'middle', 'ring', 'little']) {
        for (const joint of ['mcp', 'pip', 'dip']) expect(names).toContain(`${side}_${finger}_${joint}`);
      }
    }
    expect(names.some(name => name?.includes('inlay') || name?.includes('palm_inner'))).toBe(false);
    const shell = document.materials.find(material => material.name === 'AXIS | muji shell');
    expect(shell?.pbrMetallicRoughness?.metallicFactor ?? 1).toBeLessThan(0.1);
    expect(shell?.pbrMetallicRoughness?.baseColorFactor?.[0] ?? 0).toBeGreaterThan(0.7);
    expect(document.materials.some(material => /titanium|ice inlay/i.test(material.name ?? ''))).toBe(false);
  });
});
