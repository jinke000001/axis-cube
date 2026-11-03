import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: vi.fn(), canShare: vi.fn(), share: vi.fn(),
  readdir: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(),
}));
vi.mock('./runtime', () => ({ isNativeApp: mocks.native }));
vi.mock('@capacitor/share', () => ({ Share: { canShare: mocks.canShare, share: mocks.share } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { readdir: mocks.readdir, writeFile: mocks.writeFile, deleteFile: mocks.deleteFile },
}));
import { shareSessionFile } from './share';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockReturnValue(true);
  mocks.canShare.mockResolvedValue({ value: true });
  mocks.readdir.mockResolvedValue({ files: [] });
  mocks.writeFile.mockResolvedValue({ uri: 'file:///private/cache/shared.json' });
  mocks.share.mockResolvedValue({ activityType: 'test-receiver' });
  mocks.deleteFile.mockResolvedValue(undefined);
});

describe('native session sharing boundary', () => {
  it('shares a cache copy without deleting it before the receiver can read', async () => {
    const original = '{"cube":"saved-state"}';
    await expect(shareSessionFile('../Documents/我的记录.json', original)).resolves.toBe('shared');
    const options = mocks.writeFile.mock.calls[0][0];
    expect(options.directory).toBe('CACHE');
    expect(options.path).toMatch(/^axis-exports\/[^/]+\.json$/);
    expect(options.data).toBe(original);
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///private/cache/shared.json'] }));
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('returns cancellation and removes only this temporary copy', async () => {
    mocks.share.mockRejectedValue(new Error('Share canceled'));
    await expect(shareSessionFile('AXIS.json', '{}')).resolves.toBe('cancelled');
    expect(mocks.deleteFile).toHaveBeenCalledExactlyOnceWith({ directory: 'CACHE', path: mocks.writeFile.mock.calls[0][0].path });
  });

  it('preserves actual native errors instead of reporting cancellation', async () => {
    mocks.share.mockRejectedValue(new Error('No activity available'));
    await expect(shareSessionFile('AXIS.json', '{}')).rejects.toThrow('No activity available');
  });

  it('cleans only old cache files and retains recent files and directories', async () => {
    mocks.readdir.mockResolvedValue({ files: [
      { name: 'old.json', type: 'file', mtime: 0 },
      { name: 'recent.json', type: 'file', mtime: Date.now() },
      { name: 'unrelated-folder', type: 'directory', mtime: 0 },
    ] });
    await shareSessionFile('AXIS.json', '{}');
    expect(mocks.deleteFile).toHaveBeenCalledExactlyOnceWith({ directory: 'CACHE', path: 'axis-exports/old.json' });
  });

  it('does not create files for invalid JSON or a browser caller', async () => {
    await expect(shareSessionFile('AXIS.json', 'invalid')).rejects.toThrow('JSON');
    mocks.native.mockReturnValue(false);
    await expect(shareSessionFile('AXIS.json', '{}')).rejects.toThrow('网页');
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });
});
