import type { PoseData } from "./finger-data";
import type { Side } from "./motion";
import type { RecordedContact, RecordedFingerPrimitive, RecordedFingerSegment } from "./recorded-finger-program";
import raw from "./competitive-library.json";

/** JSON's only finite-number exception: preserve the sign bit of negative zero. */
export type PackedNumber = number | "-0";
export type PackedFrame = [number, number, number, PackedNumber];
export interface PackedCompetitiveLibrary {
  schemaVersion: 1;
  /** position xyz, quaternion xyzw, then finger1/joint1 through finger5/joint4. */
  poses: Record<Side, PackedNumber[][]>;
  /** side (0 left/1 right), finger, role (0 support/1 drive), point, normal, padOffset. */
  contacts: PackedNumber[][];
  contactSets: number[][];
  primitives: (Omit<RecordedFingerPrimitive, "segments"> & {
    segments: (Omit<RecordedFingerSegment, "frames" | "weight"> & { frames: PackedFrame[]; weight?: PackedNumber })[];
  })[];
  byNotation: Record<string, number[]>;
  sources: { path: string; sha256: string }[];
}
const immutable = <T extends object>(value: T): T => { Object.freeze(value); return value; };
const empty: readonly RecordedFingerPrimitive[] = Object.freeze([]);
const fail = (where: string): never => { throw new Error(`压缩指法数据损坏：${where}`); };
function number(value: PackedNumber): number {
  if (value === "-0") return -0;
  return typeof value === "number" && Number.isFinite(value) ? value : fail("非有限数值");
}
function index(value: number, length: number, where: string) {
  return Number.isInteger(value) && value >= 0 && value < length ? value : fail(where);
}

