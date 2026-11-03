import specification from '../../art/teaching-hand/rig.json';
import type { Vec3 } from '../core/cube';
import type { TeachingFinger, TeachingHand } from './types';

/** Shared teaching-hand specification. Modeling, posing and collision read this file. */
export const HAND_SPEC = specification;
export const HAND_MODEL_ID = specification.handModelId;
export const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'little'] as const satisfies readonly TeachingFinger[];

type FingerSpec = (typeof specification.fingers)[TeachingFinger];
type GeometrySpec = typeof specification.geometry & {
  palmCenterOffset?: readonly number[];
  armShellRadius?: number;
  armRadialSegments?: number;
  fingerRadialSegments?: number;
};
type RigLike = {
  fingers?: Record<string, Pick<FingerSpec, 'lengths' | 'padRadius' | 'linkRadii' | 'jointRadii' | 'baseRight' | 'restLocal'>>;
  geometry: GeometrySpec;
  baseOffsetsRight?: Record<string, readonly number[]>;
  wristAttachment?: readonly number[];
  armLengths?: readonly number[];
};

export const FINGER_LENGTHS = specification.fingers.middle.lengths;
export const FINGER_BASES = Object.fromEntries(FINGER_ORDER.map(finger => [finger, specification.fingers[finger].baseRight])) as Record<TeachingFinger, Vec3>;
export const REST_TIP_HEIGHTS = Object.fromEntries(FINGER_ORDER.map(finger => [finger, specification.fingers[finger].restLocal[1]])) as Record<TeachingFinger, number>;

export function fingerSpec(finger: TeachingFinger): FingerSpec {
  return specification.fingers[finger];
}
export function fingerLengths(finger: TeachingFinger): readonly [number, number, number] {
  const lengths = fingerSpec(finger).lengths;
  return [lengths[0], lengths[1], lengths[2]];
}
export function fingerPadRadius(finger: TeachingFinger): number {
  return fingerSpec(finger).padRadius;
}
export function fingerRestLocal(finger: TeachingFinger): Vec3 {
  const local = fingerSpec(finger).restLocal;
  return [local[0], local[1], local[2]];
}
/** Right-hand palm space. Callers mirror X for the left hand. */
export function mirroredRest(hand: TeachingHand, finger: TeachingFinger): Vec3 {
  const local = fingerRestLocal(finger);
  return [(hand === 'right' ? 1 : -1) * local[0], local[1], local[2]];
}
export function palmCenterLocal(hand: TeachingHand, geometry: GeometrySpec = specification.geometry): Vec3 {
  const offset = geometry.palmCenterOffset ?? [0, 0, 0];
  return [(hand === 'right' ? 1 : -1) * offset[0], offset[1], offset[2]];
}

function sphereInner(radius: number, segments: number, rings: number) {
  return radius * Math.cos(Math.PI / segments) * Math.cos(Math.PI / (2 * rings)) * .99;
}

/** Outer radius covers the visible shell. Inner radius is inside the tessellated surface. */
export function linkShell(finger: TeachingFinger, link: number, spec: RigLike = specification) {
  const geometry = spec.geometry;
  const authored = spec.fingers?.[finger];
  if (authored) {
    const outer = authored.linkRadii[link];
    const segments = geometry.fingerRadialSegments ?? 24;
    return { outer, inner: outer * Math.cos(Math.PI / segments), inset: geometry.linkEndInset };
  }
  const halfWidth = geometry.linkWidths[link] / 2;
  const halfDepth = geometry.linkDepths[link] / 2;
  const outer = Math.hypot(halfWidth, Math.max(halfDepth, link < 2 ? geometry.inlayDepthOffset + geometry.inlayDepth / 2 : 0));
  return { outer, inner: Math.max(0, Math.min(halfWidth, halfDepth) - geometry.linkBevel), inset: geometry.linkEndInset };
}
export function jointShellRadius(finger: TeachingFinger, index: number, spec: RigLike = specification) {
  const geometry = spec.geometry;
  const authored = spec.fingers?.[finger];
  const radius = index === 3 ? (authored?.padRadius ?? geometry.padRadius) : (authored?.jointRadii[index] ?? geometry.jointRadii[index]);
  return { outer: radius, inner: sphereInner(radius, geometry.uvSphereSegments, geometry.uvSphereRings) };
}
export function armShell(spec: RigLike = specification) {
  const geometry = spec.geometry;
  if (geometry.armShellRadius) {
    const outer = geometry.armShellRadius;
    const segments = geometry.armRadialSegments ?? 24;
    return { outer, inner: outer * Math.cos(Math.PI / segments), inset: geometry.armEndInset };
  }
  const halfWidth = geometry.armHousingWidth / 2, halfDepth = geometry.armHousingDepth / 2;
  return {
    outer: Math.hypot(halfWidth, halfDepth),
    inner: Math.max(0, Math.min(halfWidth, halfDepth) - geometry.armHousingBevel),
    inset: geometry.armEndInset,
  };
}

export const GEOMETRY_DIGEST = specification.geometryDigest;

/** Signed flexion around a hinge: 0 is straight, positive curls along the hinge's right-hand rule. */
export function signedJointAngle(previous: readonly number[], next: readonly number[], hinge: readonly number[]) {
  const cross = [
    previous[1] * next[2] - previous[2] * next[1],
    previous[2] * next[0] - previous[0] * next[2],
    previous[0] * next[1] - previous[1] * next[0],
  ];
  const dot = previous[0] * next[0] + previous[1] * next[1] + previous[2] * next[2];
  const along = cross[0] * hinge[0] + cross[1] * hinge[1] + cross[2] * hinge[2];
  return Math.atan2(along, dot);
}
