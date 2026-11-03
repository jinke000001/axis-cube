import { Mesh, type Object3D, type Raycaster } from "three";
import { SLOTS, type Face, type Vec3 } from "../core/cube";
export type PiecePick = (colors: Face[], position: Vec3) => void;
/** Physical identity is read from every sticker at the selected location, not face names. */
export function pieceAtSticker(state: string, index: number): { colors: Face[]; position: Vec3 } | undefined {
  const slot = SLOTS[index];
  if (!slot || state.length !== 54) return undefined;
  const position: Vec3 = [...slot.position];
  return { position, colors: SLOTS.filter(other => other.position.every((value, axis) => value === position[axis])).map(other => state[other.index] as Face) };
}

/** Resolve the nearest physical body/sticker, including the dark rim between stickers. */
export function pieceFromRay(state: string, cube: Object3D, ray: Raycaster) {
  const hit = ray.intersectObject(cube, true).find(result => result.object instanceof Mesh);
  if (!hit) return undefined;
  const sticker = hit.object.name.startsWith("sticker-") ? hit.object : hit.object.parent?.children.find(child => child.name.startsWith("sticker-"));
  return sticker ? pieceAtSticker(state, Number(sticker.name.slice(8))) : undefined;
}
