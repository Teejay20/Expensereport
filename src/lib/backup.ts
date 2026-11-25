// Backup / restore of all local data to a single JSON file (keep it in Google Drive, email, etc.).
import { db } from './db';
import type { Attachment } from './types';

interface BackupFile {
  app: 'expense-snap';
  version: 1;
  exportedAt: string;
  settings: unknown[];
  expenses: unknown[];
  merchants: unknown[];
  attachments: (Omit<Attachment, 'blob'> & { data: string })[];
}

const blobToB64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(b);
  });

const b64ToBlob = (b64: string, type: string) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
};

export async function createBackup(): Promise<Blob> {
  const atts = await db.attachments.toArray();
  const file: BackupFile = {
    app: 'expense-snap',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await db.settings.toArray(),
    expenses: await db.expenses.toArray(),
    merchants: await db.merchants.toArray(),
    attachments: await Promise.all(atts.map(async ({ blob, ...rest }) => ({ ...rest, data: await blobToB64(blob) }))),
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function restoreBackup(file: File, mode: 'merge' | 'replace' = 'merge'): Promise<{ expenses: number }> {
  const json = JSON.parse(await file.text()) as BackupFile;
  if (json.app !== 'expense-snap') throw new Error('Not an Expense Snap backup file');
  await db.transaction('rw', [db.expenses, db.attachments, db.settings, db.merchants], async () => {
    if (mode === 'replace') await Promise.all([db.expenses.clear(), db.attachments.clear(), db.merchants.clear()]);
    await db.settings.bulkPut(json.settings as never[]);
    await db.expenses.bulkPut(json.expenses as never[]);
    await db.merchants.bulkPut(json.merchants as never[]);
    await db.attachments.bulkPut(json.attachments.map(({ data, ...a }) => ({ ...a, blob: b64ToBlob(data, a.mime) })));
  });
  return { expenses: json.expenses.length };
}