/** A fresh lazy registry is also used by the packer to verify the actual decoder. */
export function createCompetitiveLibrary(data: PackedCompetitiveLibrary) {
  if (data.schemaVersion !== 1) fail("不支持的数据版本");
  const poseCache: Record<Side, (PoseData | undefined)[]> = { left: [], right: [] };
  const contactCache: (RecordedContact | undefined)[] = [], setCache: (RecordedContact[] | undefined)[] = [];
  const primitiveCache = new Map<number, RecordedFingerPrimitive>(), results = new Map<string, readonly RecordedFingerPrimitive[]>();
  function pose(side: Side, id: number): PoseData {
    index(id, data.poses[side].length, "姿态引用越界");
    if (poseCache[side][id]) return poseCache[side][id]!;
    const values = data.poses[side][id]; if (values.length !== 27) fail("姿态必须含 20 个关节");
    return poseCache[side][id] = immutable({ position: immutable(values.slice(0, 3).map(number)), quaternion: immutable(values.slice(3, 7).map(number)),
      joints: immutable(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${side}_finger${Math.floor(i / 4) + 1}_joint${i % 4 + 1}`, number(values[i + 7])]))) });
  }
  function contact(id: number): RecordedContact {
    index(id, data.contacts.length, "接触引用越界");
    if (contactCache[id]) return contactCache[id]!;
    const values = data.contacts[id];
    if (values.length !== 12 || ![0, 1].includes(values[0] as number) || ![1, 2, 3, 4, 5].includes(values[1] as number) || ![0, 1].includes(values[2] as number)) fail("接触编码无效");
    return contactCache[id] = immutable<RecordedContact>({ side: values[0] === 0 ? "left" : "right", finger: values[1] as RecordedContact["finger"], role: values[2] === 0 ? "support" : "drive",
      point: immutable(values.slice(3, 6).map(number)), normal: immutable(values.slice(6, 9).map(number)), padOffset: immutable(values.slice(9, 12).map(number)) });
  }
  function contacts(id: number): RecordedContact[] {
    index(id, data.contactSets.length, "接触组引用越界");
    return setCache[id] ??= immutable(data.contactSets[id].map(contact));
  }
  function primitive(id: number): RecordedFingerPrimitive {
    index(id, data.primitives.length, "指法引用越界");
    const cached = primitiveCache.get(id); if (cached) return cached;
    const source = data.primitives[id];
    const result: RecordedFingerPrimitive = immutable({ ...source, segments: immutable(source.segments.map(({ frames, weight, ...metadata }) => immutable({ ...metadata,
      ...(weight === undefined ? {} : { weight: number(weight) }), frames: immutable(frames.map(frame => {
        if (frame.length !== 4) fail("帧编码无效");
        return immutable({ left: pose("left", frame[0]), right: pose("right", frame[1]), contacts: contacts(frame[2]), cubeAngle: number(frame[3]) });
      })),
    }))) });
    primitiveCache.set(id, result); return result;
  }
  return (notation: string): readonly RecordedFingerPrimitive[] => {
    if (!Object.hasOwn(data.byNotation, notation)) return empty;
    const cached = results.get(notation); if (cached) return cached;
    const found = immutable(data.byNotation[notation].map(primitive));
    if (found.some(item => item.notation !== notation)) fail("记号索引不匹配");
    results.set(notation, found); return found;
  };
}

function exactNumber(value: number): PackedNumber {
  if (!Number.isFinite(value)) throw new Error("Non-finite number in recorded source");
  return Object.is(value, -0) ? "-0" : value;
}
/** Compare every numeric value with Object.is; report only the first differing path. */
export function assertExact(actual: unknown, expected: unknown, path = "root"): void {
  if (Object.is(actual, expected)) return;
  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null || Array.isArray(actual) !== Array.isArray(expected))
    throw new Error(`Lossless comparison failed at ${path}: ${String(actual)} != ${String(expected)}`);
  const a = actual as Record<string, unknown>, b = expected as Record<string, unknown>, keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length || keys.some(key => !Object.hasOwn(a, key))) throw new Error(`Lossless comparison keys differ at ${path}`);
  for (const key of keys) assertExact(a[key], b[key], `${path}.${key}`);
}
export function packCompetitivePrimitives(primitives: readonly RecordedFingerPrimitive[], sources: PackedCompetitiveLibrary["sources"] = []): PackedCompetitiveLibrary {
  const data: PackedCompetitiveLibrary = { schemaVersion: 1, poses: { left: [], right: [] }, contacts: [], contactSets: [], primitives: [], byNotation: Object.create(null), sources };
  const poses = { left: new Map<string, number>(), right: new Map<string, number>() }, contacts = new Map<string, number>(), sets = new Map<string, number>();
  const intern = <T>(value: T, pool: T[], ids: Map<string, number>) => {
    const key = JSON.stringify(value), found = ids.get(key); if (found !== undefined) return found;
    const id = pool.length; pool.push(value); ids.set(key, id); return id;
  };
  function packedPose(side: Side, pose: PoseData) {
    if (pose.position.length !== 3 || pose.quaternion.length !== 4 || Object.keys(pose.joints).length !== 20) throw new Error(`Invalid ${side} pose dimensions`);
    const names = Array.from({ length: 20 }, (_, i) => `${side}_finger${Math.floor(i / 4) + 1}_joint${i % 4 + 1}`);
    if (names.some(name => !Object.hasOwn(pose.joints, name))) throw new Error(`Missing original ${side} joint`);
    return intern([...pose.position, ...pose.quaternion, ...names.map(name => pose.joints[name])].map(exactNumber), data.poses[side], poses[side]);
  }
  function packedContact(contact: RecordedContact) {
    if (!["left", "right"].includes(contact.side) || !["support", "drive"].includes(contact.role) || ![1, 2, 3, 4, 5].includes(contact.finger) || [contact.point, contact.normal, contact.padOffset].some(v => v.length !== 3)) throw new Error("Invalid recorded contact");
    return intern([contact.side === "left" ? 0 : 1, contact.finger, contact.role === "support" ? 0 : 1, ...contact.point, ...contact.normal, ...contact.padOffset].map(exactNumber), data.contacts, contacts);
  }
  for (const primitive of primitives) {
    if (!primitive.segments.length) throw new Error(`Empty primitive ${primitive.notation}`);
    const id = data.primitives.length;
    data.primitives.push({ ...primitive, segments: primitive.segments.map(({ frames, weight, ...metadata }) => ({ ...metadata,
      ...(weight === undefined ? {} : { weight: exactNumber(weight) }), frames: frames.map(frame => [packedPose("left", frame.left), packedPose("right", frame.right), intern(frame.contacts.map(packedContact), data.contactSets, sets), exactNumber(frame.cubeAngle)]),
    })) });
    (data.byNotation[primitive.notation] ??= []).push(id);
  }
  return data;
}


const registry = createCompetitiveLibrary(raw as unknown as PackedCompetitiveLibrary);
export function getCompetitivePrimitives(notation: string): readonly RecordedFingerPrimitive[] {
  return registry(notation);
}
