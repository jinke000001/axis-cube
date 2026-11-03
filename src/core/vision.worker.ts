import { analyzeFace } from "./vision-image";
import type { Quad } from "./vision";

self.onmessage = async (
  event: MessageEvent<{
    id: number;
    width: number;
    height: number;
    data: Uint8ClampedArray;
    quad?: Quad;
  }>,
) => {
  const { id, width, height, data, quad } = event.data;
  try {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > 2048 * 2048 ||
      data.length !== width * height * 4
    )
      throw new Error("照片像素不完整，请重新选择。");
    const image = { width, height, data, colorSpace: "srgb" } as ImageData;
    const result = await analyzeFace(image, quad);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "没有识别到完整魔方面。",
    });
  }
};
