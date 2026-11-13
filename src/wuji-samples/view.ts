import { AmbientLight, ACESFilmicToneMapping, CircleGeometry, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, GridHelper, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CubeModel } from '../scene/cube-model';
import { MechanicalArm } from '../scene/arm';
import { DEFAULT_PALETTE, NORMALS, moveAngle, type Move } from '../core/cube';
import { CENTER, type HandPose, type MotionFrame, type Side } from '../scene/motion';
import { contactTarget } from '../scene/finger-contact';
import metadata from '../scene/finger-rig.json';
import { fingerJoints } from '../scene/finger-rig';

export class WujiSampleView {
  readonly scene=new Scene();
  readonly camera=new PerspectiveCamera(36,1,.01,8);
  readonly renderer=new WebGLRenderer({antialias:true,alpha:true});
  readonly cube=new CubeModel();
  readonly controls:OrbitControls;
  private observer:ResizeObserver;
  private model?:Group;
  private roots={} as Record<Side,Object3D>;
  private joints=new Map<string,{node:Object3D;base:Quaternion;axis:Vector3;lower:number;upper:number}>();
  private arms={left:new MechanicalArm('left'),right:new MechanicalArm('right')};
  private materials:MeshStandardMaterial[]=[];
  private highlight=new Map<Side,Map<number,MeshStandardMaterial[]>>();
  private ghostEnabled=false;
  private contactGroup=new Group();
  private supportBadges:Group[]=[];
  private driveBadge=new Group();
  private driveArrow=new Group();
  constructor(readonly host:HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.domElement.setAttribute('role','img');this.renderer.domElement.setAttribute('aria-label','真实早期白色机械手三维样片，可拖动查看');
    host.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.copy(CENTER);this.controls.enablePan=false;this.controls.enableDamping=false;this.controls.minDistance=.25;this.controls.maxDistance=1.8;this.controls.maxPolarAngle=Math.PI*.9;
    this.scene.add(new AmbientLight('#e2ebec',.6),new HemisphereLight('#dfeeff','#1b201e',2));
    for(const [color,intensity,position] of [['#fff3df',3,[.6,1,.7]],['#9dcde8',2,[-.6,.8,-.4]],['#ffffff',1,[0,.2,-.6]]] as const){const l=new DirectionalLight(color,intensity);l.position.set(position[0],position[1],position[2]);this.scene.add(l);}
    this.initContactIndicators();
    this.scene.add(this.cube.root,this.arms.left.root,this.arms.right.root,this.contactGroup);
    const floor=new Mesh(new PlaneGeometry(4,4),new MeshStandardMaterial({color:'#10191d',metalness:.25,roughness:.65}));floor.rotation.x=-Math.PI/2;floor.position.y=.005;this.scene.add(floor);
    const grid=new GridHelper(2,30,'#28393e','#18282e');grid.position.y=.006;this.scene.add(grid);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.reset('front');
  }
  private initContactIndicators() {
    const ringGeo=new RingGeometry(.0024,.0042,24);
    const dotGeo=new CircleGeometry(.0013,16);
    const supportMat=new MeshBasicMaterial({color:'#4dc9b0',transparent:true,opacity:.78,side:DoubleSide,depthWrite:false});
    for(let i=0;i<8;i++){
      const g=new Group();
      g.add(new Mesh(ringGeo,supportMat),new Mesh(dotGeo,supportMat));
      g.visible=false;
      this.supportBadges.push(g);
      this.contactGroup.add(g);
    }
    const driveRingGeo=new RingGeometry(.0032,.0056,28);
    const driveDotGeo=new CircleGeometry(.0018,18);
    const driveMat=new MeshBasicMaterial({color:'#6de9ff',transparent:true,opacity:.92,side:DoubleSide,depthWrite:false});
    this.driveBadge.add(new Mesh(driveRingGeo,driveMat),new Mesh(driveDotGeo,driveMat));
    const shaftGeo=new CylinderGeometry(.0007,.0007,.011,12);
    shaftGeo.translate(0,.0055,0);
    const headGeo=new ConeGeometry(.0021,.0048,14);
    headGeo.translate(0,.0132,0);
    const arrowMat=new MeshBasicMaterial({color:'#8df0ff',transparent:true,opacity:.94,depthWrite:false});
    this.driveArrow.add(new Mesh(shaftGeo,arrowMat),new Mesh(headGeo,arrowMat));
    this.driveBadge.add(this.driveArrow);
    this.driveBadge.visible=false;
    this.contactGroup.add(this.driveBadge);
  }
  async load() {
    const gltf=await new GLTFLoader().loadAsync('/models/wuji-teaching/wuji-teaching-hands.glb');
    this.model=gltf.scene;this.scene.add(this.model);
    for(const side of ['left','right'] as const){
      const root=this.model.getObjectByName(`${side}_wuji`);if(!root)throw new Error('早期机械手资源不完整');this.roots[side]=root;
      for(const definition of metadata.sides[side].joints){if(definition.type==='fixed')continue;const node=this.model.getObjectByName(definition.name);if(!node)throw new Error(`缺少原关节 ${definition.name}`);
        this.joints.set(definition.name,{node,base:node.quaternion.clone(),axis:new Vector3().fromArray(definition.axis).normalize(),lower:definition.lower,upper:definition.upper});}
      const perFinger=new Map<number,MeshStandardMaterial[]>();this.highlight.set(side,perFinger);
      root.traverse(node=>{if(!(node instanceof Mesh))return;const materials=(Array.isArray(node.material)?node.material:[node.material]).map(m=>m.clone());node.material=Array.isArray(node.material)?materials:materials[0];
        let p:Object3D|null=node;let digit=0;while(p){const m=p.name.match(/finger(\d)/);if(m){digit=+m[1];break;}p=p.parent;}
        for(const m of materials)if(m instanceof MeshStandardMaterial){this.materials.push(m);if(!perFinger.has(digit))perFinger.set(digit,[]);perFinger.get(digit)!.push(m);}});
    }
  }
  private apply(side:Side,pose:HandPose) {
    this.roots[side].position.copy(pose.position);this.roots[side].quaternion.copy(pose.quaternion);
    for(const [name,value] of Object.entries(pose.joints??{})){const j=this.joints.get(name);if(!j)throw new Error(`未知关节 ${name}`);
      if(!Number.isFinite(value)||value<j.lower-1e-6||value>j.upper+1e-6)throw new Error(`样片关节超出允许范围 ${name}`);
      j.node.quaternion.copy(j.base).multiply(new Quaternion().setFromAxisAngle(j.axis,value));}
    this.arms[side].update(pose.position,pose.quaternion);
  }
  private updateContacts(frame:MotionFrame,move?:Move,shape=false) {
    for(const badge of this.supportBadges)badge.visible=false;
    this.driveBadge.visible=false;
    if(shape||!frame.contacts?.length)return;
    const zAxis=new Vector3(0,0,1),yAxis=new Vector3(0,1,0);
    let supportIdx=0;
    for(const c of frame.contacts){
      const target=contactTarget(c,move,frame.angle,frame.orientation);
      const normal=target.normal.clone().normalize();
      if(c.role==='support'){
        if(supportIdx>=this.supportBadges.length)continue;
        const badge=this.supportBadges[supportIdx++];
        badge.position.copy(target.point).addScaledVector(normal,.0008);
        badge.quaternion.setFromUnitVectors(zAxis,normal);
        badge.visible=true;
      }else if(c.role==='drive'&&(frame.stage==='CONTACT'||frame.stage==='TURN'||frame.stage==='PREPARE')){
        this.driveBadge.position.copy(target.point).addScaledVector(normal,.001);
        this.driveBadge.quaternion.setFromUnitVectors(zAxis,normal);
        this.driveBadge.visible=true;
        if(move&&(frame.stage==='CONTACT'||frame.stage==='TURN')){
          const axis=new Vector3(...NORMALS[move.face]).applyQuaternion(frame.orientation).normalize();
          const r=target.point.clone().sub(CENTER);
          const sign=Math.sign(moveAngle(move))||1;
          const worldTangent=axis.multiplyScalar(sign).cross(r);
          worldTangent.addScaledVector(normal,-worldTangent.dot(normal));
          if(worldTangent.lengthSq()>1e-8){
            worldTangent.normalize();
            const localDir=worldTangent.applyQuaternion(this.driveBadge.quaternion.clone().invert()).normalize();
            this.driveArrow.quaternion.setFromUnitVectors(yAxis,localDir);
            this.driveArrow.visible=true;
          }else this.driveArrow.visible=false;
        }else this.driveArrow.visible=false;
      }
    }
  }
  update(frame:MotionFrame,state:string,move?:Move,shape=false,open=false) {
    if(!this.model)return;
    for(const side of ['left','right'] as const){let pose=frame[side];
      if(shape&&open){pose={...pose,position:pose.position.clone(),quaternion:pose.quaternion.clone(),joints:{...pose.joints}};
        for(let digit=1;digit<=5;digit++){const js=fingerJoints(side,digit as 1|2|3|4|5);js.forEach((j,i)=>pose.joints![j.name]=Math.max(j.lower,Math.min(j.upper,digit===1?[.35,.15,.15,.15][i]:[.06,0,.12,.15][i])));}}
      this.apply(side,pose);
      for(const [digit,materials] of this.highlight.get(side)!){
        const isDrive=!shape&&digit>0&&side===frame.active&&digit===frame.activeFinger;
        const isSupport=!shape&&digit>0&&!isDrive&&!!frame.contacts?.some(c=>c.side===side&&c.finger===digit&&c.role==='support');
        const isRelease=isDrive&&frame.stage==='RELEASE';
        const emissive=isRelease?'#3e6372':isDrive?(frame.stage==='TURN'||frame.stage==='CONTACT'?'#388c9e':'#2d6878'):isSupport?'#1f5c50':'#000000';
        const intensity=isDrive?(frame.stage==='TURN'||frame.stage==='CONTACT'?.32:.24):isSupport?.16:0;
        const opacity=!this.ghostEnabled?1:isDrive?.82:isSupport?.45:.22;
        const depthWrite=!this.ghostEnabled||isDrive;
        for(const m of materials){
          m.emissive.set(emissive);
          m.emissiveIntensity=intensity;
          if(this.ghostEnabled){m.transparent=true;m.opacity=opacity;m.depthWrite=depthWrite;}
        }
      }
    }
    this.updateContacts(frame,move,shape);
    this.cube.root.visible=!shape;
    this.cube.update(state,DEFAULT_PALETTE,frame.orientation,move,frame.angle);
    this.model.updateMatrixWorld(true);
  }
  ghost(enabled:boolean){this.ghostEnabled=enabled;for(const m of this.materials){m.transparent=enabled;m.opacity=enabled?.25:1;m.depthWrite=!enabled;m.needsUpdate=true;}}
  reset(view:'front'|'side'|'rear'|'wide'='front') {this.camera.position.set(...(view==='front'?[.08,.52,.45]:view==='side'?[-.42,.66,.12]:view==='rear'?[.04,.55,-.42]:[.9,.82,1.05]) as [number,number,number]);this.controls.target.copy(view==='wide'?new Vector3(0,.3,0):CENTER);this.controls.update();}
  private resize(){const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);}
  render(){this.renderer.render(this.scene,this.camera);}
  dispose(){this.observer.disconnect();this.controls.dispose();this.scene.traverse(n=>{if(n instanceof Mesh)n.geometry.dispose();});this.materials.forEach(m=>m.dispose());this.renderer.dispose();}
}
