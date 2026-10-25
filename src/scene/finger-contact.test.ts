import { expect, it } from "vitest";
import { Vector3 } from "three";
import { parseMove } from "../core/cube";
import { CENTER } from "./motion";
import { stableGrip, gripContact } from "./finger-grips";
import { contactHasCorrectBody, contactTarget, hasMeasuredSupport, measureContact, type FingerContact } from "./finger-contact";

const holding = ([1, 3, 4, 5] as const).map((finger): FingerContact => {
  const contact = gripContact("left", finger);
  return { ...contact, point: contact.point.sub(CENTER), role: "support" };
});

it("recognizes actual calibrated supporting pads, not a closed-hand scalar", () => {
  const poses = {left:stableGrip("left"),right:stableGrip("right")};
  expect(hasMeasuredSupport(poses, holding, parseMove("U"))).toBe(true);
  poses.left.position.x -= 0.02;
  expect(poses.left.closed).toBe(1);
  expect(hasMeasuredSupport(poses, holding, parseMove("U"))).toBe(false);
  expect(measureContact(poses.left, holding[0],parseMove("U")).error).toBeGreaterThan(0.019);
});

it("excludes a contact that locks the moving layer and transforms real drive targets", () => {
  const tip = gripContact("right",2);
  const contact: FingerContact = {...tip,point:tip.point.sub(CENTER),role:"support"};
  const move = parseMove("U");
  expect(contactHasCorrectBody(contact,move)).toBe(false);
  contact.role="drive";
  expect(contactHasCorrectBody(contact,move)).toBe(true);
  const end = contactTarget(contact,move,-Math.PI/2);
  expect(end.point.distanceTo(contact.point.clone().applyAxisAngle(new Vector3(0,1,0),-Math.PI/2).add(CENTER))).toBeLessThan(1e-10);
  expect(contactHasCorrectBody(contact,parseMove("M"))).toBe(false);
});
