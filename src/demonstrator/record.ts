import type { FormulaRecord } from './types';
import { sampleTeachingMotion, teachingBoundaryTime, type TeachingMotion } from './motion';
import { fitTeachingFrame, solveTeachingArms, solveTeachingPose } from './rig';

/** Portable, inspectable teaching data. A source-coloured half turn identifies
 * its driving digit for both quarter strokes; an unmarked half turn may relay. */
export function teachingActionRecord(formula:FormulaRecord,motion:TeachingMotion,samplesPerPhase=5) {
  if(motion.formulaId!==formula.id)throw new Error('Prepared trajectory does not match its source formula.');
  return {
    schema:1,formulaId:formula.id,caseId:formula.case.id,variant:formula.variant,
    chartNumber:formula.case.sourceNumber,stage:formula.case.stage,
    algorithm:formula.algorithm,holding:formula.case.orientation,initialState:formula.initialState,
    groups:formula.groups,sources:formula.sources,idleWaits:motion.idleWaits??[],externalReceptions:motion.externalReceptions??[],flickTransitions:motion.flickTransitions??[],cornerReceptions:motion.cornerReceptions??[],relayYields:motion.relayYields??[],supportClearances:motion.supportClearances??[],
    movementReferences:[
      {url:'https://www.youtube.com/watch?v=wLuVF9Dk3AQ',title:'J Perm finger tricks',basis:'Actual slow-frame review: U/U′ 0:10–0:15; R U R′ 3:03–3:08; U2 index→middle 4:41–4:42; M/M′ 5:26–5:43. Primitive reference, not an exact source-formula motion capture.'},
      {url:'https://www.youtube.com/watch?v=ofeidRXHOWc',title:'GAN Tymon PLL tutorial',basis:'Actual review at 6:34–6:43: left middle support with ring D′/D. Tutorial formula variants do not override the source chart.'},
    ],
    sourceSteps:motion.steps.map(step=> {
      const source=formula.steps[step.index];
      const drives=step.segments.map(i=>motion.segments[i]).filter(segment=>segment.phase==='drive');
      return {index:step.index,printedIndex:source.printedIndex,move:source.move,group:source.group,
        chartFinger:source.hint??null,initiatingFinger:step.driver,authoredGripNotes:step.gripNotes??[],
        initiatingHandBasis:source.hint?.hand?'原表明确左右手':'结合当前握姿的教学编排；原表未明确该手',
        contactAndJointBasis:'Original authored rigid teaching trajectories, informed by the cited primitive demonstrations; not recovered human joint motion capture.',
        relay:drives.map((segment,quarter)=>({quarter,hand:segment.hand,finger:segment.finger,
          basis:quarter===0&&source.hint?'原表指定发起手指':quarter>0&&source.hint
            ?'原表指定手指；同一手指释放后再次接触，完成第二次90°拨动':'教学编排',
          wristHands:segment.wristHands??[],contacts:segment.contacts})),
        start:step.start,end:step.end};
    }),
    phases:motion.segments,
    jointTrajectories:motion.segments.flatMap(segment=>Array.from({length:samplesPerPhase},(_,i)=> {
      const time=segment.start+Math.min(segment.duration-1e-7,segment.duration*i/(samplesPerPhase-1));
      const frame=fitTeachingFrame(sampleTeachingMotion(motion,time));
      return {time,sourceStep:frame.step,phase:frame.phase,angle:frame.angle,
        palms:{left:{position:frame.pose.left.palm,rotation:frame.pose.left.rotation},right:{position:frame.pose.right.palm,rotation:frame.pose.right.rotation}},
        fingers:solveTeachingPose(frame.pose,frame).map(finger=>({hand:finger.hand,finger:finger.finger,joints:finger.joints})),
        arms:solveTeachingArms(frame.pose,frame)};
    })),
    duration:motion.duration,
    sourceBoundaries:motion.states.map((state,completed)=> {
      const frame=fitTeachingFrame(sampleTeachingMotion(motion,teachingBoundaryTime(motion,completed)));
      return {completed,state,pose:frame.pose,fingers:solveTeachingPose(frame.pose,frame),arms:solveTeachingArms(frame.pose,frame)};
    }),
    verification:'This record alone is not an acceptance verdict. Bind it to the separately identified geometry and visual review candidate.',
  };
}
