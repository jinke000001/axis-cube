import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Quaternion,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CubeModel } from "../scene/cube-model";
import { DEFAULT_PALETTE } from "../core/cube";

export function CubePreview({ state }: { state: string }) {
  const host = useRef<HTMLDivElement>(null),
    update = useRef<((state: string) => void) | null>(null),
    latest = useRef(state);
  const [unavailable, setUnavailable] = useState(false);
  latest.current = state;
  useEffect(() => {
    const element=host.current;
    if(!element)return;
    let disposed=false;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    element.append(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "录入局面的三维预览，可拖动查看六面",
    );
    const scene = new Scene(),
      cube = new CubeModel(),
      camera = new PerspectiveCamera(35, 1, 0.01, 2);
    cube.root.position.set(0, 0, 0);
    scene.add(cube.root);
    camera.position.set(0.15, 0.12, 0.18);
    scene.add(new HemisphereLight("#ffffff", "#809aa0", 2));
    const key = new DirectionalLight("#ffffff", 3);
    key.position.set(0.2, 0.4, 0.3);
    scene.add(key);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 0.17;
    controls.maxDistance = 0.45;
    const render = () => {if(!disposed)renderer.render(scene, camera);};
    controls.addEventListener("change", render);
    update.current = (value) => {
      cube.update(value, DEFAULT_PALETTE, new Quaternion());
      render();
    };
    update.current(latest.current);
    const observer = new ResizeObserver(() => {
      if(disposed||!element.isConnected)return;
      const { clientWidth: w, clientHeight: h } = element;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    observer.observe(element);
    return () => {
      disposed=true;
      update.current = null;
      observer.disconnect();
      controls.dispose();
      cube.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => update.current?.(state), [state]);
  return (
    <div className="cube-preview" ref={host}>
      {unavailable ? (
        <p>三维预览暂不可用，可继续核对展开图。</p>
      ) : (
        <span>拖动核对六面 · 灰色为未录入</span>
      )}
    </div>
  );
}
