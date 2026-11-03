import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { STATION_POSITIONS, stationForRoute, viewportProjection } from "./layout";

describe("museum station and shared viewport framing", () => {
  it("uses stable station coordinates for deep links and old workbench links", () => {
    expect(["/", "/learn", "/learn/f2l-pairs", "/library/cfop/oll-21", "/solve", "/studio/finger-test"].map(stationForRoute))
      .toEqual(["entry", "learn", "learn", "library", "solve", "solve"]);
    expect(STATION_POSITIONS.learn).toEqual([3.4, 0, 0]);
    expect(STATION_POSITIONS.library).toEqual([0, 0, -3.4]);
  });
  it.each([
    { viewport: [1440, 900], rect: { left: 700, top: 150, width: 560, height: 420 } },
    { viewport: [390, 844], rect: { left: 20, top: 300, width: 350, height: 285 } },
    { viewport: [390, 844], rect: { left: 20, top: -80, width: 350, height: 285 } },
  ])("projects an exhibit to its DOM slot with identical local scale: $viewport", ({ viewport: [width, height], rect }) => {
    const local = new PerspectiveCamera(35, rect.width / rect.height, .001, 40);
    const shared = new PerspectiveCamera(35, width / height, .001, 40);
    local.position.set(.16, .5, .25); local.lookAt(0, .35, 0);
    shared.position.copy(local.position).add(new Vector3(...STATION_POSITIONS.learn)); shared.quaternion.copy(local.quaternion);
    const projection = viewportProjection(local.fov, height, rect, width);
    shared.fov = projection.fov; shared.setViewOffset(width, height, projection.offsetX, projection.offsetY, width, height);
    shared.updateProjectionMatrix(); local.updateMatrixWorld(); shared.updateMatrixWorld();
    for (const point of [new Vector3(0, .35, 0), new Vector3(.028, .378, .028), new Vector3(-.028, .322, -.028)]) {
      const localNdc = point.clone().project(local), worldNdc = point.clone().add(new Vector3(...STATION_POSITIONS.learn)).project(shared);
      expect((worldNdc.x + 1) / 2 * width).toBeCloseTo(rect.left + (localNdc.x + 1) / 2 * rect.width, 8);
      expect((1 - worldNdc.y) / 2 * height).toBeCloseTo(rect.top + (1 - localNdc.y) / 2 * rect.height, 8);
    }
  });
});
