// Saving / sharing generated files, and receiving files shared *into* the app (Android share sheet).

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function canShareFiles(): boolean {
  try {
    const f = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    return !!navigator.canShare?.({ files: [f] });
  } catch {
    return false;
  }
}

/** Opens the phone's share sheet (Gmail, Outlook, Drive…) with the files attached. */
export async function shareFiles(files: File[], title: string, text: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!navigator.canShare?.({ files })) return 'unsupported';
  try {
    await navigator.share({ files, title, text });
    return 'shared';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
    throw e;
  }
}

export const SHARE_CACHE = 'share-inbox';

/** Files that the service worker stashed after an Android "Share → Expense Snap". */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  const files: File[] = [];
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-file-name') || 'shared');
    files.push(new File([blob], name, { type: blob.type || res.headers.get('content-type') || '' }));
    await cache.delete(req);
  }
  return files;
}
