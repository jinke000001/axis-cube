import { describe, expect, it } from "vitest";
import { assertExact, packCompetitivePrimitives, createCompetitiveLibrary, getCompetitivePrimitives, type PackedCompetitiveLibrary } from "./competitive-library";
import type { RecordedFingerPrimitive } from "./recorded-finger-program";

function fixture(): RecordedFingerPrimitive {
  const frame = structuredClone(getCompetitivePrimitives("F")[0].segments[0].frames[0]);
  frame.left.position[0] = -0;
  frame.left.joints.left_finger1_joint1 = 1 + Number.EPSILON;
  frame.contacts[0].padOffset[0] = Number.MIN_VALUE;
  frame.cubeAngle = -0;
  return { notation: "F", rotationContactsInEntryFrame: false,
    segments: [{ id: "codec-fixture", stage: "TURN", phase: "", active: "left", finger: 1, weight: -0, frames: [frame, frame] }] };
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

describe("lossless competitive primitive registry", () => {
  it("loads all accepted variants and unchanged frame counts from the registry", () => {
    expect(getCompetitivePrimitives("F")).toHaveLength(2);
    expect(getCompetitivePrimitives("F'")).toHaveLength(2);
    for (const notation of ["D", "D'", "D2", "D2'", "y", "y'"]) expect(getCompetitivePrimitives(notation)).toHaveLength(1);
    const all = ["F", "F'", "D", "D'", "D2", "D2'", "y", "y'"].flatMap(getCompetitivePrimitives);
    expect(all).toHaveLength(10);
    expect(all.flatMap(p => p.segments)).toHaveLength(152);
    expect(all.flatMap(p => p.segments.flatMap(s => s.frames))).toHaveLength(9880);
    for (const primitive of all) for (const segment of primitive.segments) expect(segment.frames).toHaveLength(65);
  }, 30000);

  it("retains the y adapter's entry-frame contacts, holder, stage and phase", () => {
    for (const [notation, active] of [["y", "left"], ["y'", "right"]]) {
      const primitive = getCompetitivePrimitives(notation)[0];
      expect(primitive.rotationContactsInEntryFrame).toBe(true);
      const turn = primitive.segments.filter(s => s.stage === "TURN");
      expect(turn).toHaveLength(1);
      expect(turn[0].active).toBe(active);
      expect(turn[0].phase).toBe("持握换面 · 对手预备接应");
    }
  });

  it("preserves negative zero, adjacent doubles, tiny values and optional metadata", () => {
    const original = freezeTree(fixture()), before = structuredClone(original);
    const packed = packCompetitivePrimitives([original]), serialized = JSON.stringify(packed);
    const unpacked = createCompetitiveLibrary(JSON.parse(serialized) as PackedCompetitiveLibrary)("F");
    assertExact(unpacked, [original]); assertExact(original, before);
    expect(Object.is(unpacked[0].segments[0].frames[0].cubeAngle, -0)).toBe(true);
    expect(Object.is(unpacked[0].segments[0].weight, -0)).toBe(true);
  });

  it("shares equal poses/contact groups without exposing mutable source arrays", () => {
    const original = freezeTree(fixture()), packed = freezeTree(packCompetitivePrimitives([original]));
    const get = createCompetitiveLibrary(packed), first = get("F"), frames = first[0].segments[0].frames;
    expect(get("F")).toBe(first);
    expect(frames[0].left).toBe(frames[1].left);
    expect(frames[0].contacts).toBe(frames[1].contacts);
    expect(frames[0].contacts[0]).toBe(frames[1].contacts[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(frames[0].left.joints)).toBe(true);
    expect(() => { frames[0].left.position[0] = 5; }).toThrow(TypeError);
    assertExact(first, [original]);
  });

  it("returns a stable empty list for unavailable and inherited-property names", () => {
    const empty = getCompetitivePrimitives("unavailable");
    for (const name of ["", "M", "constructor", "__proto__", "unavailable"]) expect(getCompetitivePrimitives(name)).toBe(empty);
    expect(empty).toEqual([]); expect(Object.isFrozen(empty)).toBe(true);
  });

  it("rejects corrupt references, malformed poses and missing original joints", () => {
    const badReference = packCompetitivePrimitives([fixture()]);
    badReference.primitives[0].segments[0].frames[0][0] = badReference.poses.left.length;
    expect(() => createCompetitiveLibrary(badReference)("F")).toThrow("姿态引用越界");
    const badPose = packCompetitivePrimitives([fixture()]); badPose.poses.left[0].pop();
    expect(() => createCompetitiveLibrary(badPose)("F")).toThrow("20 个关节");
    const badJoint = fixture(); delete badJoint.segments[0].frames[0].left.joints.left_finger1_joint1;
    expect(() => packCompetitivePrimitives([badJoint])).toThrow("pose dimensions");
  });
});
