import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import { type MotionFrame } from "./motion";
import type { PlaybackProgram, PlaybackStep } from "./playback";

/** Optional wrist paths sampled from the exact motion used by the hands. */
export class MotionTrace {
  root = new Group();
  enabled = false;
  private step: PlaybackStep | undefined;
  private traces = (["left", "right"] as const).map((side, index) => {
    const color = index === 0 ? "#e2c38d" : "#8ccfdf";
    const line = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
        depthWrite: false,
      }),
    );
    const marker = new Mesh(
      new SphereGeometry(0.004, 12, 8),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    line.name = `${side}-wrist-path`;
    marker.name = `${side}-wrist-position`;
    line.renderOrder = 10;
    marker.renderOrder = 11;
    this.root.add(line, marker);
    return { side, line, marker };
  });

  constructor() {
    this.root.visible = false;
  }

  update(program: PlaybackProgram, frame: MotionFrame) {
    const steps = program.steps;
    const step = steps[Math.min(frame.index, steps.length - 1)];
    this.root.visible = this.enabled && !!step;
    if (!this.root.visible) return;
    if (step !== this.step) {
      this.step = step;
      const samples = Array.from({ length: 97 }, (_, i) =>
        program.sample(step.start + (step.duration * i) / 96),
      );
      for (const trace of this.traces) {
        trace.line.geometry.dispose();
        trace.line.geometry = new BufferGeometry().setFromPoints(
          samples.map((sample) => sample[trace.side].position),
        );
      }
    }
    for (const trace of this.traces)
      trace.marker.position.copy(frame[trace.side].position);
  }

  dispose() {
    this.root.removeFromParent();
    for (const { line, marker } of this.traces) {
      line.geometry.dispose();
      line.material.dispose();
      marker.geometry.dispose();
      marker.material.dispose();
    }
  }
}
