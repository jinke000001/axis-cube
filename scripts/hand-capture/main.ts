/**
 * Offline still and clip stage for the teaching-hand comparison.
 * Uses the same rig, cube, and trajectory loader as the player.
 * Not a production route.
 */
import {
  AmbientLight, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial,
  Object3D, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3,
  WebGLRenderer, ACESFilmicToneMapping, CylinderGeometry, TorusGeometry, Group,
  Color,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_PALETTE, SOLVED } from '../../src/core/cube';
import { CubeModel } from '../../src/scene/cube-model';
import { FORMULAS } from '../../src/demonstrator/catalog';
import { mirroredRest } from '../../src/demonstrator/hand-model';
import {
  FINGER_NAMES, HANDS, compileTeachingMotion, sampleTeachingMotion,
  type TeachingFrame, type TeachingHand, type TeachingPose,
} from '../../src/demonstrator/motion';
import { TeachingRig, prepareTeachingTrajectory } from '../../src/demonstrator/rig';

const UP = new Vector3(0, 1, 0);
const params = new URLSearchParams(location.search);
const shot = params.get('shot') ?? 'open';
const model = params.get('model') ?? 'v2';
const formulaId = params.get('id') ?? 'gan-f2l-40';
const caption = document.querySelector<HTMLDivElement>('#caption')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const stage = document.querySelector<HTMLDivElement>('#stage')!;

const MODELS: Record<string, { url: string; label: string; retargetArms: boolean }> = {
  early: { url: '/capture-assets/early-white-hand.glb', label: '早期白壳手（按参考重建，不进播放器）', retargetArms: false },
  baseline: { url: '/capture-assets/baseline-teaching-hand.glb', label: '当前基线手', retargetArms: true },
  v2: { url: '/models/teaching-hand/axis-teaching-hand.glb', label: '新教学手 v2', retargetArms: false },
};

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/motions/cfop/gan-oll-12.json')) {
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    return originalFetch(`/capture-assets/motions/gan-oll-12.json${query}`, init);
  }
  return originalFetch(input, init);
};

function neutralPose(): TeachingPose {
  return Object.fromEntries(HANDS.map(hand => {
    const sign = hand === 'right' ? 1 : -1;
    const palm = [sign * 0.09, -0.004, 0] as [number, number, number];
    return [hand, {
      palm,
      rotation: [0, 0, 0, 1],
      tips: Object.fromEntries(FINGER_NAMES.map(finger => {
        const local = mirroredRest(hand, finger);
        return [finger, {
          point: [local[0] + palm[0], local[1] + palm[1], local[2] + palm[2]],
          normal: [sign, 0, 0],
          resting: true,
        }];
      })),
    }];
  })) as TeachingPose;
}

function openFrame(): TeachingFrame {
  return {
    state: SOLVED, step: 0, completed: 0, angle: 0, pose: neutralPose(), contacts: [],
    phase: '张开', instruction: '', finger: '', complete: false,
  };
}

function alignNode(node: Object3D, origin: Vector3, end: Vector3) {
  const worldQ = new Quaternion().setFromUnitVectors(UP, end.clone().sub(origin).normalize());
  const parentQ = node.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  node.quaternion.copy(parentQ.invert().multiply(worldQ));
  node.updateMatrixWorld(true);
}

function twoBone(start: Vector3, end: Vector3, l1: number, l2: number, pole: Vector3) {
  const delta = end.clone().sub(start);
  const dist = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, delta.length() || 1e-4));
  const target = start.clone().addScaledVector(delta.normalize(), dist);
  const along = target.clone().sub(start).multiplyScalar(1 / dist);
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const side = pole.clone().sub(start);
  side.addScaledVector(along, -side.dot(along));
  if (side.lengthSq() < 1e-8) side.set(0, 0, 1);
  side.normalize();
  return { elbow: start.clone().addScaledVector(along, x).addScaledVector(side, h), target };
}

function retargetArmsToCouplers(root: Object3D) {
  for (const side of ['left', 'right'] as const) {
    const coupler = root.getObjectByName(`${side}_wrist_coupler`);
    const shoulder = root.getObjectByName(`${side}_shoulder`);
    const elbow = root.getObjectByName(`${side}_elbow`);
    if (!coupler || !shoulder || !elbow) continue;
    const target = coupler.getWorldPosition(new Vector3());
    const sign = side === 'right' ? 1 : -1;
    const shoulderPos = new Vector3(sign * 0.215, -0.23, 0.04);
    const pole = shoulderPos.clone().lerp(target, 0.5).add(new Vector3(sign * 0.2, 0, 0));
    const solved = twoBone(shoulderPos, target, 0.2, 0.19, pole);
    shoulder.position.copy(shoulderPos);
    shoulder.updateMatrixWorld(true);
    alignNode(shoulder, shoulderPos, solved.elbow);
    alignNode(elbow, solved.elbow, solved.target);
  }
}

