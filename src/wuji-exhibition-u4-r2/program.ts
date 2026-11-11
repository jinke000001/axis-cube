import{createBidirectionalSlicePhrase}from'../wuji-samples/bidirectional-slice-phrase';
import{createRingFrontPhrase}from'../wuji-samples/ring-front-phrase';
import{createMixedRingPhrase}from'../wuji-samples/mixed-ring-phrase';
import{createYawUpperPhrase}from'../wuji-samples/yaw-upper-phrase';
import{createLowerWideProgram}from'../wuji-samples/lower-wide-program';
import{createWideBackSupportV3Phrase}from'../wuji-samples/wide-back-support-v3-phrase';
import{createWideFrontTipPhrase}from'../wuji-samples/wide-front-tip-phrase';
import{createDoubleSlicePhrase}from'../wuji-samples/double-slice-phrase';import{createUpperWidePhrase}from'../wuji-samples/upper-wide-phrase';import{createRotationHalfPhrase}from'../wuji-samples/rotation-half-phrase';import{createForwardThumbV3Phrase}from'../wuji-samples/forward-thumb-v3-phrase';
import{createBottomPhrase}from'../wuji-samples/bottom-phrase';import{createBottomZPhrase}from'../wuji-samples/bottom-z-phrase';import{createUpperRingPhrase}from'../wuji-samples/upper-ring-phrase';import{createLeftFrontPhrase}from'../wuji-samples/left-front-phrase';
import{createContinuousPhrase}from'../wuji-samples/continuous-phrase';import{createRUPhrase}from'../wuji-samples/ru-phrase';import{createRotationPhrase}from'../wuji-samples/rotation-phrase';import{createFrontPhrase}from'../wuji-samples/front-phrase';
import{createWidePhrase}from'../wuji-samples/wide-phrase';import{createHalfPhrase}from'../wuji-samples/half-phrase';import{createComposedPhrase}from'../wuji-samples/composed-phrase';
import{createSlicePhrase}from'../wuji-samples/slice-phrase';import{createBackPhrase}from'../wuji-samples/back-phrase';import{createExtendedWidePhrase}from'../wuji-samples/extended-wide-phrase';
import{approvedEntry}from'./availability';import type{FingerProgram}from'../scene/finger-program';
export function createApprovedProgram(id:string):FingerProgram{
 const entry=approvedEntry(id);if(!entry)throw new Error('本条演示仍在校准');
 const compilers:Record<string,(id:string)=>FingerProgram>={createBidirectionalSlicePhrase,createRingFrontPhrase,createMixedRingPhrase,createYawUpperPhrase,createLowerWideProgram,createWideBackSupportV3Phrase,createWideFrontTipPhrase,createDoubleSlicePhrase,createUpperWidePhrase,createRotationHalfPhrase,createForwardThumbV3Phrase,createBottomPhrase,createBottomZPhrase,createUpperRingPhrase,createLeftFrontPhrase,createContinuousPhrase,createRUPhrase,createRotationPhrase,createFrontPhrase,createWidePhrase,createHalfPhrase,createComposedPhrase,createSlicePhrase,createBackPhrase,createExtendedWidePhrase};
 const compile=compilers[entry.export];if(!compile)throw new Error('未找到本条已验动作');return compile(id);
}
export const sourceBoundary=(program:FingerProgram,index:number)=>program.steps[Math.max(0,Math.min(program.steps.length,Math.trunc(index)))]?.start??program.duration;
