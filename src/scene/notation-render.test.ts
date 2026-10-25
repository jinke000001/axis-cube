import { it, expect } from "vitest";
import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { applyAlgorithm, applyMove, DEFAULT_PALETTE, moveAngle, parseMove, SOLVED } from "../core/cube";
import { CubeModel } from "./cube-model";

it("keeps all 54 visible stickers continuous when slice, wide and whole turns become state", () => {
  const cube = new CubeModel();
  const state = applyAlgorithm(SOLVED, "R U F2 D' B L2");
  const orientation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.71);
  const snapshot = () => {
    const result: string[] = [];
    cube.root.updateMatrixWorld(true);
    cube.root.traverse((node) => {
      if (!(node instanceof Mesh) || !node.name.startsWith("sticker-")) return;
      const p = node.getWorldPosition(new Vector3()).toArray().map((v) => Math.round(v * 1e6)).join(",");
      result.push(p + ":" + (node.material as MeshStandardMaterial).color.getHexString());
    });
    return result.sort();
  };
  for (const symbol of ["U", "R", "F", "D", "L", "B", "M", "E", "S", "Rw", "Uw", "Fw", "Dw", "Lw", "Bw", "x", "y", "z"])
    for (const suffix of ["", "'", "2", "2'"]) {
      const move = parseMove(symbol + suffix);
      cube.update(state, DEFAULT_PALETTE, orientation, move, moveAngle(move));
      const animated = snapshot();
      cube.update(applyMove(state, move), DEFAULT_PALETTE, orientation);
      expect(snapshot(), move.notation).toEqual(animated);
      expect(animated).toHaveLength(54);
    }
  cube.dispose();
});
