import{Quaternion,Vector3}from'three';import{parseMove}from'../core/cube';import{clonePose,fingerContacts,fingerLibrary,handPose,rotatedFingerPose}from'../scene/finger-data';import type{FingerProgram}from'../scene/finger-program';import type{FingerContact}from'../scene/finger-contact';import{createRingSideFlickProgram}from'./ring-side-flick';
/** Proper rigid placement of the real left ring stroke on the bottom side.
 * Only the active hand moves down38mm. The other original grip moves up38mm
 * to hold stationary upper/middle cubies; no mesh reflection or limit change. */
export function createBottomRingProgram(prime=false):FingerProgram{
 const source=createRingSideFlickProgram(),Rz=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-Math.PI/2),rotation=prime?Rz.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI)):Rz,move=parseMove(prime?"D'":'D'),shift=new Vector3(0,-.038,0),right=handPose(fingerLibrary.hands.right.support);right.position.y+=.038;
 const support=fingerContacts('right',fingerLibrary.hands.right.contacts).map(c=>({...c,point:c.point.clone().add(new Vector3(0,.038,0))}));
 const contact=(c:FingerContact):FingerContact=>({...c,point:c.point.clone().applyQuaternion(rotation).add(shift),normal:c.normal.clone().applyQuaternion(rotation),padOffset:c.padOffset.clone()});
 const convert=<T extends ReturnType<FingerProgram['segments'][number]['sample']>>(f:T):T=>{const left=rotatedFingerPose(f.left,rotation);left.position.add(shift);if(!prime)left.joints!.left_finger1_joint1-=.08;return{...f,left,right:clonePose(right),angle:(prime?1:-1)*f.angle,contacts:[...support,...f.contacts.filter(c=>c.role==='drive').map(contact)]};};
 const phase=(s:string)=>{let text=s.replaceAll('M′',prime?'D′':'D').replaceAll('中层','底层').replaceAll('屈曲向下拨动','沿底层侧边屈指拨动');if(prime)text=text.replaceAll('背侧','前侧');return text;};
 return{...source,steps:source.steps.map(s=>({...s,move})),segments:source.segments.map(s=>({...s,phase:phase(s.phase),sample:p=>convert(s.sample(p))})),sample:t=>{const f=source.sample(t);return{...f,...convert({...f,contacts:[...(f.contacts??[])]}),phase:phase(f.phase)};}};
}
