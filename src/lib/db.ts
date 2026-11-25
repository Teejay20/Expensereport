// Local-only storage (IndexedDB via Dexie). Nothing leaves the phone.
import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type Attachment, type Expense, type MerchantMemory, type Settings } from './types';
import { normalizeMerchantKey } from './categories';

class ExpenseDB extends Dexie {
  expenses!: Table<Expense, string>;
  attachments!: Table<Attachment, string>;
  settings!: Table<Settings, string>;
  merchants!: Table<MerchantMemory, string>;
  constructor() {
    super('expense-snap');
    this.version(1).stores({
      expenses: 'id, date, kind, currency, updatedAt',
      attachments: 'id, expenseId, role',
      settings: 'id',
      merchants: 'key, updatedAt',
    });
  }
}

export const db = new ExpenseDB();

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('me')) ?? {}) };
}

export async function saveSettings(s: Settings) {
  await db.settings.put({ ...s, id: 'me' });
}

export async function saveExpense(e: Expense, newAttachments: Attachment[] = []) {
  await db.transaction('rw', db.expenses, db.attachments, db.merchants, async () => {
    for (const a of newAttachments) await db.attachments.put({ ...a, expenseId: e.id });
    await db.expenses.put({ ...e, updatedAt: Date.now() });
    if (e.kind === 'receipt' && (e.merchant || e.description)) {
      const key = normalizeMerchantKey(e.merchant || e.description);
      const prev = await db.merchants.get(key);
      await db.merchants.put({
        key,
        category: e.category,
        description: e.description,
        uses: (prev?.uses ?? 0) + 1,
        updatedAt: Date.now(),
      });
    }
  });
}

export async function deleteExpense(id: string) {
  await db.transaction('rw', db.expenses, db.attachments, async () => {
    await db.attachments.where('expenseId').equals(id).delete();
    await db.expenses.delete(id);
  });
}

export async function attachmentsOf(e: Expense): Promise<Attachment[]> {
  const list = await db.attachments.bulkGet(e.attachmentIds);
  return list.filter((a): a is Attachment => !!a);
}

export async function rememberedMerchant(name?: string): Promise<MerchantMemory | undefined> {
  if (!name) return undefined;
  return db.merchants.get(normalizeMerchantKey(name));
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
