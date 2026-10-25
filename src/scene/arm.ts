import {
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Side } from "./motion";
const up = new Vector3(0, 1, 0);
export const WRIST_LENGTH = 0.07;
export const WRIST_BACK_OFFSET = 0.08;
export const ARM_LENGTHS = { upper: 0.36, fore: 0.4 };
const alloy = new MeshStandardMaterial({
  color: "#b8c0c0",
  metalness: 0.86,
  roughness: 0.25,
});
const shell = new MeshStandardMaterial({
  color: "#dedfd5",
  metalness: 0.38,
  roughness: 0.28,
});
const graphite = new MeshStandardMaterial({
  color: "#252c2e",
  metalness: 0.68,
  roughness: 0.35,
});
const rubber = new MeshStandardMaterial({ color: "#151b1b", roughness: 0.7 });
const accent = new MeshStandardMaterial({
  color: "#d3a46d",
  metalness: 0.8,
  roughness: 0.3,
});
function mesh(
  geometry: ConstructorParameters<typeof Mesh>[0],
  material: MeshStandardMaterial,
  parent: Group,
) {
  const m = new Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function joint(radius = 0.032) {
  const g = new Group();
  mesh(
    new CylinderGeometry(radius, radius, 0.046, 48),
    graphite,
    g,
  ).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const cap = mesh(
      new CylinderGeometry(radius * 0.86, radius * 0.86, 0.005, 48),
      alloy,
      g,
    );
    cap.rotation.x = Math.PI / 2;
    cap.position.z = s * 0.026;
    const ring = mesh(
      new TorusGeometry(radius * 0.66, 0.0018, 8, 48),
      accent,
      g,
    );
    ring.position.z = s * 0.029;
    const hub = mesh(
      new CylinderGeometry(radius * 0.39, radius * 0.39, 0.006, 32),
      graphite,
      g,
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.z = s * 0.03;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const screw = mesh(
        new CylinderGeometry(0.0018, 0.0018, 0.0015, 6),
        graphite,
        g,
      );
      screw.rotation.x = Math.PI / 2;
      screw.position.set(
        Math.cos(a) * radius * 0.7,
        Math.sin(a) * radius * 0.7,
        s * 0.031,
      );
    }
  }
  return g;
}
function link(length: number) {
  const g = new Group();
  mesh(new CylinderGeometry(0.021, 0.025, length - 0.028, 40), alloy, g);
  mesh(new RoundedBoxGeometry(0.047, length * 0.77, 0.041, 3, 0.008), shell, g);
  const stripeLength = length * 0.6;
  const stripeTaper = (0.002 * stripeLength) / (length - 0.028);
  for (const s of [-1, 1]) {
    // Follow the tapered metal surface so the inlay never clips through it.
    mesh(
      new CylinderGeometry(
        0.0235 - stripeTaper,
        0.0235 + stripeTaper,
        stripeLength,
        16,
        1,
        true,
        (s === 1 ? 0 : Math.PI) - 0.26,
        0.52,
      ),
      graphite,
      g,
    );
  }
  for (const s of [-1, 1]) {
    const band = mesh(
      new CylinderGeometry(0.0255, 0.0255, 0.012, 40),
      graphite,
      g,
    );
    band.position.y = s * (length * 0.5 - 0.023);
  }
  const cable = new CatmullRomCurve3([
    new Vector3(0.019, -length * 0.43, -0.024),
    new Vector3(0.026, -length * 0.2, -0.029),
    new Vector3(0.026, length * 0.24, -0.029),
    new Vector3(0.018, length * 0.44, -0.024),
  ]);
  mesh(new TubeGeometry(cable, 20, 0.0024, 7, false), rubber, g);
  return g;
}
export class MechanicalArm {
  root = new Group();
  private upper = link(ARM_LENGTHS.upper);
  private fore = link(ARM_LENGTHS.fore);
  private elbow = joint(0.031);
  private shoulder = joint(0.037);
  private wrist = joint(0.023);
  private collar = new Group();
  private origin: Vector3;
  elbowPosition = new Vector3();
  wristPosition = new Vector3();
  constructor(side: Side) {
    const s = side === "left" ? -1 : 1;
    this.origin = new Vector3(s * 0.355, 0.155, -0.09);
    const base = new Group();
    base.position.set(s * 0.355, 0.034, -0.09);
    this.root.add(base);
    mesh(new CylinderGeometry(0.059, 0.064, 0.014, 64), graphite, base);
    const ring = mesh(
      new CylinderGeometry(0.055, 0.055, 0.008, 64),
      alloy,
      base,
    );
    ring.position.y = 0.012;
    const pedestal = mesh(
      new CylinderGeometry(0.029, 0.041, 0.087, 48),
      shell,
      base,
    );
    pedestal.position.y = 0.06;
    const bearing = mesh(
      new CylinderGeometry(0.037, 0.037, 0.013, 48),
      graphite,
      base,
    );
    bearing.position.y = 0.107;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const screw = mesh(
        new CylinderGeometry(0.003, 0.003, 0.002, 6),
        alloy,
        base,
      );
      screw.position.set(Math.cos(a) * 0.048, 0.009, Math.sin(a) * 0.048);
    }
    this.shoulder.position.copy(this.origin);
    this.upper.name = `${side}-upper-arm`;
    this.fore.name = `${side}-forearm`;
    this.collar.name = `${side}-wrist-collar`;
    this.root.add(
      this.upper,
      this.fore,
      this.elbow,
      this.shoulder,
      this.wrist,
      this.collar,
    );
    const adapterLength = Math.hypot(WRIST_LENGTH, WRIST_BACK_OFFSET);
    mesh(
      new CylinderGeometry(0.017, 0.024, adapterLength, 40),
      alloy,
      this.collar,
    );
    const seam = mesh(
      new CylinderGeometry(0.024, 0.024, 0.006, 40),
      graphite,
      this.collar,
    );
    seam.position.y = -adapterLength / 2 + 0.006;
  }
  update(wrist: Vector3, orientation: Quaternion) {
    const longitudinal = new Vector3(0, 0, 1).applyQuaternion(orientation);
    // The palm extends along local +Z. The forearm ends behind the palm at a
    // separate wrist bearing, rather than entering the hand's working volume.
    const mount = wrist
      .clone()
      .addScaledVector(longitudinal, -WRIST_LENGTH)
      .addScaledVector(
        new Vector3(1, 0, 0).applyQuaternion(orientation),
        -WRIST_BACK_OFFSET,
      );
    this.wristPosition.copy(mount);
    const delta = mount.clone().sub(this.origin),
      d = Math.max(
        0.04,
        Math.min(ARM_LENGTHS.upper + ARM_LENGTHS.fore - 0.005, delta.length()),
      ),
      direction = delta.normalize();
    const a =
        (ARM_LENGTHS.upper ** 2 - ARM_LENGTHS.fore ** 2 + d * d) / (2 * d),
      height = Math.sqrt(Math.max(0, ARM_LENGTHS.upper ** 2 - a * a));
    const inward = new Vector3(this.origin.x < 0 ? 1 : -1, 0, 0);
    const pole = new Vector3(
      0,
      Math.cos(Math.PI / 9),
      Math.sin(Math.PI / 9),
    ).applyQuaternion(new Quaternion().setFromUnitVectors(inward, direction));
    const elbow = this.origin
      .clone()
      .addScaledVector(direction, a)
      .addScaledVector(pole, height);
    this.elbowPosition.copy(elbow);
    const orient = (part: Group, from: Vector3, to: Vector3) => {
      part.position.copy(from).lerp(to, 0.5);
      part.quaternion.setFromUnitVectors(up, to.clone().sub(from).normalize());
    };
    orient(this.upper, this.origin, elbow);
    orient(this.fore, elbow, mount);
    const normal = elbow
      .clone()
      .sub(this.origin)
      .cross(mount.clone().sub(elbow))
      .normalize();
    this.elbow.position.copy(elbow);
    this.elbow.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    this.shoulder.quaternion.copy(this.elbow.quaternion);
    this.wrist.position.copy(mount);
    this.wrist.quaternion.copy(orientation);
    this.collar.position.copy(mount).lerp(wrist, 0.5);
    this.collar.quaternion.setFromUnitVectors(
      up,
      wrist.clone().sub(mount).normalize(),
    );
  }
}
