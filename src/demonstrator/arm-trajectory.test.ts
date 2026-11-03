import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Vec3 } from '../core/cube';
import { FORMULAS } from './catalog';
import { compileTeachingMotion, sampleTeachingMotion } from './motion';
import { fitTeachingFrame } from './rig';
import { auditArmConnections, auditArmHandVolumes, auditArmVolumes } from './geometry-audit';
import { frameCubeShapes } from './geometry-shapes';
import { ARM_GEOMETRY_SIGNATURE, ArmTrajectoryError, buildArmTrajectory, sampleArmTrajectory, validateArmTrajectory, type ArmFingerObstacle, type ArmTrajectorySample } from './arm-trajectory';

function sampleProgram(id: string) {
  const program = compileTeachingMotion(FORMULAS.find(record => record.id === id)!);
  const sample = (time: number): ArmTrajectorySample => {
    const frame = fitTeachingFrame(sampleTeachingMotion(program, time));
    return { pose: frame.pose, cubeShapes: frameCubeShapes(frame) };
  };
  return { program, sample };
}

describe('authored continuous elbow trajectories', () => {
  it('avoids the PLL12 rotating-palm wrist-entry regression without moving its wrist or scaling either arm', () => {
    const { sample } = sampleProgram('gan-pll-12'), fixed = sample(1.77);
    const data = buildArmTrajectory({ times: [0, .04], sample: () => fixed });
    const decoded: unknown = JSON.parse(JSON.stringify(data));
    validateArmTrajectory(decoded, .04);
    const arms = sampleArmTrajectory(decoded, .017, fixed.pose);
    const auditPose = {
      left: { ...fixed.pose.left, rotation: [...fixed.pose.left.rotation] as [number, number, number, number] },
      right: { ...fixed.pose.right, rotation: [...fixed.pose.right.rotation] as [number, number, number, number] },
    };
    expect(auditArmConnections(auditPose, arms).confirmed).toEqual([]);
    expect(auditArmHandVolumes(auditPose, arms, []).confirmed).toEqual([]);
    expect(decoded.fingerObstacles).toBe(false);
    const exact = JSON.stringify(arms);
    sampleArmTrajectory(decoded, .04, fixed.pose);
    sampleArmTrajectory(decoded, 0, fixed.pose);
    expect(JSON.stringify(sampleArmTrajectory(decoded, .017, fixed.pose))).toBe(exact);
  });

  it('rejects missing paths and corrupt/foreign trajectory data instead of falling back to a world pole', () => {
    const { sample } = sampleProgram('gan-f2l-40'), fixed = sample(0);
    expect(() => buildArmTrajectory({ times: [0, .02], sample: () => ({ ...fixed,
      cubeShapes: [{ center: [0, 0, 0], half: [2, 2, 2], rotation: [0, 0, 0, 1], rounding: 0 }] }) })).toThrow(ArmTrajectoryError);
    const data = buildArmTrajectory({ times: [0, .02], sample: () => fixed });
    expect(() => validateArmTrajectory({ ...data, geometrySignature: 'old' })).toThrow();
    expect(() => validateArmTrajectory({ ...data, angles: { ...data.angles, left: [NaN, 0] } })).toThrow();
    expect(() => validateArmTrajectory({ ...data, times: [0, 0] })).toThrow();
    expect(() => validateArmTrajectory({ ...data, slopes: { ...data.slopes, left: data.slopes.left.map(() => 123) } })).toThrow();
    expect(data.geometrySignature).toBe(ARM_GEOMETRY_SIGNATURE);
  });

  it('checks supplied finger volumes and refuses a partial set masquerading as both hands', () => {
    const { sample } = sampleProgram('gan-f2l-40'), fixed = sample(0);
    const fingers: ArmFingerObstacle[] = (['left', 'right'] as const).flatMap((hand, h) =>
      (['thumb', 'index', 'middle', 'ring', 'little'] as const).map((finger, i) => ({ hand, finger,
        joints: [0, .045, .085, .104].map(y => [2 + h, 1 + i * .2 + y, 2] as Vec3) as [Vec3, Vec3, Vec3, Vec3] })));
    const data = buildArmTrajectory({ times: [0, .02], sample: () => ({ ...fixed, fingers }) });
    expect(data.fingerObstacles).toBe(true);
    expect(() => buildArmTrajectory({ times: [0, .02], sample: () => ({ ...fixed, fingers: fingers.slice(0, 9) }) })).toThrow('双手十指');
    const wrist = sampleArmTrajectory(data, 0, fixed.pose)[0].wrist;
    const blocking = fingers.map((finger, i) => i ? finger : { ...finger,
      joints: [0, .045, .085, .104].map(y => [wrist[0], wrist[1] + y, wrist[2]] as Vec3) as [Vec3, Vec3, Vec3, Vec3] });
    expect(() => buildArmTrajectory({ times: [0, .02], sample: () => ({ ...fixed, fingers: blocking }) })).toThrow(ArmTrajectoryError);
  });

  for (const id of ['gan-f2l-40', 'gan-pll-12']) it(id + ' round-trips the full source palm motion with rigid, deterministic, collision-checked arms', () => {
    const { program, sample } = sampleProgram(id);
    const times = [...new Set([0, program.duration, ...program.segments.map(segment => segment.start)])].sort((a, b) => a - b);
    const data = buildArmTrajectory({ times, sample });
    const loaded: unknown = JSON.parse(JSON.stringify(data));
    validateArmTrajectory(loaded, program.duration);
    let previous: ReturnType<typeof sampleArmTrajectory> | undefined, previousTime = 0, maxSpeed = 0;
    for (let i = 0; i <= Math.ceil(program.duration / .01); i++) {
      const time = Math.min(program.duration, i * .01), frame = fitTeachingFrame(sampleTeachingMotion(program, time));
      const arms = sampleArmTrajectory(loaded, time, frame.pose);
      expect(auditArmConnections(frame.pose, arms).confirmed, id + ' attachment t=' + time).toEqual([]);
      expect(auditArmVolumes(frame, arms).confirmed, id + ' cube t=' + time).toEqual([]);
      expect(auditArmHandVolumes(frame.pose, arms, []).confirmed, id + ' hands/arms t=' + time).toEqual([]);
      if (previous && time > previousTime + 1e-8) for (let h = 0; h < 2; h++)
        maxSpeed = Math.max(maxSpeed, new Vector3().fromArray(arms[h].elbow).distanceTo(new Vector3().fromArray(previous[h].elbow)) / (time - previousTime));
      previous = arms; previousTime = time;
    }
    expect(maxSpeed).toBeLessThan(2);
    for (const time of loaded.times) {
      const leftTime = Math.max(0, time - 1e-6), rightTime = Math.min(program.duration, time + 1e-6);
      const left = sampleArmTrajectory(loaded, leftTime, sample(leftTime).pose), right = sampleArmTrajectory(loaded, rightTime, sample(rightTime).pose);
      for (let h = 0; h < 2; h++) expect(new Vector3().fromArray(left[h].elbow).distanceTo(new Vector3().fromArray(right[h].elbow))).toBeLessThan(.00002);
    }
    const probes = [0, program.duration * .37, program.duration * .73, program.duration];
    const expected = probes.map(t => sampleArmTrajectory(loaded, t, sample(t).pose));
    for (let i = probes.length - 1; i >= 0; i--) expect(sampleArmTrajectory(loaded, probes[i], sample(probes[i]).pose)).toEqual(expected[i]);
  }, 120000);
});
