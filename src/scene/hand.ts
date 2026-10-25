import {
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import URDFLoader, { type URDFRobot } from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  canonical,
  CENTER,
  LEFT_APPROACH,
  type HandPose,
  type Side,
} from "./motion";
import { NORMALS, type Face, type Move } from "../core/cube";
import calibration from "./grips.json";
export class DexterousHand {
  root = new Group();
  robot: URDFRobot;
  private closed: Record<string, number> = {};
  private open: Record<string, number> = {};
  private materials: MeshStandardMaterial[] = [];
  constructor(
    robot: URDFRobot,
    readonly side: Side,
    recalibrate = false,
  ) {
    this.robot = robot;
    this.root.add(robot);
    this.applyTransform(canonical(side));
    robot.traverse((node) => {
      if (node instanceof Mesh) {
        let ancestor = node.parent;
        while (ancestor && !ancestor.name.includes(this.side))
          ancestor = ancestor.parent;
        const name = ancestor?.name ?? "";
        const dark = /link1|tip/.test(name) && !/palm/.test(name);
        const mat = new MeshStandardMaterial({
          color: dark ? "#444b4d" : "#d6d7cd",
          metalness: dark ? 0.58 : 0.42,
          roughness: dark ? 0.36 : 0.29,
        });
        node.material = mat;
        this.materials.push(mat);
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    for (const [name, joint] of Object.entries(robot.joints)) {
      if (joint.jointType === "fixed") continue;
      const n = Number(name.at(-1));
      const thumb = name.includes("finger1");
      this.open[name] = thumb
        ? [0.35, 0.15, 0.15, 0.15][n - 1]
        : [0.06, 0, 0.12, 0.15][n - 1];
      this.closed[name] = thumb
        ? [1, 0.6, 0.6, 0.55][n - 1]
        : [0.45, 0, 0.6, 0.65][n - 1];
    }
    if (recalibrate) this.fitGrip();
    else {
      this.closed = { ...calibration[side] };
      this.robot.setJointValues(this.closed);
      this.root.updateMatrixWorld(true);
    }
  }
  static async load(side: Side): Promise<DexterousHand> {
    const manager = new LoadingManager();
    const loader = new URDFLoader(manager);
    loader.parseCollision = false;
    loader.loadMeshCb = (url, mgr, material, onLoad) => {
      new STLLoader(mgr).load(
        url,
        (geometry) => {
          geometry.deleteAttribute("normal");
          const merged = mergeVertices(geometry, 1e-6);
          merged.computeVertexNormals();
          geometry.dispose();
          onLoad(new Mesh(merged, material));
        },
        undefined,
        (error) => onLoad(new Group(), error as Error),
      );
    };
    let robot: URDFRobot | undefined;
    let failure: Error | undefined;
    const complete = new Promise<void>((resolve, reject) => {
      manager.onLoad = () => (failure ? reject(failure) : resolve());
      manager.onError = (url) => {
        failure = new Error("机械手资源加载失败：" + url);
      };
    });
    robot = await loader.loadAsync(
      "/models/wuji/hand/body/urdf/" + side + ".urdf",
    );
    await complete;
    return new DexterousHand(robot, side);
  }
  private applyTransform(pose: HandPose) {
    this.root.position.copy(pose.position);
    this.root.quaternion.copy(pose.quaternion);
    this.root.updateMatrixWorld(true);
  }
  private fitGrip() {
    const sign = this.side === "left" ? -1 : 1;
    this.robot.setJointValues(this.closed);
    this.root.updateMatrixWorld(true);
    // Numerical fitting uses the manufacturer's actual revolute axes and limits.
    for (let finger = 1; finger <= 5; finger++) {
      const names = Array.from(
        { length: 4 },
        (_, i) => this.side + "_finger" + finger + "_joint" + (i + 1),
      );
      const tip =
        this.robot.links[this.side + "_finger" + finger + "_tip_link"];
      // The manufacturer's left-hand URDF already mirrors its local lateral axis.
      // Both palms therefore share world-space finger lanes after the wrist basis transform.
      const target =
        finger === 1
          ? new Vector3(sign * 0.05, CENTER.y - 0.029, 0.038)
          : new Vector3(
              sign * 0.05,
              CENTER.y + 0.035 - (finger - 2) * 0.006,
              [0.029, 0.007, -0.014, -0.034][finger - 2],
            );
      if (this.side === "left")
        target.sub(CENTER).applyQuaternion(LEFT_APPROACH).add(CENTER);
      const pos = new Vector3();
      const cost = () => {
        this.root.updateMatrixWorld(true);
        tip.getWorldPosition(pos);
        return pos.distanceToSquared(target);
      };
      const meshes: Mesh[] = [];
      this.robot.links[this.side + "_finger" + finger + "_link1"].traverse(
        (node) => {
          if (node instanceof Mesh) meshes.push(node);
        },
      );
      for (let calibration = 0; calibration < 4; calibration++) {
        let best = cost();
        for (let pass = 0; pass < 100; pass++)
          for (const name of names) {
            const joint = this.robot.joints[name],
              old = joint.angle;
            const step = (calibration ? 0.05 : 0.2) * Math.pow(0.97, pass);
            let value = old;
            for (const dir of [-1, 1]) {
              joint.setJointValue(old + dir * step);
              const score = cost();
              if (score < best) {
                best = score;
                value = joint.angle;
              }
            }
            joint.setJointValue(value);
          }
        // Tip-frame origins do not coincide with rubber-pad surfaces. Calibrate
        // against the actual mesh so a mathematically correct tip does not float.
        this.root.updateMatrixWorld(true);
        let gap = Infinity;
        for (const mesh of meshes) {
          const vertices = mesh.geometry.getAttribute("position");
          for (let i = 0; i < vertices.count; i++) {
            pos
              .fromBufferAttribute(vertices, i)
              .applyMatrix4(mesh.matrixWorld)
              .sub(CENTER);
            if (Math.abs(pos.y) < 0.0445 && Math.abs(pos.z) < 0.0445)
              gap = Math.min(gap, sign * pos.x - 0.045);
          }
        }
        if (Number.isFinite(gap)) target.x -= sign * (gap - 0.00015);
      }
      for (const name of names)
        this.closed[name] = this.robot.joints[name].angle;
    }
    this.robot.setJointValues(this.closed);
    this.root.updateMatrixWorld(true);
  }
  update(pose: HandPose) {
    this.applyTransform(pose);
    if (pose.joints) {
      this.robot.setJointValues(pose.joints);
      this.root.updateMatrixWorld(true);
      return;
    }
    for (const name of Object.keys(this.closed)) {
      const finger = Number(name.match(/finger(\d)/)?.[1]),
        joint = Number(name.at(-1));
      // Index and middle fingers establish contact before the thumb secures it.
      // Distal joints follow their bases; release runs the same continuous path
      // in reverse. Both calibrated end poses remain unchanged.
      const exponent =
        [1.34, 1, 1.06, 1.14, 1.24][finger - 1] + (joint - 1) * 0.05;
      const closure = Math.pow(Math.max(0, Math.min(1, pose.closed)), exponent);
      this.robot.setJointValue(
        name,
        this.open[name] + (this.closed[name] - this.open[name]) * closure,
      );
    }
  }
  setGhost(value: boolean) {
    for (const material of this.materials) {
      material.transparent = value;
      material.opacity = value ? 0.22 : 1;
      material.depthWrite = !value;
    }
  }
  dispose() {
    this.root.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry.dispose();
        (Array.isArray(node.material)
          ? node.material
          : [node.material]
        ).forEach((m) => m.dispose());
      }
    });
  }
  getGripMetrics() {
    this.root.updateMatrixWorld(true);
    return Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        i + 1,
        this.robot.links[this.side + "_finger" + (i + 1) + "_tip_link"]
          .getWorldPosition(new Vector3())
          .toArray(),
      ]),
    );
  }
  penetration(orientation = new Quaternion(), turn?: Face | Move, angle = 0) {
    let max = 0,
      count = 0;
    const point = new Vector3(),
      turned = new Vector3(),
      inverse = orientation.clone().invert();
    const move = typeof turn === "string" ? { face: turn, turns: 1 as const, notation: turn } : turn;
    const normal = move ? new Vector3(...NORMALS[move.face]) : null;
    const turnInverse = new Quaternion().setFromAxisAngle(
      normal ?? new Vector3(1, 0, 0),
      -angle,
    );
    const boxDepth = (p: Vector3) =>
      Math.min(
        0.045 - Math.abs(p.x),
        0.045 - Math.abs(p.y),
        0.045 - Math.abs(p.z),
      );
    this.root.updateMatrixWorld(true);
    this.root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const vertices = node.geometry.getAttribute("position");
      for (let i = 0; i < vertices.count; i++) {
        point
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(node.matrixWorld)
          .sub(CENTER)
          .applyQuaternion(inverse);
        let depth = boxDepth(point);
        if (normal && angle) {
          turned.copy(point).applyQuaternion(turnInverse);
          // Three rigid slabs also model M/E/S, wide turns and whole rotations.
          // Check each slab in its own frame; the unturned cube AABB is wrong
          // for a partly turned layer and can miss a protruding cubie corner.
          depth = -Infinity;
          for (const layer of [-1, 0, 1]) {
            const moving = (move!.layers ?? [1]).some((n) => n === layer);
            const p = moving ? turned : point;
            const axis = p.dot(normal);
            depth = Math.max(depth, Math.min(
              boxDepth(p), axis - (layer * 0.03 - 0.015), (layer * 0.03 + 0.015) - axis,
            ));
          }
        }
        max = Math.max(max, depth);
        if (depth > 0.0003) count++;
      }
    });
    return { maxDepthMM: Math.round(max * 100000) / 100, vertices: count };
  }
}
