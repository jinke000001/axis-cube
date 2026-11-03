// Render the site's existing three-column AXIS mark for native launch assets.
// This uses only geometry and Node's PNG primitives; no external image service.
import { writeFile, readdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const paper = [243, 240, 233];
const blue = [53, 73, 216];
const shapes = [
  [[0, 12], [7, 8], [7, 28], [0, 32]],
  [[10, 4], [17, 0], [17, 28], [10, 32]],
  [[20, 4], [27, 0], [27, 20], [20, 24]],
];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const tag = Buffer.from(type);
  const input = Buffer.concat([tag, data]);
  let crc = 0xffffffff;
  for (const byte of input) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); tag.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function inside(x, y, polygon) {
  return polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0;
  });
}
function png(size, { background = blue, foreground = paper, scale = 0.56, transparent = false, round = false } = {}) {
  const channels = transparent || round ? 4 : 3;
  const rows = Buffer.alloc((size * channels + 1) * size);
  const factor = size * scale / 32;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let coverage = 0;
      for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
        const px = (x + dx - size / 2) / factor + 13.5;
        const py = (y + dy - size / 2) / factor + 16;
        if (shapes.some(shape => inside(px, py, shape))) coverage += 0.25;
      }
      const index = y * (size * channels + 1) + 1 + x * channels;
      for (let c = 0; c < 3; c++) rows[index + c] = transparent
        ? foreground[c]
        : Math.round(background[c] * (1 - coverage) + foreground[c] * coverage);
      if (channels === 4) rows[index + 3] = round && Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > size / 2
        ? 0 : transparent ? Math.round(255 * coverage) : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const icon = png(1024);
await writeFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', icon);
const splash = png(1024, { background: paper, foreground: blue, scale: 0.15 });
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await writeFile(join('ios/App/App/Assets.xcassets/Splash.imageset', name), splash);
}
for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  await writeFile(join(directory, 'ic_launcher.png'), png(size));
  await writeFile(join(directory, 'ic_launcher_round.png'), png(size, { round: true }));
  await writeFile(join(directory, 'ic_launcher_foreground.png'), png(size * 2.25, { transparent: true, scale: 0.5 }));
}
for (const entry of await readdir('android/app/src/main/res', { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('drawable')) {
    const files = await readdir(join('android/app/src/main/res', entry.name));
    if (files.includes('splash.png')) await writeFile(join('android/app/src/main/res', entry.name, 'splash.png'), splash);
  }
}
console.log('Generated AXIS app icons and launch images.');
