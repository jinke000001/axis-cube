import { describe, expect, it } from "vitest";
import { SOLVED, applyAlgorithm, rotateFace } from "./cube";
import { proposeCaptureOrientation } from "./capture-orientation";
import { captureValidation } from "./capture-state";

// Colors transcribed independently from IMG_4858; this is a grid regression,
// not a claim that the screenshot establishes the physical cube's state.
const screenshot = "BFLUBDUULFRDBRBRLBBLDUULDFFLDRBFDUFDRRUULBFRBLFFRDLRDU";

describe("direction-only recovery", () => {
  it("finds the unique upper/lower correction without changing any face's colors", () => {
    expect(captureValidation(screenshot).valid).toBe(false);
    const proposal = proposeCaptureOrientation(screenshot);
    expect(proposal.status).toBe("unique");
    if (proposal.status !== "unique")
      throw new Error("Expected unique proposal");
    expect(proposal.rotations).toEqual({ U: 1, D: 3 });
    expect(captureValidation(proposal.colors).valid).toBe(true);
    for (let face = 0; face < 6; face++)
      expect([...proposal.colors.slice(face * 9, face * 9 + 9)].sort()).toEqual(
        [...screenshot.slice(face * 9, face * 9 + 9)].sort(),
      );
  });
  it("leaves an already valid grid alone, including symmetric solved faces", () => {
    expect(proposeCaptureOrientation(SOLVED)).toEqual({ status: "unchanged" });
    expect(proposeCaptureOrientation(applyAlgorithm(SOLVED, "R U F"))).toEqual({
      status: "unchanged",
    });
  });
  it("does not pick one of multiple valid direction combinations", () => {
    const ambiguous = rotateFace(applyAlgorithm(SOLVED, "R"), "U");
    expect(captureValidation(ambiguous).valid).toBe(false);
    expect(proposeCaptureOrientation(ambiguous)).toEqual({
      status: "ambiguous",
    });
  });
  it("does not disguise an impossible edge flip, wrong counts or incomplete data as direction repair", () => {
    const flipped = [...SOLVED];
    [flipped[5], flipped[10]] = [flipped[10], flipped[5]];
    expect(proposeCaptureOrientation(flipped.join(""))).toEqual({
      status: "none",
    });
    expect(proposeCaptureOrientation("R" + SOLVED.slice(1))).toEqual({
      status: "none",
    });
    expect(proposeCaptureOrientation("?" + SOLVED.slice(1))).toEqual({
      status: "incomplete",
    });
  });
});
