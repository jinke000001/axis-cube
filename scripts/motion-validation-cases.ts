import type { MotionOptions } from "../src/scene/motion";
export interface MotionCase {
  notation: string;
  options: MotionOptions;
  label: string;
}
export function motionValidationCases(): MotionCase[] {
  if (process.argv.includes("--transitions")) {
    return (["left", "right"] as const).flatMap((side) =>
      (side === "left" ? ["D", "F"] : ["U", "F", "D", "B"]).flatMap((face) =>
        [
          "",
          side === "left" ? "L " : "R ",
          side === "left" ? "L' " : "R' ",
        ].map((prefix) => ({
          notation: prefix + face,
          options: { reorientHands: [side] },
          label: `${side}: ${prefix + face}`,
        })),
      ),
    );
  }
  const flag = process.argv.indexOf("--algorithm");
  const algorithm = flag < 0 ? undefined : process.argv[flag + 1];
  const forced = process.argv.includes("--left")
    ? "left"
    : process.argv.includes("--right")
      ? "right"
      : undefined;
  const options: MotionOptions = forced ? { reorientHands: [forced] } : {};
  const faces = process.argv.includes("--known-cases")
    ? ["U", "B"]
    : ["U", "R", "F", "D", "L", "B"];
  const notations = algorithm
    ? [algorithm]
    : faces
        .filter((f) => !process.argv.includes("--back-only") || f === "B")
        .filter((f) => forced !== "left" || !["U", "B"].includes(f))
        .flatMap((f) => [f, f + "2", f + "'"]);
  return notations.map((notation) => ({
    notation,
    options,
    label: forced ? `${forced}: ${notation}` : notation,
  }));
}
