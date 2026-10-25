// Synthetic image fixtures exercise the browser import path; they are not real camera evidence.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
  applyAlgorithm,
  COLORS,
  DEFAULT_PALETTE,
  FACES,
  SOLVED,
  type Face,
} from "../src/core/cube";
const dir = "tests/fixtures";
mkdirSync(dir, { recursive: true });
const scramble = "R U2 F' L D B2 R' F2 U L2 D' B R2 U' F";
const state = applyAlgorithm(SOLVED, scramble);
const crc = (b: Buffer) => {
  let value = 0xffffffff;
  for (const byte of b) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (name: string, data: Buffer) => {
  const type = Buffer.from(name),
    length = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, sum]);
};
for (const [index, face] of (
  ["F", "R", "B", "L", "U", "D"] as Face[]
).entries()) {
  const raw = Buffer.alloc(600 * (600 * 3 + 1));
  for (let y = 0; y < 600; y++)
    for (let x = 0; x < 600; x++) {
      let rgb = [26, 31, 32];
      const row = Math.floor((y - 75) / 150),
        col = Math.floor((x - 75) / 150);
      if (row >= 0 && row < 3 && col >= 0 && col < 3) {
        const rx = (x - 75) % 150,
          ry = (y - 75) % 150;
        if (rx > 6 && rx < 144 && ry > 6 && ry < 144) {
          const hex =
            COLORS[
              state[FACES.indexOf(face) * 9 + row * 3 + col] as Face
            ].slice(1);
          const light = 0.9 + (0.1 * x) / 600;
          rgb = [0, 2, 4].map((i) =>
            Math.round(parseInt(hex.slice(i, i + 2), 16) * light),
          );
        }
      }
      const start = y * (600 * 3 + 1) + 1 + x * 3;
      rgb.forEach((v, i) => (raw[start + i] = v));
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(600, 0);
  header.writeUInt32BE(600, 4);
  header[8] = 8;
  header[9] = 2;
  writeFileSync(
    `${dir}/${index + 1}-${face}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
writeFileSync(
  `${dir}/expected-state.json`,
  JSON.stringify(
    { facelets: state, palette: DEFAULT_PALETTE, scramble },
    null,
    2,
  ),
);
writeFileSync(
  `${dir}/invalid-session.json`,
  JSON.stringify({
    version: 1,
    facelets: state,
    palette: DEFAULT_PALETTE,
    solution: "R",
    name: "invalid fixture",
  }),
);
console.log(
  "Created six synthetic photos plus expected state and invalid-session fixtures.",
);
