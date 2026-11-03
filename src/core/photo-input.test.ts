import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePhoto, prepareImage, validatePhotoFile } from './photo-input';

// These are browser-contract tests with simulated decoders/canvases. They do not
// establish HEIC support, EXIF correctness, or memory behavior on an iPhone.
let imageOutcome: 'load' | 'error' | 'pending';
let imageWidth: number, imageHeight: number;
let contextAvailable: boolean;
let canvases: SimulatedCanvas[];
let images: SimulatedImage[];

class SimulatedCanvas {
  width = 300;
  height = 150;
  context = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4),
    } as ImageData)),
  };
  getContext = vi.fn(() => contextAvailable ? this.context : null);
  toDataURL = vi.fn(() => 'data:image/jpeg;base64,simulated');
}

class SimulatedImage {
  naturalWidth = imageWidth;
  naturalHeight = imageHeight;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private currentSrc = '';
  constructor() { images.push(this); }
  get src() { return this.currentSrc; }
  set src(value: string) {
    this.currentSrc = value;
    if (!value || imageOutcome === 'pending') return;
    const outcome = imageOutcome;
    queueMicrotask(() => outcome === 'load' ? this.onload?.() : this.onerror?.());
  }
}

const photo = (name = 'cube.jpg', type = 'image/jpeg') => new File(['simulated photo bytes'], name, { type });
function bitmap(width = 120, height = 90) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

