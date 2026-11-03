import { describe, expect, it } from "vitest";
import { applyAlgorithm, DEFAULT_PALETTE, SLOTS, SOLVED } from "../core/cube";
import { pieceAtSticker, pieceFromRay } from "./piece-pick";

import { Group, Quaternion, Raycaster, Vector3 } from "three";
import { CubeModel } from "../scene/cube-model";
import { CENTER } from "../scene/motion";

describe("lesson selection identifies the physical cubie", () => {
  it.each([0, 3.4])("raycasts physical corners, edges and dark rims at station offset %s", offset => {
    const state = applyAlgorithm(SOLVED, "R U F2 L'"), cube = new CubeModel(), station = new Group();
    station.position.x = offset; station.add(cube.root); cube.update(state, DEFAULT_PALETTE, new Quaternion()); station.updateMatrixWorld(true);
    for (const [x, y, index] of [[.03, .03, 20], [0, .03, 19], [0, 0, 22], [.0137, 0, 22]]) {
      const ray = new Raycaster(new Vector3(x + offset, CENTER.y + y, .2), new Vector3(0, 0, -1));
      const hit = pieceFromRay(state, cube.root, ray);
      expect(hit).toEqual(pieceAtSticker(state, index));
    }
    cube.dispose();
  });
  it("reads every actual colour after scrambling and whole-cube rotations", () => {
    const state = applyAlgorithm(SOLVED, "R U F2 L' D x y2 M Rw");
    for (const slot of SLOTS) {
      const piece = pieceAtSticker(state, slot.index)!;
      expect(piece.position).toEqual(slot.position);
      const expected = SLOTS.filter(other => other.position.join() === slot.position.join()).map(other => state[other.index]);
      expect(piece.colors).toEqual(expected);
      expect(piece.colors).toHaveLength(slot.position.filter(value => value !== 0).length);
    }
    expect(pieceAtSticker(state, 8)?.colors).not.toEqual(pieceAtSticker(SOLVED, 8)?.colors);
  });
  it("rejects missing state and out-of-bounds selections", () => {
    expect(pieceAtSticker("", 0)).toBeUndefined();
    expect(pieceAtSticker(SOLVED, 54)).toBeUndefined();
  });
});
