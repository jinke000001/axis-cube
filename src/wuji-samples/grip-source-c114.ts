import { Vector3 } from 'three';
import { NORMALS, type Move } from '../core/cube';
import { clonePose, fingerLibrary } from '../scene/finger-data';
import type { FingerContact } from '../scene/finger-contact';
import type { FingerProgram } from '../scene/finger-program';
import { type HandPose, type Side } from '../scene/motion';
import { canonicalRole, transportGrip } from './grip-poses-c114';
import { assembleC114 } from './grip-native-c114';
import { wideGripC114 } from './grip-wide-c114';
import { yawReleaseC114 } from './grip-yaw-release-c114';

/** Extract original native phases, keeping internal local double-stroke and
 * whole-yaw handovers. Only formula-level leading/trailing transfers are rebuilt. */
export function sourceNativeC114(program: FingerProgram, index: number) {
  const own = program.segments.filter(s => s.index === index);
  const first = own.findIndex(s => !['TRANSFER', 'HOLD'].includes(s.stage));
  let last = own.length - 1;
  while (last >= 0 && ['TRANSFER', 'HOLD'].includes(own[last].stage)) last--;
  if (first < 0 || last < first) throw Error('C114 original native range missing');
  return assembleC114(own.slice(first, last + 1).map(s => ({ ...s, index: 0 })), [program.steps[index].move]);
}
function supportRole(side: Side, p: HandPose) {
  const role = canonicalRole(side, p);
  if (role) return role;
  // The accepted b-prime support differs only in free digits. Its thumb uses
  // the exact support transform; the new G1 shape gets a separate joined audit.
  if ([1,2,3,4].every(i => Math.abs(p.joints![`${side}_finger1_joint${i}`] - fingerLibrary.hands[side].support.joints[`${side}_finger1_joint${i}`]) < 1e-7)) return 'support';
  return undefined;
}
export function adaptSourceNativeC114(old: FingerProgram, move: Move): FingerProgram {
  const parts = old.segments.map(s => ({ ...s, phase: 'G1适配 · ' + s.phase, sample: (p: number) => {
    const f = s.sample(p), poses = { left: clonePose(f.left), right: clonePose(f.right) }, contacts: FingerContact[] = [];
    for (const side of ['left', 'right'] as Side[]) {
      const cs = f.contacts.filter(c => c.side === side), role = supportRole(side, f[side]);
      const mapped = role ? transportGrip(side, f[side], role) : wideGripC114(side,f[side]);
      if (mapped) {
        poses[side] = mapped.pose;
        if (cs.length) {
          const drive = cs.some(c => c.role === 'drive'), axis = new Vector3(...NORMALS[move.face]);
          contacts.push(...mapped.contacts.map(c => ({ ...c, role: drive ? 'drive' as const : 'support' as const,
            point: drive ? c.point.clone().applyAxisAngle(axis, -f.angle) : c.point,
            normal: drive ? c.normal.clone().applyAxisAngle(axis, -f.angle) : c.normal,
          })));
        }
      } else {
        if (cs.length >= 3) throw Error('C114 custom loaded grip still requires calibration: ' + move.notation + '/' + side);
        // Preserve the already validated functional drive, thumb, release,
        // prepared second finger and bent free digits for other native families.
        contacts.push(...cs);
      }
    }
    const mappedFrame = { ...f, ...poses, contacts };
    return move.notation === "y'" ? yawReleaseC114(mappedFrame, s.stage, p) : mappedFrame;
  } }));
  return assembleC114(parts, [move]);
}
