export interface LoopRange { start:number; end:number; }
export interface ClockAdvance { time:number; playing:boolean; cycles:number; }
/** Advance logical time, independently of how many intermediate poses can be
 * drawn. Preserve all elapsed time and every completed loop's remainder. */
export function advancePlayback(time:number,elapsedSeconds:number,speed:number,duration:number,loop?:LoopRange,stopAt?:number|null):ClockAdvance {
 if(![time,elapsedSeconds,speed,duration].every(Number.isFinite)||elapsedSeconds<0||speed<=0||duration<=0)throw new RangeError('Invalid playback clock input');
 const delta=elapsedSeconds*speed;
 if(loop){
  if(!(loop.start>=0&&loop.end<=duration&&loop.end>loop.start))throw new RangeError('Invalid loop range');
  const length=loop.end-loop.start,relative=time>=loop.start&&time<loop.end?time-loop.start:0,total=relative+delta;
  let cycles=Math.floor(total/length),remainder=total-cycles*length;
  // Only remove floating-point residue at the exact temporal boundary.
  const tolerance=Number.EPSILON*Math.max(1,total,length)*8;
  if(length-remainder<tolerance){cycles++;remainder=0;}
  if(remainder<tolerance)remainder=0;
  return{time:loop.start+remainder,playing:true,cycles};
 }
 const base=Math.max(0,time);
 if(stopAt!==undefined&&stopAt!==null&&Number.isFinite(stopAt)&&stopAt>base&&stopAt<=duration){
  const next=Math.min(stopAt,base+delta);
  const tolerance=Number.EPSILON*Math.max(1,stopAt)*8;
  if(stopAt-next<=tolerance)return{time:stopAt,playing:false,cycles:0};
  return{time:next,playing:true,cycles:0};
 }
 const next=Math.min(duration,base+delta);
 return{time:next,playing:next<duration,cycles:0};
}
