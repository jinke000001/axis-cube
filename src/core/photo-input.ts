/** Browser-local image decoding; no photo bytes or metadata leave this device. */
export interface PreparedPhoto {
  pixels: ImageData;
  thumbnail: string;
  fingerprint: string;
  originalWidth: number;
  originalHeight: number;
  decoder: "bitmap" | "image" | "camera";
}
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_EDGE = 2048;
const MAX_PIXELS = 60_000_000;
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("照片处理已取消。", "AbortError");
}
export function validatePhotoFile(file: File) {
  if (!file.size) throw new Error("照片是空文件，请重新选择。");
  if (file.size > MAX_BYTES)
    throw new Error("照片超过 32 MB，请选择普通照片。");
  if (
    !/^image\/(jpeg|png|webp|heic|heif|avif|bmp|tiff)$/i.test(file.type) &&
    !(
      file.type === "" &&
      /\.(jpe?g|png|webp|heic|heif|avif|bmp|tiff)$/i.test(file.name)
    )
  )
    throw new Error("请选择 JPEG、HEIC、PNG 或其他受支持的照片。");
}
function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
    colorSpace: "srgb",
  });
  if (!ctx) throw new Error("浏览器暂时无法读取照片像素，请重新打开录入。");
  return ctx;
}
export function prepareImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  decoder: PreparedPhoto["decoder"] = "camera",
): PreparedPhoto {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    Math.min(width, height) < 90
  )
    throw new Error("照片尺寸太小，无法可靠识别九格。");
  if (width * height > MAX_PIXELS)
    throw new Error("照片分辨率过大，请使用普通相机照片。");
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = context(canvas);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let hash = 2166136261,
    second = 5381;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const color =
      (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
    hash = Math.imul(hash ^ color, 16777619);
    second = Math.imul(second, 33) ^ color;
  }
  const thumbnail = document.createElement("canvas");
  const thumbScale = Math.min(1, 360 / Math.max(canvas.width, canvas.height));
  thumbnail.width = Math.round(canvas.width * thumbScale);
  thumbnail.height = Math.round(canvas.height * thumbScale);
  context(thumbnail).drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  const url = thumbnail.toDataURL("image/jpeg", 0.8);
  canvas.width = canvas.height = thumbnail.width = thumbnail.height = 1;
  return {
    pixels,
    thumbnail: url,
    fingerprint: `${pixels.width}x${pixels.height}:${(hash >>> 0).toString(16)}:${(second >>> 0).toString(16)}`,
    originalWidth: width,
    originalHeight: height,
    decoder,
  };
}
function decodeElement(
  file: File,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const finish = (error?: Error) => {
      image.onload = image.onerror = null;
      signal?.removeEventListener("abort", abort);
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(image);
    };
    const abort = () => {
      image.src = "";
      finish(new DOMException("照片处理已取消。", "AbortError"));
    };
    image.onload = () => finish();
    image.onerror = () =>
      finish(
        new Error(
          "无法解码这张照片。请用 Safari 可读取的原始照片，或导出为 JPEG 后重试。",
        ),
      );
    signal?.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}
export async function decodePhoto(
  file: File,
  signal?: AbortSignal,
): Promise<PreparedPhoto> {
  validatePhotoFile(file);
  checkSignal(signal);
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
        colorSpaceConversion: "default",
      });
      checkSignal(signal);
      return prepareImage(bitmap, bitmap.width, bitmap.height, "bitmap");
    } catch (error) {
      checkSignal(signal);
      // Safari's native image element is an independent decoder path (including HEIC).
      if (error instanceof Error && !(error instanceof DOMException) && bitmap)
        throw error;
    } finally {
      bitmap?.close();
    }
  }
  const image = await decodeElement(file, signal);
  try {
    checkSignal(signal);
    return prepareImage(
      image,
      image.naturalWidth,
      image.naturalHeight,
      "image",
    );
  } finally {
    image.src = "";
  }
}
