import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { VisionClient } from '../../core/vision-client';
import { shareSessionFile } from '../share';

type Check = { status: 'passed' | 'failed' | 'not-tested'; details: unknown };
const resultKey = 'axis.mobile.probe.result';
const markerKey = 'axis.mobile.probe.marker';
const report = {
  schema: 1,
  startedAt: new Date().toISOString(),
  platform: Capacitor.getPlatform(),
  native: Capacitor.isNativePlatform(),
  location: location.href,
  origin: location.origin,
  userAgent: navigator.userAgent,
  secureContext: globalThis.isSecureContext,
  checks: {} as Record<string, Check>,
  lifecycle: [] as { active: boolean; at: string }[],
  completed: false,
};
let saveQueue = Promise.resolve();
function persist() {
  const value = JSON.stringify(report, null, 2);
  document.querySelector('#report')!.textContent = value;
  saveQueue = saveQueue.then(() => Preferences.set({ key: resultKey, value }));
  return saveQueue;
}
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try {
    report.checks[name] = { status: 'passed', details: await run() };
  } catch (error) {
    report.checks[name] = { status: 'failed', details: String(error) };
  }
  await persist();
}
await App.addListener('appStateChange', ({ isActive }) => {
  report.lifecycle.push({ active: isActive, at: new Date().toISOString() });
  void persist();
});

async function run() {
  report.completed = false;
  await check('webgl2', () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL2 context unavailable');
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (pixel[0] !== 255 || pixel[1] !== 0) throw new Error('WebGL readback mismatch');
    const details = { version: gl.getParameter(gl.VERSION), pixel: [...pixel] };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return details;
  });
  await check('wasm', async () => {
    const module = await WebAssembly.instantiate(new Uint8Array([
      0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11,
    ]));
    const answer = (module.instance.exports.answer as () => number)();
    if (answer !== 42) throw new Error('WASM result mismatch');
    return { answer };
  });
  await check('visionWorkerAndOpenCV', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 360;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, 360, 360);
    const colors = ['#ed4437','#eeeeee','#1878d4','#30b765','#eac72d','#ee7f24','#30b765','#ed4437','#eeeeee'];
    colors.forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.fillRect(30 + (index % 3) * 100, 30 + Math.floor(index / 3) * 100, 90, 90);
    });
    const client = new VisionClient();
    try {
      const result = await client.analyze(ctx.getImageData(0, 0, 360, 360));
      if (!result.quad || result.cells.length !== 9) throw new Error(`Grid result: ${JSON.stringify(result)}`);
      return { cells: result.cells.length, method: result.method, confidence: result.confidence };
    } finally { client.dispose(); }
  });
  await check('localStorage', () => {
    const previous = localStorage.getItem(markerKey);
    localStorage.setItem(markerKey, report.startedAt);
    if (localStorage.getItem(markerKey) !== report.startedAt) throw new Error('Storage readback mismatch');
    return { readback: true, previous };
  });
  await check('indexedDB', () => new Promise((resolve, reject) => {
    const request = indexedDB.open('axis-mobile-probe', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('checks');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('checks', 'readwrite');
      const store = transaction.objectStore('checks');
      const previous = store.get('marker');
      store.put(report.startedAt, 'marker');
      const read = store.get('marker');
      transaction.oncomplete = () => {
        db.close();
        if (read.result !== report.startedAt) reject(new Error('IndexedDB readback mismatch'));
        else resolve({ readback: true, previous: previous.result ?? null });
      };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
  await check('nativePreferences', async () => {
    const previous = (await Preferences.get({ key: markerKey })).value;
    await Preferences.set({ key: markerKey, value: report.startedAt });
    const readback = (await Preferences.get({ key: markerKey })).value;
    if (readback !== report.startedAt) throw new Error('Native Preferences mismatch');
    return { readback: true, previous };
  });
  await check('nativeCacheFile', async () => {
    const path = 'axis-runtime-probe/readback.json';
    const value = JSON.stringify({ marker: report.startedAt });
    await Filesystem.writeFile({ directory: Directory.Cache, path, data: value, encoding: Encoding.UTF8, recursive: true });
    try {
      const result = await Filesystem.readFile({ directory: Directory.Cache, path, encoding: Encoding.UTF8 });
      if (result.data !== value) throw new Error('Native cache readback mismatch');
      return { readback: true, temporaryFileRemoved: true };
    } finally { await Filesystem.deleteFile({ directory: Directory.Cache, path }); }
  });
  report.checks.camera = {
    status: 'not-tested',
    details: { getUserMediaExposed: typeof navigator.mediaDevices?.getUserMedia === 'function', reason: 'Requires explicit interaction; simulator cannot prove a real camera.' },
  };
  report.completed = true;
  await persist();
}
document.querySelector('#rerun')!.addEventListener('click', () => { void run(); });
document.querySelector('#camera')!.addEventListener('click', () => {
  void check('camera', async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const settings = stream.getVideoTracks().map(track => track.getSettings());
    stream.getTracks().forEach(track => track.stop());
    return { settings, note: 'Synthetic simulator input is not physical camera evidence.' };
  });
});
document.querySelector('#share')!.addEventListener('click', () => {
  void check('systemShare', async () => ({ result: await shareSessionFile('AXIS-原生验证.json', JSON.stringify({ axisCapabilityProbe: true, createdAt: report.startedAt }, null, 2)) }));
});
for (const selector of ['#file', '#photo']) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  input.addEventListener('cancel', () => {
    report.checks[selector.slice(1) + 'PickerCancel'] = { status: 'passed', details: 'System picker cancelled without a selection.' };
    void persist();
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void check(selector.slice(1) + 'PickerReadback', async () => {
      if (selector === '#file') {
        const value = JSON.parse(await file.text());
        if (value.axisCapabilityProbe !== true) throw new Error('Selected file did not contain the exported probe marker.');
        return { fileName: file.name, bytes: file.size, expectedProbeMarker: true };
      }
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        return { fileName: file.name, bytes: file.size, width: image.naturalWidth, height: image.naturalHeight };
      } finally { URL.revokeObjectURL(url); }
    });
  });
}
await run();
