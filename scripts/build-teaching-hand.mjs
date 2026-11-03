/**
 * Builds the rigid teaching-hand GLB from art/teaching-hand/rig.json.
 * Runtime rotates named MCP/PIP/DIP nodes; it never scales a bone.
 * Link meshes stay on local +Y, which is the axis TeachingRig aligns.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Blob } from 'node:buffer';
import {
  Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() { this.result = null; this.onloadend = null; }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = buffer;
        queueMicrotask(() => this.onloadend?.());
      });
    }
  };
}
globalThis.Blob = globalThis.Blob ?? Blob;

const rootDir = resolve(import.meta.dirname, '..');
const spec = JSON.parse(readFileSync(resolve(rootDir, 'art/teaching-hand/rig.json'), 'utf8'));
const out = resolve(rootDir, 'public/models/teaching-hand/axis-teaching-hand.glb');

function material(entry) {
  const [r, g, b] = entry.color;
  return new MeshStandardMaterial({
    color: new Color(r, g, b),
    metalness: entry.metalness,
    roughness: entry.roughness,
  });
}

function linkMesh(parent, name, boneLength, radius, startGap, endGap, shell, metalMat, segments) {
  const length = Math.max(0.004, boneLength - startGap - endGap);
  const mesh = new Mesh(new CylinderGeometry(radius * 0.96, radius, length, segments, 1, false), shell);
  mesh.name = name;
  mesh.position.set(0, startGap + length / 2, 0);
  parent.add(mesh);
  const band = new Mesh(new CylinderGeometry(radius * 1.08, radius * 1.08, Math.min(0.0032, length * 0.18), 20), metalMat);
  band.name = name + '_band';
  band.position.set(0, startGap + 0.0016, 0);
  parent.add(band);
  return mesh;
}

function buildHand(spec) {
const shell = material(spec.materials.shell);
const joint = material(spec.materials.joint);
const pad = material(spec.materials.pad);
const metal = material(spec.materials.metal);
const root = new Group();
root.name = 'axis_teaching_hands';
const fingers = ['thumb', 'index', 'middle', 'ring', 'little'];
const palmSize = spec.geometry.palmSize;
const wrist = new Vector3().fromArray(spec.wristAttachment);

for (const [side, sign] of [['left', -1], ['right', 1]]) {
  const palm = new Group();
  palm.name = `${side}_palm`;
  root.add(palm);
  const palmMesh = new Mesh(new RoundedBoxGeometry(palmSize[0], palmSize[1], palmSize[2], 3, Math.min(spec.geometry.palmBevel, palmSize[0] / 2 - 0.001)), shell);
  palmMesh.name = `${side}_palm_shell`;
  palm.add(palmMesh);
  const inner = spec.geometry.palmInnerSize;
  const innerMesh = new Mesh(new RoundedBoxGeometry(inner[0], inner[1], inner[2], 2, spec.geometry.palmInnerBevel), joint);
  innerMesh.name = `${side}_palm_inner`;
  innerMesh.position.set(-sign * spec.geometry.palmInnerOffset, 0, 0);
  palm.add(innerMesh);
  const neckLength = Math.max(0.008, wrist.z - palmSize[2] / 2 + 0.004);
  const neck = new Mesh(new CylinderGeometry(0.008, 0.0092, neckLength, 20), metal);
  neck.name = `${side}_wrist_neck`;
  neck.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 0, 1));
  neck.position.set(wrist.x * sign, wrist.y, palmSize[2] / 2 - 0.002 + neckLength / 2);
  palm.add(neck);
  const coupler = new Mesh(new SphereGeometry(spec.geometry.wristCouplerRadius, 24, 16), joint);
  coupler.name = `${side}_wrist_coupler`;
  coupler.position.set(wrist.x * sign, wrist.y, wrist.z);
  palm.add(coupler);
  const ring = new Mesh(new CylinderGeometry(spec.geometry.wristCouplerRadius * 1.05, spec.geometry.wristCouplerRadius * 1.05, 0.004, 24), metal);
  ring.name = `${side}_wrist_ring`;
  ring.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 0, 1));
  ring.position.copy(coupler.position);
  palm.add(ring);

  for (const finger of fingers) {
    const fingerSpec = spec.fingers[finger];
    const base = new Vector3(sign * fingerSpec.baseRight[0], fingerSpec.baseRight[1], fingerSpec.baseRight[2]);
    const mountStart = new Vector3(sign * Math.min(palmSize[0] / 2 - 0.002, Math.abs(base.x) * 0.25), base.y * 0.35, base.z * 0.25);
    const mountLength = Math.max(0.006, mountStart.distanceTo(base));
    const mount = new Mesh(new CylinderGeometry(spec.geometry.mcpMountRadius, spec.geometry.mcpMountRadius, mountLength, spec.geometry.mcpMountRadialSegments), metal);
    mount.name = `${side}_${finger}_mount`;
    mount.position.copy(mountStart).add(base).multiplyScalar(0.5);
    mount.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), base.clone().sub(mountStart).normalize());
    palm.add(mount);

    const mcp = new Group();
    mcp.name = `${side}_${finger}_mcp`;
    mcp.position.copy(base);
    palm.add(mcp);
    const pip = new Group();
    pip.name = `${side}_${finger}_pip`;
    pip.position.set(0, fingerSpec.lengths[0], 0);
    mcp.add(pip);
    const dip = new Group();
    dip.name = `${side}_${finger}_dip`;
    dip.position.set(0, fingerSpec.lengths[1], 0);
    pip.add(dip);
    const tip = new Group();
    tip.name = `${side}_${finger}_tip`;
    tip.position.set(0, fingerSpec.lengths[2], 0);
    dip.add(tip);
    const nodes = [mcp, pip, dip];
    nodes.forEach((node, index) => {
      const hinge = new Mesh(new SphereGeometry(fingerSpec.jointRadii[index], spec.geometry.uvSphereSegments, spec.geometry.uvSphereRings), joint);
      hinge.name = `${side}_${finger}_hinge_${index}`;
      node.add(hinge);
      const nextRadius = index === 2 ? fingerSpec.padRadius : fingerSpec.jointRadii[index + 1];
      linkMesh(node, `${side}_${finger}_link_${index}`, fingerSpec.lengths[index], fingerSpec.linkRadii[index], fingerSpec.jointRadii[index] * 0.72, nextRadius * 0.45, shell, metal, spec.geometry.fingerRadialSegments ?? 24);
    });
    const padMesh = new Mesh(new SphereGeometry(fingerSpec.padRadius, spec.geometry.uvSphereSegments, spec.geometry.uvSphereRings), pad);
    padMesh.name = `${side}_${finger}_pad`;
    tip.add(padMesh);
  }

  const shoulder = new Group();
  shoulder.name = `${side}_shoulder`;
  root.add(shoulder);
  const elbow = new Group();
  elbow.name = `${side}_elbow`;
  elbow.position.set(0, spec.armLengths[0], 0);
  shoulder.add(elbow);
  for (const [name, node, length] of [['upper', shoulder, spec.armLengths[0]], ['forearm', elbow, spec.armLengths[1]]]) {
    const bearing = new Mesh(new SphereGeometry(spec.geometry.armBearingRadius, 24, 16), joint);
    bearing.name = `${side}_${name}_bearing`;
    node.add(bearing);
    const housingLength = Math.max(0.02, length - spec.geometry.armEndInset * 2);
    const housing = new Mesh(new CylinderGeometry(spec.geometry.armShellRadius, spec.geometry.armShellRadius, housingLength, spec.geometry.armRadialSegments ?? 24), shell);
    housing.name = `${side}_${name}_housing`;
    housing.position.set(0, spec.geometry.armEndInset + housingLength / 2, 0);
    node.add(housing);
    const collar = new Mesh(new CylinderGeometry(spec.geometry.armShellRadius * 1.12, spec.geometry.armShellRadius * 1.12, 0.006, 24), metal);
    collar.name = `${side}_${name}_collar`;
    collar.position.set(0, spec.geometry.armEndInset + 0.004, 0);
    node.add(collar);
  }
}

root.traverse(node => {
  if (node.isMesh) {
    node.castShadow = true;
    node.receiveShadow = true;
  }
});
return root;
}

const exporter = new GLTFExporter();
async function writeHand(scene, path) {
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(glb));
  console.log(`wrote ${path} (${glb.byteLength} bytes)`);
}
await writeHand(buildHand(spec), out);

// Visual reconstruction for the comparison still. It is not loaded by the player.
const early = structuredClone(spec);
early.handModelId = 'early-white-reconstruction';
early.materials.shell.color = [0.94, 0.92, 0.86];
early.materials.joint.color = [0.015, 0.016, 0.02];
early.materials.pad.color = [0.02, 0.02, 0.022];
early.materials.metal.color = [0.7, 0.72, 0.76];
early.geometry.palmSize = [0.036, 0.098, 0.086];
early.geometry.palmBevel = 0.009;
early.geometry.wristCouplerRadius = 0.016;
early.geometry.armShellRadius = 0.013;
early.geometry.armBearingRadius = 0.016;
for (const finger of Object.values(early.fingers)) {
  finger.jointRadii = finger.jointRadii.map(value => value * 1.45);
  finger.linkRadii = finger.linkRadii.map(value => value * 0.78);
  finger.padRadius *= 1.2;
  finger.lengths = finger.lengths.map((value, index) => index === 2 ? value * 0.9 : value * 1.04);
}
await writeHand(buildHand(early), resolve(rootDir, 'artifacts/early-white-hand.glb'));
