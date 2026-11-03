import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { dirname, resolve } from "node:path";
import type { OpenCV } from "../../src/core/opencv-loader";

/** Decoder for the repository's fixed 8-bit RGB/RGBA non-interlaced PNG fixtures. */
export function readFixturePng(path: string): ImageData {
  const bytes = readFileSync(path);
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Invalid fixture PNG");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20),
    color = bytes[25];
  if (bytes[24] !== 8 || ![2, 6].includes(color) || bytes[28] !== 0)
    throw new Error("Unsupported fixture PNG");
  const channels = color === 2 ? 3 : 4,
    stride = width * channels;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const n = bytes.readUInt32BE(offset),
      name = bytes.toString("ascii", offset + 4, offset + 8);
    if (name === "IDAT")
      chunks.push(bytes.subarray(offset + 8, offset + 8 + n));
    offset += n + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)),
    decoded = new Uint8Array(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x,
        a = x >= channels ? decoded[at - channels] : 0,
        b = y ? decoded[at - stride] : 0,
        c = y && x >= channels ? decoded[at - stride - channels] : 0;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
        filter
      ];
      if (prediction === undefined) throw new Error("Invalid fixture filter");
      decoded[at] = (packed[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++)
    data.set(
      [
        decoded[i * channels],
        decoded[i * channels + 1],
        decoded[i * channels + 2],
        channels === 4 ? decoded[i * channels + 3] : 255,
      ],
      i * 4,
    );
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

/** Same shipped bytes, executed with dynamic JS generation forbidden. */
export async function fixtureOpenCV(): Promise<void> {
  const path = resolve("public/vendor/opencv/opencv-4.13.0.js");
  const scope = globalThis as typeof globalThis & { cv?: OpenCV };
  const context = {
    module: { exports: {} as OpenCV & { then?: (ready: () => void) => void } },
    exports: {},
    require: createRequire(import.meta.url),
    __dirname: dirname(path),
    Buffer,
    console,
    process,
    setTimeout,
    clearTimeout,
    WebAssembly,
    TextDecoder,
    TextEncoder,
  };
  runInNewContext(readFileSync(path, "utf8"), context, {
    filename: path,
    contextCodeGeneration: { strings: false, wasm: true },
  });
  const cv = context.module.exports;
  await new Promise<void>((resolveReady) => cv.then!(() => resolveReady()));
  delete cv.then;
  scope.cv = cv;
}
