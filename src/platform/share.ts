import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeApp } from './runtime';

const exportDirectory = 'axis-exports';
let sharing = false;

async function cleanOldExports() {
  try {
    const { files } = await Filesystem.readdir({ directory: Directory.Cache, path: exportDirectory });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (file.type === 'file' && file.mtime < cutoff) {
        await Filesystem.deleteFile({ directory: Directory.Cache, path: `${exportDirectory}/${file.name}` });
      }
    }
  } catch {
    // Cache cleanup is best effort. The OS can purge it too; it never contains
    // the authoritative session or a user's original imported file.
  }
}

/** Opens the native share sheet for a temporary JSON copy. It does not upload
 * anything. "shared" means the OS completed its share handoff, not confirmed
 * delivery by another app. Successful copies remain in cache so the receiving
 * app can still read them; old copies are cleaned before the next export.
 */
export async function shareSessionFile(name: string, json: string): Promise<'shared' | 'cancelled'> {
  if (!isNativeApp()) throw new Error('网页请使用原有导出方式。');
  if (sharing) throw new Error('请先完成或取消当前分享。');
  try { JSON.parse(json); } catch { throw new Error('魔方记录不是有效的 JSON 文件。'); }
  sharing = true;
  let path: string | undefined;
  try {
    if (!(await Share.canShare()).value) throw new Error('这台设备暂时无法打开系统分享。');
    await cleanOldExports();
    let filename = name.replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/^\.+/, '').slice(0, 100) || 'AXIS-魔方记录';
    if (!filename.toLowerCase().endsWith('.json')) filename += '.json';
    const nonce = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    path = `${exportDirectory}/${Date.now()}-${nonce}-${filename}`;
    const { uri } = await Filesystem.writeFile({ directory: Directory.Cache, path, data: json, encoding: Encoding.UTF8, recursive: true });
    await Share.share({ title: 'AXIS 魔方记录', dialogTitle: '分享魔方记录', files: [uri] });
    return 'shared';
  } catch (error) {
    if (path) {
      try { await Filesystem.deleteFile({ directory: Directory.Cache, path }); } catch { /* May already be purged by the OS. */ }
    }
    const message = error instanceof Error ? error.message : (error as { message?: unknown } | null)?.message;
    // Both installed native plugin implementations use this exact rejection.
    if (message === 'Share canceled') return 'cancelled';
    throw error;
  } finally {
    sharing = false;
  }
}