const scene = new Scene();
scene.background = null;
const camera = new PerspectiveCamera(34, 1, 0.01, 5);
if (params.get('view') === 'quarter') {
  camera.position.set(0.28, 0.17, 0.26);
  camera.lookAt(0.01, 0.02, 0);
} else {
  camera.position.set(0.015, 0.2, 0.39);
  camera.lookAt(0, 0.01, 0);
}
const renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setClearColor(0x0b1318, 1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.setPixelRatio(1);
stage.appendChild(renderer.domElement);
scene.add(new AmbientLight(0xd5e9ff, 1.1));
scene.add(new HemisphereLight(0xc2e2ff, 0x0b1018, 2));
const key = new DirectionalLight(0xffffff, 4);
key.position.set(0.1, 0.4, 0.3);
scene.add(key);
const rim = new DirectionalLight(0x84c9ed, 2.4);
rim.position.set(-0.3, 0.16, -0.25);
scene.add(rim);
const fill = new DirectionalLight(0xf0e3d3, 1.3);
fill.position.set(0.4, 0.03, -0.1);
scene.add(fill);

const decor = new Group();
scene.add(decor);
const dark = new MeshStandardMaterial({ color: '#111a22', metalness: 0.65, roughness: 0.37 });
const metal = new MeshStandardMaterial({ color: '#687d8a', metalness: 0.85, roughness: 0.28 });
const plinth = new Mesh(new CylinderGeometry(0.255, 0.233, 0.032, 72), dark);
plinth.position.y = -0.258;
decor.add(plinth);
const top = new Mesh(new CylinderGeometry(0.247, 0.247, 0.004, 72), dark);
top.position.y = -0.24;
decor.add(top);
const ring = new Mesh(new TorusGeometry(0.252, 0.002, 6, 80), metal);
ring.rotation.x = Math.PI / 2;
ring.position.y = -0.244;
decor.add(ring);

const cube = new CubeModel();
cube.root.position.set(0, 0, 0);
scene.add(cube.root);

function resize() {
  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  camera.aspect = width / Math.max(1, height);
  const distance = camera.position.length();
  camera.fov = Math.max(34, 2 * Math.atan(0.3 / (2 * distance * camera.aspect)) * 180 / Math.PI);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
resize();
window.addEventListener('resize', resize);

let rig: TeachingRig | undefined;
let program: ReturnType<typeof compileTeachingMotion> | undefined;
let ready = false;
let error = '';

function paint(frame: TeachingFrame) {
  if (!rig) return;
  const shown = params.get('live') === '1' ? { ...frame, motionId: undefined } : frame;
  cube.root.visible = shot !== 'compare';
  cube.update(shown.state, DEFAULT_PALETTE, new Quaternion(), shown.move, shown.angle);
  rig.update(shown);
  if (shot === 'compare' && MODELS[model]?.retargetArms) retargetArmsToCouplers(rig.root);
  renderer.render(scene, camera);
}

function applyLook(root: Object3D) {
  const shell = params.get('shell');
  if (!shell) return;
  const [r, g, b] = shell.split(',').map(Number);
  const shellColor = new Color(r, g, b);
  root.traverse(node => {
    if (!(node instanceof Mesh) || !(node.material instanceof MeshStandardMaterial)) return;
    const name = node.name;
    if (/hinge|palm_inner|pad|bearing/.test(name)) {
      node.material.color.setRGB(0.012, 0.012, 0.014);
      node.material.metalness = 0.2;
      node.material.roughness = 0.42;
    } else if (/band|ring|mount|neck|collar/.test(name)) {
      node.material.color.setRGB(0.55, 0.57, 0.6);
      node.material.metalness = 0.92;
      node.material.roughness = 0.28;
    } else {
      node.material.color.copy(shellColor);
      node.material.metalness = 0.05;
      node.material.roughness = 0.58;
    }
  });
}

async function loadRig(url: string) {
  const gltf = await new GLTFLoader().loadAsync(url);
  applyLook(gltf.scene);
  const Ctor = TeachingRig as unknown as new (root: Group) => TeachingRig;
  rig = new Ctor(gltf.scene);
  scene.add(rig.root);
}

async function loadProgram(id: string) {
  const record = FORMULAS.find(item => item.id === id);
  if (!record) throw new Error(`找不到公式 ${id}`);
  program = compileTeachingMotion(record);
  await prepareTeachingTrajectory(program);
}

function show(frame: TeachingFrame, label: string) {
  paint(frame);
  caption.textContent = label;
  status.textContent = frame.time === undefined ? '' : `${frame.time.toFixed(2)} s`;
  ready = true;
  document.body.dataset.ready = '1';
  document.body.dataset.error = '';
}

async function boot() {
  try {
    if (shot === 'compare') {
      const chosen = MODELS[model] ?? MODELS.v2;
      caption.textContent = '正在加载手型…';
      await loadRig(chosen.url);
      show(openFrame(), chosen.label);
      return;
    }
    await loadRig(MODELS.v2.url);
    if (shot === 'open') {
      show(openFrame(), 'v2 张开');
      return;
    }
    const id = shot === 'hold' ? 'gan-f2l-40' : formulaId;
    caption.textContent = '正在准备动作…';
    if (params.get('live') !== '1') await loadProgram(id);
    else program = compileTeachingMotion(FORMULAS.find(item => item.id === id)!);
    const time = Number(params.get('t') ?? '0');
    const frame = sampleTeachingMotion(program!, time);
    const label = shot === 'hold' ? 'v2 持握魔方' : `${id}  ${frame.phase}`;
    show(frame, label);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    status.textContent = error;
    document.body.dataset.ready = '0';
    document.body.dataset.error = error;
    console.error(caught);
  }
}

const api = {
  get ready() { return ready; },
  get error() { return error; },
  get duration() { return program?.duration ?? 0; },
  seek(time: number) {
    if (!program || !rig) throw new Error(error || '动作尚未准备好');
    const frame = sampleTeachingMotion(program, time);
    show(frame, `${formulaId}  ${frame.phase}`);
    return { time: frame.time ?? time, phase: frame.phase, step: frame.step, instruction: frame.instruction, finger: frame.finger };
  },
};
Object.assign(window, { __axis: api });
void boot();
