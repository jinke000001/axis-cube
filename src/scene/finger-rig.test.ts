import { describe, it, expect } from "vitest";
import { DOMParser, Document, Element } from "linkedom";
import URDFLoader from "urdf-loader";
import { Group, Quaternion, Vector3 } from "three";
import { fingerJoints, fitFinger, forwardFinger, type FingerIndex } from "./finger-rig";
import leftURDF from "../../public/models/wuji/hand/body/urdf/left.urdf?raw";
import rightURDF from "../../public/models/wuji/hand/body/urdf/right.urdf?raw";

describe("actual Wuji finger kinematics", () => {
  it("matches the independently loaded URDF tree at every finger across its real joint limits", () => {
    Object.assign(globalThis, { DOMParser, Document, Element });
    for (const side of ["left", "right"] as const) {
      const loader = new URDFLoader();
      loader.loadMeshCb = (_url, _manager, _material, onLoad) => onLoad(new Group());
      const robot = loader.parse(side === "left" ? leftURDF : rightURDF);
      const wrist = { position: new Vector3(side === "left" ? -0.09 : 0.09, 0.34, 0.14), quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.83) };
      robot.position.copy(wrist.position); robot.quaternion.copy(wrist.quaternion);
      for (const finger of [1, 2, 3, 4, 5] as FingerIndex[])
        for (let sample = 0; sample < 17; sample++) {
          const joints = fingerJoints(side, finger);
          const angles = joints.map((j, i) => j.lower + (j.upper - j.lower) * ((sample * (i + 3) + 7) % 17) / 16);
          joints.forEach((j, i) => robot.setJointValue(j.name, angles[i]));
          robot.updateMatrixWorld(true);
          const link = robot.links[`${side}_finger${finger}_tip_link`];
          const pad = new Vector3(-0.003, 0.001, -0.006);
          const actual = link.localToWorld(pad.clone());
          const ours = forwardFinger(side, finger, angles, wrist, pad);
          expect(ours.position.distanceTo(actual)).toBeLessThan(1e-10);
          expect(ours.quaternion.angleTo(link.getWorldQuaternion(new Quaternion()))).toBeLessThan(1e-7);
        }
    }
  });
  it("solves nearby reachable pad contacts while reporting unreachable ones honestly", () => {
    for (const side of ["left", "right"] as const)
      for (const finger of [1, 2, 3, 4, 5] as FingerIndex[]) {
        const joints = fingerJoints(side, finger);
        const initial = joints.map((j) => (j.lower + j.upper) / 2);
        const expected = initial.map((a, i) => a + [0.08, -0.07, 0.12, -0.09][i]);
        const padOffset = new Vector3(-0.004, 0, -0.006);
        const position = forwardFinger(side, finger, expected, undefined, padOffset).position;
        const result = fitFinger({side, finger, position, initial, padOffset});
        expect(result.reached, `${side} ${finger}: ${result.error}`).toBe(true);
        expect(result.error).toBeLessThanOrEqual(0.00004);
        const impossible = fitFinger({side, finger, initial, position:new Vector3(10,10,10)});
        expect(impossible.reached).toBe(false);
        impossible.angles.forEach((a, i) => {
          expect(a).toBeGreaterThanOrEqual(joints[i].lower);
          expect(a).toBeLessThanOrEqual(joints[i].upper);
        });
      }
  });
});
