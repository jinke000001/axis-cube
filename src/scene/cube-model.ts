import { Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS, NORMALS, SLOTS, moveAffects, type Face, type Palette, type Move } from "../core/cube";
import { CENTER, CUBE_SIZE } from "./motion";
export class CubeModel {
  root = new Group();
  private cubies: { group: Group; coord: Vector3 }[] = [];
  private stickers: { mesh: Mesh; index: number }[] = [];
  private cache = "";
  private materials: Record<Face, MeshStandardMaterial>;
  private unknown = new MeshStandardMaterial({
    color: "#394349",
    roughness: 0.7,
  });
  constructor() {
    this.root.position.copy(CENTER);
    const pitch = CUBE_SIZE / 3;
    const bodyGeometry = new RoundedBoxGeometry(
      pitch - 0.0012,
      pitch - 0.0012,
      pitch - 0.0012,
      3,
      0.0022,
    );
    const bodyMaterial = new MeshStandardMaterial({
      color: "#161b1d",
      metalness: 0.2,
      roughness: 0.3,
    });
    const stickerGeometry = new RoundedBoxGeometry(
      pitch - 0.004,
      pitch - 0.004,
      0.001,
      3,
      0.0028,
    );
    this.materials = Object.fromEntries(
      Object.entries(COLORS).map(([f, color]) => [
        f,
        new MeshStandardMaterial({ color, metalness: 0.03, roughness: 0.24 }),
      ]),
    ) as Record<Face, MeshStandardMaterial>;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          const group = new Group(),
            coord = new Vector3(x, y, z);
          const body = new Mesh(bodyGeometry, bodyMaterial);
          body.castShadow = true;
          body.receiveShadow = true;
          group.add(body);
          for (const slot of SLOTS.filter(
            (s) =>
              s.position[0] === x && s.position[1] === y && s.position[2] === z,
          )) {
            const sticker = new Mesh(
              stickerGeometry,
              this.materials[slot.face],
            );
            sticker.name = "sticker-" + slot.index;
            sticker.position
              .set(...slot.normal)
              .multiplyScalar((pitch - 0.0007) / 2);
            sticker.quaternion.setFromUnitVectors(
              new Vector3(0, 0, 1),
              new Vector3(...slot.normal),
            );
            sticker.castShadow = true;
            sticker.receiveShadow = true;
            group.add(sticker);
            this.stickers.push({ mesh: sticker, index: slot.index });
          }
          this.root.add(group);
          this.cubies.push({ group, coord });
        }
  }
  update(
    state: string,
    palette: Palette,
    orientation: Quaternion,
    turn?: Face | Move,
    angle = 0,
  ) {
    this.root.quaternion.copy(orientation);
    const cache = state + JSON.stringify(palette);
    if (cache !== this.cache) {
      this.cache = cache;
      for (const { mesh, index } of this.stickers)
        mesh.material =
          this.materials[palette[state[index] as Face]] ?? this.unknown;
    }
    const move = typeof turn === "string" ? { face: turn, turns: 1 as const, notation: turn } : turn;
    const n = move ? new Vector3(...NORMALS[move.face]) : new Vector3(),
      rotation = new Quaternion().setFromAxisAngle(n, angle);
    for (const { group, coord } of this.cubies) {
      group.position.copy(coord).multiplyScalar(CUBE_SIZE / 3);
      group.quaternion.identity();
      if (move && moveAffects(move, coord.toArray())) {
        group.position.applyQuaternion(rotation);
        group.quaternion.copy(rotation);
      }
    }
  }
  dispose() {
    const geometries = new Set<import("three").BufferGeometry>(),
      materials = new Set<MeshStandardMaterial>([
        this.unknown,
        ...Object.values(this.materials),
      ]);
    this.root.traverse((node) => {
      if (node instanceof Mesh) {
        geometries.add(node.geometry);
        materials.add(node.material as MeshStandardMaterial);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
}
