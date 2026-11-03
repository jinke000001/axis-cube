/** A loaded video element can still hold a frame after its camera has stopped. */
export function cameraFrameIsReady(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
  visible = true,
): boolean {
  return !!(
    visible &&
    video &&
    stream &&
    stream.active &&
    video.srcObject === stream &&
    Number.isFinite(video.videoWidth) &&
    Number.isFinite(video.videoHeight) &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    video.readyState >= 2 &&
    !video.paused &&
    !video.ended &&
    !video.error &&
    stream
      .getVideoTracks()
      .some(
        (track) => track.readyState === "live" && track.enabled && !track.muted,
      )
  );
}

/** Guide only: the recognition pipeline still receives the entire video frame. */
export function cameraGuideInsets(width: number, height: number): string {
  const side = 0.7 * Math.min(width, height);
  return `${((height - side) / height) * 50}% ${((width - side) / width) * 50}%`;
}
