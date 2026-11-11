import { AmbientLight, ACESFilmicToneMapping, DirectionalLight, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3, WebGLRenderer, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CubeModel } from '../scene/cube-model';
import { MechanicalArm } from '../scene/arm';
import { DEFAULT_PALETTE, type Move } from '../core/cube';
import { CENTER, type HandPose, type MotionFrame, type Side } from '../scene/motion';
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
  constructor(readonly host:HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.domElement.setAttribute('role','img');this.renderer.domElement.setAttribute('aria-label','真实早期白色机械手三维样片，可拖动查看');
    host.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.copy(CENTER);this.controls.enablePan=false;this.controls.enableDamping=false;this.controls.minDistance=.25;this.controls.maxDistance=1.8;this.controls.maxPolarAngle=Math.PI*.9;
    this.scene.add(new AmbientLight('#e2ebec',.6),new HemisphereLight('#dfeeff','#1b201e',2));
    for(const [color,intensity,position] of [['#fff3df',3,[.6,1,.7]],['#9dcde8',2,[-.6,.8,-.4]],['#ffffff',1,[0,.2,-.6]]] as const){const l=new DirectionalLight(color,intensity);l.position.set(position[0],position[1],position[2]);this.scene.add(l);}
    this.scene.add(this.cube.root,this.arms.left.root,this.arms.right.root);
    const floor=new Mesh(new PlaneGeometry(4,4),new MeshStandardMaterial({color:'#10191d',metalness:.25,roughness:.65}));floor.rotation.x=-Math.PI/2;floor.position.y=.005;this.scene.add(floor);
    const grid=new GridHelper(2,30,'#28393e','#18282e');grid.position.y=.006;this.scene.add(grid);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.reset('front');
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
        for(const m of materials)if(m instanceof MeshStandardMaterial){this.materials.push(m);if(digit){if(!perFinger.has(digit))perFinger.set(digit,[]);perFinger.get(digit)!.push(m);}}});
    }
  }
  private apply(side:Side,pose:HandPose) {
    this.roots[side].position.copy(pose.position);this.roots[side].quaternion.copy(pose.quaternion);
    for(const [name,value] of Object.entries(pose.joints??{})){const j=this.joints.get(name);if(!j)throw new Error(`未知关节 ${name}`);
      if(!Number.isFinite(value)||value<j.lower-1e-6||value>j.upper+1e-6)throw new Error(`样片关节超出允许范围 ${name}`);
      j.node.quaternion.copy(j.base).multiply(new Quaternion().setFromAxisAngle(j.axis,value));}
    this.arms[side].update(pose.position,pose.quaternion);
  }
  update(frame:MotionFrame,state:string,move?:Move,shape=false,open=false) {
    if(!this.model)return;
    for(const side of ['left','right'] as const){let pose=frame[side];
      if(shape&&open){pose={...pose,position:pose.position.clone(),quaternion:pose.quaternion.clone(),joints:{...pose.joints}};
        for(let digit=1;digit<=5;digit++){const js=fingerJoints(side,digit as 1|2|3|4|5);js.forEach((j,i)=>pose.joints![j.name]=Math.max(j.lower,Math.min(j.upper,digit===1?[.35,.15,.15,.15][i]:[.06,0,.12,.15][i])));}}
      this.apply(side,pose);
      for(const [digit,materials] of this.highlight.get(side)!)for(const m of materials){m.emissive.set(!shape&&side===frame.active&&digit===frame.activeFinger?'#356f7c':'#000000');m.emissiveIntensity=.24;}}
    this.cube.root.visible=!shape;
    this.cube.update(state,DEFAULT_PALETTE,frame.orientation,move,frame.angle);
    this.model.updateMatrixWorld(true);
  }
  ghost(enabled:boolean){for(const m of this.materials){m.transparent=enabled;m.opacity=enabled?.25:1;m.depthWrite=!enabled;m.needsUpdate=true;}}
  reset(view:'front'|'side'|'rear'|'wide'='front') {this.camera.position.set(...(view==='front'?[.08,.52,.45]:view==='side'?[-.42,.66,.12]:view==='rear'?[.04,.55,-.42]:[.9,.82,1.05]) as [number,number,number]);this.controls.target.copy(view==='wide'?new Vector3(0,.3,0):CENTER);this.controls.update();}
  private resize(){const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);}
  render(){this.renderer.render(this.scene,this.camera);}
  dispose(){this.observer.disconnect();this.controls.dispose();this.scene.traverse(n=>{if(n instanceof Mesh)n.geometry.dispose();});this.materials.forEach(m=>m.dispose());this.renderer.dispose();}
}
