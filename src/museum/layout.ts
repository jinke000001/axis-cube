export type MuseumStation = "entry" | "learn" | "library" | "solve";
export const STATION_POSITIONS: Record<MuseumStation, readonly [number, number, number]> = {
  entry: [0, 0, 0], learn: [3.4, 0, 0], library: [0, 0, -3.4], solve: [-3.4, 0, 0],
};
export function stationForRoute(route: string): MuseumStation {
  const section = route.replace(/^#/, "").split("/").filter(Boolean)[0];
  return section === "learn" ? "learn" : section === "library" ? "library"
    : section === "solve" || section === "studio" ? "solve" : "entry";
}
/** Preserve a local camera's framing when its viewport is a region of the shared canvas. */
export function viewportProjection(localFov: number, viewportHeight: number, rect: { left: number; top: number; width: number; height: number }, viewportWidth: number) {
  const height = Math.max(1, rect.height);
  return {
    fov: 2 * Math.atan(Math.tan(localFov * Math.PI / 360) * viewportHeight / height) * 180 / Math.PI,
    offsetX: viewportWidth / 2 - (rect.left + rect.width / 2),
    offsetY: viewportHeight / 2 - (rect.top + rect.height / 2),
  };
}
