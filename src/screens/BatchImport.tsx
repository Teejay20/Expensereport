// Import several receipts at once (e.g. a month of emailed PDFs). Each becomes an expense marked "review".
import { useEffect, useRef, useState } from 'react';
import { ingestFile } from '../lib/ingest';
import { rememberedMerchant, saveExpense, uid } from '../lib/db';
import { fmtMoney, round2 } from '../lib/money';
import { todayISO, monthKey } from '../lib/dates';
import type { Expense, Settings } from '../lib/types';
import { Header, Icon, ProgressBar } from '../components/ui';
import { go, setMonth, takePendingFiles, toast } from '../state';

interface Row { name: string; status: 'waiting' | 'reading' | 'done' | 'error'; expense?: Expense; error?: string }

export function BatchImport({ settings }: { settings: Settings }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const files = takePendingFiles();
    if (!files.length) { go(''); return; }
    if (files.length === 1) {
      // single file → regular editor
      import('../state').then((s) => { s.setPendingFiles(files); location.replace('#/expense/new'); });
      return;
    }
    setRows(files.map((f) => ({ name: f.name, status: 'waiting' })));
    (async () => {
      const months = new Map<string, number>();
      // Undated receipts: use the month most other receipts belong to (or the month being viewed)
      const fallbackDate = () => {
        const top = [...months.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (localStorage.getItem('month') || monthKey(todayISO()));
        return top === monthKey(todayISO()) ? todayISO() : `${top}-01`;
      };
      for (let i = 0; i < files.length; i++) {
        setRows((r) => r.map((x, j) => (j === i ? { ...x, status: 'reading' } : x)));
        try {
          const res = await ingestFile(files[i], settings, (p) => setProgress((i + p) / files.length));
          const p = res.parsed;
          const mem = await rememberedMerchant(p.merchant);
          const total = p.total ?? 0;
          const e: Expense = {
            id: uid(), kind: 'receipt', date: p.date ?? fallbackDate(),
            category: mem?.category || p.category || 'Travel',
            description: mem?.description || p.merchant || files[i].name.replace(/\.\w+$/, ''),
            merchant: p.merchant, currency: p.currency,
            preTax: Math.max(0, round2(total - (p.tax ?? 0))), tax: p.tax ?? 0, total,
            attachmentIds: [res.attachment.id], ocrText: res.text, needsReview: true,
            createdAt: Date.now() + i, updatedAt: Date.now(),
          };
          await saveExpense(e, [res.attachment]);
          months.set(monthKey(e.date), (months.get(monthKey(e.date)) ?? 0) + 1);
          setRows((r) => r.map((x, j) => (j === i ? { ...x, status: 'done', expense: e } : x)));
        } catch (err) {
          setRows((r) => r.map((x, j) => (j === i ? { ...x, status: 'error', error: (err as Error).message } : x)));
        }
      }
      setProgress(1);
      const top = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) setMonth(top[0]);
      toast('Import finished – please review each item');
    })();
  }, [settings]);

  const done = rows.filter((r) => r.status === 'done' || r.status === 'error').length;
  return (
    <>
      <Header title="Importing receipts" onBack={() => go('')} />
      <div className="page">
        <div className="card">
          <ProgressBar value={progress} label={`${done} of ${rows.length} read`} />
          <p className="small muted">Each receipt is read on your phone and saved with a <span className="badge info">review</span> tag. Tap one to check it.</p>
        </div>
        {rows.map((r, i) => (
          <button key={i} className="item" disabled={!r.expense} onClick={() => r.expense && go(`expense/${r.expense.id}`)}>
            <span className="ico"><Icon name={r.status === 'done' ? 'check' : r.status === 'error' ? 'alert' : 'doc'} /></span>
            <span className="main">
              <span className="title">{r.expense ? r.expense.description : r.name}</span>
              <span className="sub">{r.status === 'reading' ? 'Reading…' : r.status === 'waiting' ? 'Waiting' : r.error ?? `${r.expense?.date} · ${r.expense?.category}`}</span>
            </span>
            {r.expense && <span className="amt">{fmtMoney(r.expense.total, r.expense.currency)}</span>}
          </button>
        ))}
        {done === rows.length && rows.length > 0 && <button className="btn primary block" onClick={() => go('')}>Done</button>}
      </div>
    </>
  );
}
