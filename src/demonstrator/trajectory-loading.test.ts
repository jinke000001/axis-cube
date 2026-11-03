import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {FORMULAS} from './catalog';
import {compileTeachingMotion,sampleTeachingMotion,type TeachingMotion} from './motion';
import {exportTeachingTrajectory,prepareTeachingTrajectory,teachingTrajectorySignature,fitTeachingFrame,solveTeachingPose} from './rig';
import {fingerLengths} from './hand-model';
import {Vector3} from 'three';

let fixtureProgram:TeachingMotion;
let fixtureData:ReturnType<typeof exportTeachingTrajectory>;
beforeAll(()=> {
  fixtureProgram=compileTeachingMotion(FORMULAS.find(f=>f.id==='gan-f2l-40')!);
  fixtureData=exportTeachingTrajectory(fixtureProgram);
},30000);
let fixtureIndex=0;
// Register the same unmodified choreography under a fresh fixture ID. Merely
// cloning the program would leave frame lookup pointing at the authored cache.
const freshFixture=()=> {
  const original=FORMULAS.find(f=>f.id==='gan-f2l-40')!;
  const program=compileTeachingMotion({...original,id:`loading-probe-${++fixtureIndex}`});
  const data=structuredClone(fixtureData);
  data.signature=teachingTrajectorySignature(program);
  return {data,program};
};
afterEach(()=>vi.unstubAllGlobals());
describe('published trajectory decoding',()=> {
  it('retries a malformed direction response and reconstructs rigid source-step joints',async()=> {
    const {data,program}=freshFixture();
    const bad=structuredClone(data);bad.directions[0][0]=2;
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(bad))).mockResolvedValueOnce(new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch',fetcher);
    await expect(prepareTeachingTrajectory(program)).rejects.toThrow('方向数据无效');
    await prepareTeachingTrajectory(program);expect(fetcher).toHaveBeenCalledTimes(2);
    const frame=fitTeachingFrame(sampleTeachingMotion(program,program.duration*.4));
    const solved=solveTeachingPose(frame.pose,frame);
    expect(solved).toHaveLength(10);
    for(const finger of solved)for(let link=0;link<3;link++) {
      expect(new Vector3().fromArray(finger.joints[link]).distanceTo(new Vector3().fromArray(finger.joints[link+1]))).toBeCloseTo(fingerLengths(finger.finger)[link],9);
    }
    const first=JSON.stringify(solved);sampleTeachingMotion(program,program.duration);
    expect(JSON.stringify(solveTeachingPose(frame.pose,frame))).toBe(first);
  });
  it('does not expose a finger-only partial record when arm validation fails, and retries cleanly',async()=> {
    const {data,program}=freshFixture();
    const bad=structuredClone(data);bad.arms.times[1]=0;
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(bad))).mockResolvedValueOnce(new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch',fetcher);vi.stubGlobal('window',{});
    await expect(prepareTeachingTrajectory(program)).rejects.toThrow('手臂轨迹');
    const frame=fitTeachingFrame(sampleTeachingMotion(program,0));
    expect(()=>solveTeachingPose(frame.pose,frame)).toThrow('尚未准备完成');
    await prepareTeachingTrajectory(program);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(solveTeachingPose(frame.pose,frame)).toHaveLength(10);
  });

  it('rejects a trajectory from a different playback revision',async()=> {
    const {data,program}=freshFixture();data.version=-1;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    await expect(prepareTeachingTrajectory(program)).rejects.toThrow('版本不匹配');
  });

});
