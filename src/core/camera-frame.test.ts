import { describe, expect, it } from "vitest";
import { cameraFrameIsReady, cameraGuideInsets } from "./camera-frame";

function scene() {
  const track = { readyState: "live", enabled: true, muted: false };
  const stream = { active: true, getVideoTracks: () => [track] };
  const video = {
    videoWidth: 1920,
    videoHeight: 1440,
    readyState: 4,
    paused: false,
    ended: false,
    error: null,
    srcObject: stream,
  };
  return {
    track,
    stream,
    video,
    ready: (visible = true) =>
      cameraFrameIsReady(
        video as unknown as HTMLVideoElement,
        stream as unknown as MediaStream,
        visible,
      ),
  };
}

describe("camera frame guards (simulated media state, not native device evidence)", () => {
  it("requires a live, enabled and unmuted video track in the attached active stream", () => {
    const test = scene();
    expect(test.ready()).toBe(true);
    test.track.muted = true;
    expect(test.ready()).toBe(false);
    test.track.muted = false;
    test.track.enabled = false;
    expect(test.ready()).toBe(false);
    test.track.enabled = true;
    test.track.readyState = "ended";
    expect(test.ready()).toBe(false);
    test.track.readyState = "live";
    test.stream.active = false;
    expect(test.ready()).toBe(false);
  });
  it("does not treat metadata, an old paused frame, a hidden page or zero dimensions as a current camera frame", () => {
    const test = scene();
    expect(test.ready(false)).toBe(false);
    test.video.readyState = 1;
    expect(test.ready()).toBe(false);
    test.video.readyState = 4;
    test.video.paused = true;
    expect(test.ready()).toBe(false);
    test.video.paused = false;
    test.video.videoHeight = 0;
    expect(test.ready()).toBe(false);
    test.video.videoHeight = 1440;
    test.video.videoWidth = 0;
    expect(test.ready()).toBe(false);
    test.video.videoWidth = 1920;
    test.video.ended = true;
    expect(test.ready()).toBe(false);
  });
  it("rejects a frame from a stream that has been replaced", () => {
    const test = scene();
    test.video.srcObject = { ...test.stream };
    expect(test.ready()).toBe(false);
  });
  it.each([
    [1920, 1440],
    [1440, 1920],
    [1080, 1920],
    [1920, 1080],
  ])(
    "keeps the guide square for %i × %i without clipping the video",
    (width, height) => {
      const [top, left] = cameraGuideInsets(width, height)
        .split(" ")
        .map(parseFloat);
      const guideWidth = width * (1 - (2 * left) / 100),
        guideHeight = height * (1 - (2 * top) / 100);
      expect(guideWidth).toBeCloseTo(guideHeight, 8);
      expect(guideWidth).toBeCloseTo(Math.min(width, height) * 0.7, 8);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left).toBeGreaterThanOrEqual(0);
    },
  );
});
