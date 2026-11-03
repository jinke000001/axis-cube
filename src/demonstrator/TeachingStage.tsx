import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AmbientLight, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace,
  TorusGeometry, Vector3, WebGLRenderer, ACESFilmicToneMapping,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_PALETTE } from '../core/cube';
import { CubeModel } from '../scene/cube-model';
import type { DemonstratorHandle, DemonstratorStatus, FormulaRecord } from './types';
import { compileTeachingMotion, sampleTeachingMotion, teachingBoundaryTime, type TeachingMotion } from './motion';
import { TeachingRig, prepareTeachingTrajectory, teachingTrajectoryCacheInfo } from './rig';
import { isDemonstrationAvailable } from './availability';

export interface TeachingStageProps {
  formula:FormulaRecord;
  speed:number;
  ghostHands:boolean;
  loopGroup:number|null;
  onStatus:(status:DemonstratorStatus)=>void;
}
const VIEWS = {
  solver:new Vector3(.015,.20,.39),
  side:new Vector3(.37,.14,.10),
  back:new Vector3(-.02,.19,-.39),
};
interface Runtime extends DemonstratorHandle {
  setFormula(formula:FormulaRecord):void;
  dispose():void;
  ghost(value:boolean):void;
}

const TeachingStage=forwardRef<DemonstratorHandle,TeachingStageProps>(function TeachingStage(props,ref) {
  const host=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null);
  const latest=useRef(props);latest.current=props;
  const [failure,setFailure]=useState<string>();
  const [ready,setReady]=useState(false);
  useImperativeHandle(ref,()=>({
    play:()=>runtime.current?.play(),pause:()=>runtime.current?.pause(),seek:step=>runtime.current?.seek(step),
    resetView:()=>runtime.current?.resetView(),setView:view=>runtime.current?.setView(view),
  }),[]);
  useEffect(()=> {
    const element=host.current;if(!element)return;
    let renderer:WebGLRenderer;
    try { renderer=new WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'}); }
    catch { const error='这台设备暂时无法显示三维画面。公式和识别图仍可查看。';setFailure(error);latest.current.onStatus({ready:false,playing:false,completed:0,active:0,phase:'三维不可用',instruction:'',finger:'',error});return; }
    const scene=new Scene();scene.background=null;
    const camera=new PerspectiveCamera(34,1,.01,5);
    camera.position.copy(VIEWS.solver);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.7));
    renderer.outputColorSpace=SRGBColorSpace;
    renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
    renderer.shadowMap.enabled=matchMedia('(min-width: 850px)').matches;
    renderer.shadowMap.type=PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label','CFOP 机械手三维演示，可拖动观察');
    renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none';
    element.appendChild(renderer.domElement);
    element.dataset.instance=crypto.randomUUID();
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.target.set(0,0,0);controls.enableDamping=false;controls.enablePan=false;
    controls.minDistance=.25;controls.maxDistance=.85;controls.maxPolarAngle=Math.PI*.88;
    controls.update();
    scene.add(new AmbientLight(0xd5e9ff,1.1));scene.add(new HemisphereLight(0xc2e2ff,0x0b1018,2));
    const key=new DirectionalLight(0xffffff,4);key.position.set(.1,.4,.3);key.castShadow=renderer.shadowMap.enabled;
    key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-.4,right:.4,top:.4,bottom:-.4,near:.01,far:2});
    key.shadow.bias=-.0002;scene.add(key);
    const rim=new DirectionalLight(0x84c9ed,2.4);rim.position.set(-.3,.16,-.25);scene.add(rim);
    const fill=new DirectionalLight(0xf0e3d3,1.3);fill.position.set(.4,.03,-.1);scene.add(fill);
    const decor=new Group();scene.add(decor);
    const dark=new MeshStandardMaterial({color:'#111a22',metalness:.65,roughness:.37});
    const metal=new MeshStandardMaterial({color:'#687d8a',metalness:.85,roughness:.28});
    const ice=new MeshStandardMaterial({color:'#75c5dc',emissive:'#235666',emissiveIntensity:1.2,metalness:.4,roughness:.3});
    const plinth=new Mesh(new CylinderGeometry(.255,.233,.032,72),dark);plinth.position.y=-.258;plinth.receiveShadow=true;decor.add(plinth);
    const top=new Mesh(new CylinderGeometry(.247,.247,.004,72),dark);top.position.y=-.24;top.receiveShadow=true;decor.add(top);
    for(const [radius,y,tube,material] of [[.252,-.244,.002,metal],[.267,-.276,.0018,ice],[.215,-.237,.0005,metal]] as const) {
      const ring=new Mesh(new TorusGeometry(radius,tube,6,80),material);ring.rotation.x=Math.PI/2;ring.position.y=y;decor.add(ring);
    }
    const cube=new CubeModel();cube.root.position.set(0,0,0);scene.add(cube.root);
    let rig:TeachingRig|undefined,disposed=false,available=true,playing=false,time=0,dirty=true,last=performance.now(),lastStatus=0;
    let renderCount=0,renderMean=0,renderMax=0;
    let selected=latest.current.formula,program:TeachingMotion|undefined;
    let selectionGeneration=0,formulaLoading=false,selectionStarted=false;
    let formulaError:string|undefined,rigError:string|undefined,renderError:string|undefined;
    let posedProgram:TeachingMotion|undefined,posedTime=-1;
    let frameId=0;
    const canPlay=()=>isDemonstrationAvailable(selected.id)&&!!rig&&!!program&&!formulaLoading&&!formulaError&&!rigError&&available;
    const emit=(force=false)=> {
      if(disposed)return;
      if(!force&&performance.now()-lastStatus<70)return;
      const calibrating=!isDemonstrationAvailable(selected.id);
      const error=renderError??(calibrating?undefined:rigError??formulaError);
      const frame=program&&!formulaLoading&&!formulaError?sampleTeachingMotion(program,time):undefined;
      lastStatus=performance.now();
      const ready=canPlay();setReady(ready);setFailure(error);
      latest.current.onStatus({ready,playing:ready&&playing,completed:frame?.completed??0,active:frame?.step??0,
        phase:error?'暂不可播放':calibrating?'演示校准中':formulaLoading?'准备动作':frame?.phase??'准备',
        instruction:error?'':calibrating?'可先查看识别图、拿法与原表公式。':frame?.instruction??'正在准备本条公式的机械动作',finger:error?'':frame?.finger??'',error});
    };
    const failRendering=(message:string)=> {
      available=false;playing=false;dirty=false;renderError=message;
      element.dataset.playing='false';emit(true);
    };
    renderer.debug.onShaderError=()=>failRendering('这台设备未能绘制机械手。公式记录仍可查看，请重新加载后重试。');
    const draw=()=> {
      const started=performance.now();
      const frame=program&&!formulaLoading&&!formulaError?sampleTeachingMotion(program,time):undefined;
      const calibrating=!isDemonstrationAvailable(selected.id);
      cube.root.visible=!!frame||calibrating;
      if(rig)rig.root.visible=!!frame&&!rigError;
      if(calibrating)cube.update(selected.initialState,DEFAULT_PALETTE,new Quaternion());
      if(frame&&(posedProgram!==program||posedTime!==time)) {
        cube.update(frame.state,DEFAULT_PALETTE,new Quaternion(),frame.move,frame.angle);
        rig?.update(frame);posedProgram=program;posedTime=time;
      }
      renderer.render(scene,camera);
      element.dataset.formula=selected.id;
      element.dataset.step=String(frame?.completed??0);
      element.dataset.state=frame?.state??(calibrating?selected.initialState:'');element.dataset.angle=String(frame?.angle??0);element.dataset.phase=calibrating?'演示校准中':frame?.phase??'准备';
      element.dataset.availability=calibrating?'calibrating':'available';
      element.dataset.playing=String(playing);
      element.dataset.camera=JSON.stringify([...camera.matrixWorld.elements,...camera.projectionMatrix.elements]);
      element.dataset.contexts='1';
      element.dataset.geometries=String(renderer.info.memory.geometries);
      element.dataset.textures=String(renderer.info.memory.textures);
      const cache=teachingTrajectoryCacheInfo();
      element.dataset.motionPrograms=String(cache.registeredPrograms);
      element.dataset.motionTracks=String(cache.decodedTracks);
      element.dataset.motionRequests=String(cache.inflightRequests);
      const elapsed=performance.now()-started;renderCount++;renderMean+=(elapsed-renderMean)/renderCount;renderMax=Math.max(renderMax,elapsed);
      element.dataset.renderMs=elapsed.toFixed(2);element.dataset.renderMeanMs=renderMean.toFixed(2);
      element.dataset.renderMaxMs=renderMax.toFixed(2);element.dataset.renderCount=String(renderCount);
      dirty=false;
    };
    const change=()=>{dirty=true;};controls.addEventListener('change',change);
    const fitCamera=()=> {
      const distance=camera.position.distanceTo(controls.target);
      camera.fov=Math.max(34,2*Math.atan(.30/(2*distance*camera.aspect))*180/Math.PI);
      camera.updateProjectionMatrix();
    };
    const resize=new ResizeObserver(entries=> {
      const box=entries[0]?.contentRect;if(!box||box.width<1||box.height<1)return;
      camera.aspect=box.width/box.height;
      // Fit only when the container changes. No document/scroll coordinates.
      fitCamera();
      renderer.setSize(box.width,box.height,false);dirty=true;
    });resize.observe(element);
    const pause=()=>{playing=false;dirty=true;emit(true);};
    const lifecycle=()=>{if(document.hidden)pause();};
    document.addEventListener('visibilitychange',lifecycle);
    window.addEventListener('axis:app-pause',pause);
    const contextLost=(event:Event)=> {event.preventDefault();failRendering('三维画面暂时中断，请重新加载。公式记录仍然保留。');};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    function animate(now:number) {
      if(disposed)return;
      const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;
      if(playing&&program&&canPlay()&&!document.hidden) {
        time+=dt*Math.max(.1,Math.min(2,latest.current.speed));
        const group=latest.current.loopGroup===null?undefined:selected.groups.find(g=>g.index===latest.current.loopGroup);
        const end=group?teachingBoundaryTime(program,group.end):program.duration;
        const reachedBoundary=time>=end;
        if(reachedBoundary) {
          if(group) time=teachingBoundaryTime(program,group.start);
          else {time=program.duration;playing=false;}
        }
        dirty=true;emit(reachedBoundary);
      }
      if(dirty&&available) {
        try{draw();}catch{failRendering('三维演示暂时中断。公式记录仍然保留，请重新加载后重试。');}
      }
      frameId=requestAnimationFrame(animate);
    }
    const selectFormula=(formula:FormulaRecord)=> {
      if(selectionStarted&&selected===formula&&(formulaLoading||program)&&!formulaError)return;
      selectionStarted=true;selected=formula;program=undefined;time=0;playing=false;
      formulaLoading=true;formulaError=undefined;posedProgram=undefined;posedTime=-1;dirty=true;
      const generation=++selectionGeneration;
      // Hide the previous demonstration immediately. A failed or late request
      // must never leave old hands/cube under the newly selected formula title.
      cube.root.visible=false;if(rig)rig.root.visible=false;
      element.dataset.formula=formula.id;element.dataset.state='';element.dataset.step='0';
      element.dataset.playing='false';element.dataset.phase='准备';element.dataset.angle='0';
      if(!isDemonstrationAvailable(formula.id)) {
        formulaLoading=false;emit(true);return;
      }
      emit(true);
      void (async()=> {
        try {
          const next=compileTeachingMotion(formula);
          await prepareTeachingTrajectory(next);
          if(disposed||generation!==selectionGeneration)return;
          program=next;formulaLoading=false;dirty=true;emit(true);
        } catch {
          if(disposed||generation!==selectionGeneration)return;
          formulaLoading=false;formulaError='本条动作资料未能加载，请刷新页面重试，或先查看情形图。';
          program=undefined;playing=false;dirty=true;emit(true);
        }
      })();
    };
    const controller:Runtime={
      play(){if(!canPlay()||!program)return;const group=latest.current.loopGroup===null?undefined:selected.groups.find(g=>g.index===latest.current.loopGroup);
        if(group&&(time<teachingBoundaryTime(program,group.start)||time>=teachingBoundaryTime(program,group.end)))time=teachingBoundaryTime(program,group.start);
        if(time>=program.duration)time=0;playing=true;last=performance.now();emit(true);},
      pause,
      seek(step){if(!canPlay()||!program)return;playing=false;time=teachingBoundaryTime(program,step);dirty=true;emit(true);},
      setFormula:selectFormula,
      resetView(){this.setView('solver');},
      setView(view){camera.position.copy(VIEWS[view]);controls.target.set(0,0,0);controls.update();fitCamera();dirty=true;},
      ghost(value){rig?.setGhost(value);posedTime=-1;dirty=true;},
      dispose(){disposed=true;selectionGeneration++;cancelAnimationFrame(frameId);resize.disconnect();controls.dispose();
        document.removeEventListener('visibilitychange',lifecycle);window.removeEventListener('axis:app-pause',pause);
        renderer.domElement.removeEventListener('webglcontextlost',contextLost);rig?.dispose();cube.dispose();
        decor.traverse(node=>{if(node instanceof Mesh)node.geometry.dispose();});dark.dispose();metal.dispose();ice.dispose();
        renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();},
    };
    runtime.current=controller;selectFormula(latest.current.formula);
    void TeachingRig.load().then(loaded=> {
      if(disposed||!available){loaded.dispose();return;}
      rig=loaded;rig.root.visible=!!program&&!formulaLoading&&!formulaError;scene.add(rig.root);
      rig.setGhost(latest.current.ghostHands);posedTime=-1;dirty=true;emit(true);
    }).catch(()=>{if(!disposed){rigError='机械手资源未能加载，请重新加载后继续。';emit(true);}});
    frameId=requestAnimationFrame(animate);
    return()=>{runtime.current=null;controller.dispose();};
  },[]);
  useEffect(()=>{runtime.current?.setFormula(props.formula);},[props.formula]);
  useEffect(()=>{runtime.current?.ghost(props.ghostHands);},[props.ghostHands]);
  return <div ref={host} className="cfop-teaching-stage" style={{position:'absolute',inset:0,overflow:'hidden'}}>
    {!ready&&!failure&&isDemonstrationAvailable(props.formula.id)&&<div role="status" className="cfop-stage-message" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',padding:24,textAlign:'center',color:'#b9ccd7',pointerEvents:'none',zIndex:1}}>
      正在准备机械展台…
    </div>}
  </div>;
});
export default TeachingStage;
