import { describe, expect, it } from "vitest";
import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { DEFAULT_PALETTE, parseAlgorithm, snapshots, SOLVED } from "../core/cube";
import { CubeModel } from "./cube-model";
import { compileFingerSolve } from "./finger-solve-program";
import { retimeFingerProgram } from "./finger-cadence";
import { hasMeasuredSupport, measureContact } from "./finger-contact";

const algorithm = "R U2' R' F B' D2 x U x' M Rw U Rw'";

describe("finger cadence", () => {
  it("keeps 54 visible stickers continuous when retimed moves commit, including x and expanded M/wide turns", () => {
    const original = compileFingerSolve(parseAlgorithm(algorithm), 3.2);
    const before = original.steps.map(({ start, duration }) => ({ start, duration }));
    const program = retimeFingerProgram(original);
    expect(program.duration).toBe(3.2);
    expect(program.cost).toBe(original.cost);
    expect(original.steps.map(({ start, duration }) => ({ start, duration }))).toEqual(before);
    expect(program.steps.map((step) => step.move)).toEqual(original.steps.map((step) => step.move));
    const states = snapshots(SOLVED, program.steps.map((step) => step.move)), cube = new CubeModel();
    const visual = (time: number) => {
      const frame = program.sample(time);
      cube.update(states[frame.index], DEFAULT_PALETTE, frame.orientation, program.steps[frame.index]?.move, frame.angle);
      cube.root.updateMatrixWorld(true);
      const stickers: string[] = [];
      cube.root.traverse((node) => {
        if (node instanceof Mesh && node.name.startsWith("sticker-"))
          stickers.push(node.getWorldPosition(new Vector3()).toArray().map((x) => Math.round(x * 1e5)).join(",")
            + ":" + (node.material as MeshStandardMaterial).color.getHexString());
      });
      return stickers.sort();
    };
    for (let i = 0; i < program.steps.length; i++) {
      const end = program.steps[i + 1]?.start ?? program.duration;
      expect(program.sample(end - 1e-9).index).toBe(i);
      expect(program.sample(end).index).toBe(i + 1);
      expect(visual(end), `${i} ${program.steps[i].move.notation}`).toEqual(visual(end - 1e-9));
    }
    expect(program.sample(program.duration)).toEqual(original.sample(original.duration));
    cube.dispose();
  });

  it("retains measured support and source metadata throughout contacts and reverse scrubbing", () => {
    const source = compileFingerSolve(parseAlgorithm(algorithm));
    const program = retimeFingerProgram(source);
    for (const segment of program.segments) {
      const mid = program.sample(segment.start + segment.duration / 2);
      expect(mid.index).toBe(segment.index);
      expect(mid.phase).toBe(segment.phase);
      expect(mid.stage).toBe(segment.stage);
      expect(mid.active).toBe(segment.active);
      if (segment.finger !== undefined) expect(mid.activeFinger).toBe(segment.finger);
      for (let i = 0; i < 8; i++) {
        const frame = program.sample(segment.start + segment.duration * i / 8);
        const move = frame.stage === "TURN" ? program.steps[frame.index]?.move : undefined;
        expect(hasMeasuredSupport(frame, frame.contacts!, move, frame.angle, frame.orientation), segment.phase).toBe(true);
        for (const contact of frame.contacts!)
          expect(measureContact(frame[contact.side], contact, move, frame.angle, frame.orientation).valid,
            `${segment.phase}: ${contact.side}/${contact.finger}`).toBe(true);
      }
    }
    const times = Array.from({ length: 151 }, (_, i) => program.duration * i / 150);
    const forward = times.map((time) => program.sample(time));
    for (let i = times.length - 1; i >= 0; i--) expect(program.sample(times[i])).toEqual(forward[i]);
    // Orientation belongs to the source frame, even when a future compiler
    // supplies a non-identity object pose; the adapter must not invent one.
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
    const oriented = retimeFingerProgram({ ...source, sample: (time) => ({ ...source.sample(time), orientation }) });
    expect(oriented.sample(0.4).orientation).toBe(orientation);
  }, 30000);

  it("gives every TURN at least two visible 60 Hz samples across frame phases and refuses an impossible budget", () => {
    const source = compileFingerSolve(parseAlgorithm("R U2 R' U' L' U2' L U F2 B2 D2"));
    const program = retimeFingerProgram(source);
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      for (const segment of program.segments.filter((segment) => segment.stage === "TURN")) {
        const visible: number[] = [];
        for (let i = 0; (i + phase) / 60 < program.duration; i++) {
          const time = (i + phase) / 60;
          if (time <= segment.start || time >= segment.start + segment.duration) continue;
          const frame = program.sample(time);
          if (frame.stage === "TURN" && frame.progress > 1e-8 && frame.progress < 1 - 1e-8) visible.push(time);
        }
        expect(visible.length, `${phase}: ${segment.phase}`).toBeGreaterThanOrEqual(2);
      }
    }
    const impossible = compileFingerSolve(parseAlgorithm("R U R' U'"), 0.02);
    expect(() => retimeFingerProgram(impossible)).toThrow("最低显示时间");
    const empty = compileFingerSolve([]);
    expect(retimeFingerProgram(empty)).toBe(empty);
  });
});
