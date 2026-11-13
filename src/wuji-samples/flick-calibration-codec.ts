import type { PoseData } from '../scene/finger-data';
import type { Side } from '../scene/motion';

export interface CalibrationContactData {
  side: Side;
  finger: 1 | 2 | 3 | 4 | 5;
  role: 'support' | 'drive';
  point: number[];
  normal: number[];
  padOffset: number[];
}

export interface CalibrationFrameData {
  progress: number;
  angle: number;
  left: PoseData;
  right: PoseData;
  active: CalibrationContactData;
}

export interface UnpackedFlickCalibration<TSummary = Record<string, unknown>> {
  side?: Side;
  summary: TSummary;
  before: PoseData;
  after: PoseData;
  supports: CalibrationContactData[];
  frames: CalibrationFrameData[];
}

type PackedPose = [number[], number[], number[]];
type PackedContact = [Side, 1 | 2 | 3 | 4 | 5, 'support' | 'drive', number[], number[], number[]];
type PackedFrame = [number, number, PackedPose | null, PackedPose | null, PackedContact];

export interface CompactFlickCalibration<TSummary = Record<string, unknown>> {
  side?: Side;
  summary: TSummary;
  activeSide: Side;
  before: PackedPose;
  after: PackedPose;
  supports: PackedContact[];
  constLeft: PackedPose | null;
  constRight: PackedPose | null;
  frames: PackedFrame[];
}

const buildJointNames = (side: Side): readonly string[] => {
  const names: string[] = [];
  for (let f = 1; f <= 5; f++) {
    for (let j = 1; j <= 4; j++) {
      names.push(`${side}_finger${f}_joint${j}`);
    }
  }
  return names;
};

const LEFT_JOINTS = buildJointNames('left');
const RIGHT_JOINTS = buildJointNames('right');

function unpackPose(packed: PackedPose, side: Side): PoseData {
  const keys = side === 'left' ? LEFT_JOINTS : RIGHT_JOINTS;
  const joints: Record<string, number> = {};
  for (let i = 0; i < 20; i++) {
    joints[keys[i]] = packed[2][i];
  }
  return {
    position: packed[0],
    quaternion: packed[1],
    joints,
  };
}

function unpackContact(c: PackedContact): CalibrationContactData {
  return {
    side: c[0],
    finger: c[1],
    role: c[2],
    point: c[3],
    normal: c[4],
    padOffset: c[5],
  };
}

export function unpackFlickCalibration<TSummary = Record<string, unknown>>(
  raw: CompactFlickCalibration<TSummary> | Record<string, unknown>,
): UnpackedFlickCalibration<TSummary> {
  const compact = raw as unknown as CompactFlickCalibration<TSummary>;
  const activeSide = compact.activeSide;
  const constLeft = compact.constLeft ? unpackPose(compact.constLeft, 'left') : null;
  const constRight = compact.constRight ? unpackPose(compact.constRight, 'right') : null;
  return {
    side: compact.side,
    summary: compact.summary,
    before: unpackPose(compact.before, activeSide),
    after: unpackPose(compact.after, activeSide),
    supports: compact.supports.map(unpackContact),
    frames: compact.frames.map(f => ({
      progress: f[0],
      angle: f[1],
      left: constLeft ?? unpackPose(f[2]!, 'left'),
      right: constRight ?? unpackPose(f[3]!, 'right'),
      active: unpackContact(f[4]),
    })),
  };
}