beforeEach(() => {
  imageOutcome = 'load'; imageWidth = 120; imageHeight = 90;
  contextAvailable = true; canvases = []; images = [];
  vi.stubGlobal('document', { createElement: vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
    const canvas = new SimulatedCanvas(); canvases.push(canvas); return canvas;
  }) });
  vi.stubGlobal('Image', SimulatedImage);
  vi.stubGlobal('createImageBitmap', undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:simulated-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('photo decoding (simulated browser contracts)', () => {
  it('uses the bitmap decoder with orientation/color options and releases the bitmap and both canvases', async () => {
    const decoded = bitmap(), create = vi.fn().mockResolvedValue(decoded), input = photo();
    vi.stubGlobal('createImageBitmap', create);
    const result = await decodePhoto(input);
    expect(create).toHaveBeenCalledWith(input, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
    expect(result.decoder).toBe('bitmap');
    expect([result.pixels.width, result.pixels.height]).toEqual([120, 90]);
    expect(result.thumbnail).toBe('data:image/jpeg;base64,simulated');
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(images).toHaveLength(0);
    expect(canvases).toHaveLength(2);
    expect(canvases.every(canvas => canvas.width === 1 && canvas.height === 1)).toBe(true);
    expect(canvases[0].getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  });

  it('falls back to Image after the bitmap decoder rejects, then revokes its URL and clears its source', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('Unsupported input', 'NotSupportedError')));
    const input = photo('cube.heic', 'image/heic');
    const result = await decodePhoto(input);
    expect(result.decoder).toBe('image');
    expect([result.originalWidth, result.originalHeight]).toEqual([120, 90]);
    expect(URL.createObjectURL).toHaveBeenCalledWith(input);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:simulated-photo');
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('');
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
  });

  it('uses Image when createImageBitmap is unavailable', async () => {
    const result = await decodePhoto(photo());
    expect(result.decoder).toBe('image');
    expect(images).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('reports Image decoding failure and releases the object URL and event handlers', async () => {
    imageOutcome = 'error';
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(decodePhoto(photo(), controller.signal)).rejects.toThrow('无法解码这张照片');
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:simulated-photo');
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(canvases).toHaveLength(0);
  });

  it('does not start a decoder for an already aborted request', async () => {
    const create = vi.fn(), controller = new AbortController();
    vi.stubGlobal('createImageBitmap', create); controller.abort();
    await expect(decodePhoto(photo(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
    expect(images).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('discards and closes a bitmap that resolves after cancellation without starting fallback decoding', async () => {
    let resolve!: (value: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>(done => { resolve = done; })));
    const controller = new AbortController(), decoded = bitmap();
    const failed = expect(decodePhoto(photo(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); resolve(decoded); await failed;
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(images).toHaveLength(0);
    expect(canvases).toHaveLength(0);
  });

  it('does not fall back after a cancelled bitmap request later rejects', async () => {
    let reject!: (reason: Error) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>((_resolve, fail) => { reject = fail; })));
    const controller = new AbortController();
    const failed = expect(decodePhoto(photo(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); reject(new Error('decoder failed late')); await failed;
    expect(images).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('cancels a pending Image decode and removes its source, object URL and listeners', async () => {
    imageOutcome = 'pending';
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const failed = expect(decodePhoto(photo(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(images[0].src).toBe('blob:simulated-photo');
    controller.abort(); await failed;
    expect(images[0].src).toBe('');
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:simulated-photo');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(canvases).toHaveLength(0);
  });

  it('rejects cancellation between Image onload and pixel extraction', async () => {
    imageOutcome = 'pending';
    const controller = new AbortController();
    const failed = expect(decodePhoto(photo(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    images[0].onload!(); controller.abort(); await failed;
    expect(images[0].src).toBe('');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(0);
  });

  it('closes a decoded bitmap if its dimensions are rejected, without retrying the same invalid input', async () => {
    const decoded = bitmap(89, 90);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(decoded));
    await expect(decodePhoto(photo())).rejects.toThrow('照片尺寸太小');
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(images).toHaveLength(0);
    expect(canvases).toHaveLength(0);
  });

  it('clears the Image source even when canvas access fails after decoding', async () => {
    contextAvailable = false;
    await expect(decodePhoto(photo())).rejects.toThrow('无法读取照片像素');
    expect(images[0].src).toBe('');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});

describe('photo input limits (no native image decoding)', () => {
  it.each([
    { name: 'empty file', input: new File([], 'empty.jpg', { type: 'image/jpeg' }), message: '空文件' },
    { name: 'non-image MIME', input: photo('cube.jpg', 'text/plain'), message: '请选择' },
    { name: 'unknown extension without MIME', input: photo('cube.bin', ''), message: '请选择' },
  ])('rejects $name before allocating decoder resources', async ({ input, message }) => {
    await expect(decodePhoto(input)).rejects.toThrow(message);
    expect(images).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
  });

  it('rejects files over 32 MiB before decoding and accepts the boundary size', () => {
    const input = photo();
    Object.defineProperty(input, 'size', { value: 32 * 1024 * 1024, configurable: true });
    expect(() => validatePhotoFile(input)).not.toThrow();
    Object.defineProperty(input, 'size', { value: 32 * 1024 * 1024 + 1 });
    expect(() => validatePhotoFile(input)).toThrow('超过 32 MB');
    expect(images).toHaveLength(0);
  });

  it('accepts an allowed extension when the picker omits MIME without claiming codec support', () => {
    expect(() => validatePhotoFile(photo('cube.HEIC', ''))).not.toThrow();
    expect(() => validatePhotoFile(photo('cube.jpeg', ''))).not.toThrow();
  });

  it.each([[89, 90], [90, 89], [NaN, 120], [120, Infinity]])('rejects unusable dimensions %s × %s before creating a canvas', (width, height) => {
    expect(() => prepareImage({} as CanvasImageSource, width, height)).toThrow('尺寸太小');
    expect(canvases).toHaveLength(0);
  });

  it('rejects a decoded image over 60 million pixels before canvas allocation', () => {
    expect(() => prepareImage({} as CanvasImageSource, 10_000, 6_001)).toThrow('分辨率过大');
    expect(canvases).toHaveLength(0);
  });

  it('caps pixel extraction at 2048 pixels on the long edge and preserves the original dimensions', () => {
    const result = prepareImage({} as CanvasImageSource, 4032, 3024);
    expect([result.pixels.width, result.pixels.height]).toEqual([2048, 1536]);
    expect([result.originalWidth, result.originalHeight]).toEqual([4032, 3024]);
    expect(canvases[0].context.getImageData).toHaveBeenCalledWith(0, 0, 2048, 1536);
    expect(canvases[1].context.drawImage).toHaveBeenCalledWith(canvases[0], 0, 0, 360, 270);
    expect(canvases.every(canvas => canvas.width === 1 && canvas.height === 1)).toBe(true);
  });
});
