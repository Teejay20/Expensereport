import { useEffect, useMemo, useRef, useState } from 'react';
import { db, deleteExpense, rememberedMerchant, saveExpense, uid, attachmentsOf } from '../lib/db';
import { ingestFile, isPdf, type PageRead } from '../lib/ingest';
import { rotateImage, compressForStorage } from '../lib/image';
import { findAmounts, fmtMoney, round2 } from '../lib/money';
import { normalizeText, KNOWN_CURRENCIES, combineReceipts } from '../lib/receiptParser';
import { referenceRate } from '../lib/fx';
import { todayISO } from '../lib/dates';
import { CATEGORIES, type Attachment, type Expense, type Settings } from '../lib/types';
import { AttachmentThumb, Confirm, Field, FilePick, Header, Icon, MoneyInput, ProgressBar, Viewer } from '../components/ui';
import { back, takePendingFiles, toast } from '../state';

const num = (s: string) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};
const str = (n?: number) => (n === undefined || n === null || Number.isNaN(n) ? '' : String(round2(n)));

interface Form {
  date: string;
  description: string;
  merchant: string;
  category: string;
  currency: string;
  total: string;
  tax: string;
  cadCharged: string;
  notes: string;
}

export function ExpenseEditor({ id, settings }: { id?: string; settings: Settings }) {
  const home = settings.homeCurrency;
  const [existing, setExisting] = useState<Expense>();
  const [f, setF] = useState<Form>({ date: todayISO(), description: '', merchant: '', category: 'Travel', currency: home, total: '', tax: '', cadCharged: '', notes: '' });
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [chipTarget, setChipTarget] = useState<'total' | 'tax' | 'cad'>('total');
  const [viewing, setViewing] = useState<Attachment>();
  const [flash, setFlash] = useState<string>('');
  const [fxRef, setFxRef] = useState<{ rate: number; source: string }>();
  const [pages, setPages] = useState<PageRead[]>([]);
  const [suggest, setSuggest] = useState<{ total: number; tax: number; note: string }>();
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const formRef = useRef(f);
  formRef.current = f;
  const pagesRef = useRef<PageRead[]>([]);

  // Load existing expense or process files handed over from Home / share sheet
  useEffect(() => {
    (async () => {
      if (id && id !== 'new') {
        const e = await db.expenses.get(id);
        if (!e) return back();
        setExisting(e);
        setF({
          date: e.date, description: e.description, merchant: e.merchant ?? '', category: e.category, currency: e.currency,
          total: str(e.total), tax: e.tax ? str(e.tax) : '', cadCharged: str(e.cadCharged), notes: e.notes ?? '',
        });
        setOcrText(e.ocrText ?? '');
        setAtts(await attachmentsOf(e));
        if (e.fxReference) setFxRef({ rate: e.fxReference, source: 'saved' });
      } else {
        const files = takePendingFiles();
        if (files.length) await addFiles(files, true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addFiles(files: File[], parse: boolean, extra = false) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (parse && i === 0 && !extra) {
          setBusy({ p: 0.02, label: 'Starting…' });
          const r = await ingestFile(file, settings, (p, label) => setBusy({ p, label }));
          setAtts((a) => [...a, r.attachment]);
          setOcrText(r.text);
          pagesRef.current = r.pages;
          setPages(r.pages);
          setWarnings(r.parsed.warnings);
          const mem = await rememberedMerchant(r.parsed.merchant);
          const patch: Partial<Form> = {
            currency: r.parsed.currency,
            merchant: r.parsed.merchant ?? '',
            description: mem?.description || r.parsed.merchant || '',
            category: mem?.category || r.parsed.category || 'Travel',
          };
          if (r.parsed.date) patch.date = r.parsed.date;
          if (r.parsed.total !== undefined) patch.total = str(r.parsed.total);
          if (r.parsed.tax) patch.tax = str(r.parsed.tax);
          set(patch);
          setFlash(Object.keys(patch).join(','));
          setTimeout(() => setFlash(''), 1300);
          const found = [r.parsed.total !== undefined && 'total', r.parsed.date && 'date', r.parsed.tax && 'tax'].filter(Boolean);
          toast(found.length ? `Found ${found.join(', ')} – please check` : 'Could not read much – tap the amounts below', found.length ? 'ok' : 'err');
        } else if (parse) {
          // Extra page/photo for the same expense (e.g. invoice behind a card slip): read it and combine
          setBusy({ p: 0.02, label: 'Reading extra page…' });
          const r = await ingestFile(file, settings, (p, label) => setBusy({ p, label }));
          setAtts((a) => [...a, r.attachment]);
          setOcrText((t) => (t ? `${t}\n\n— page —\n\n${r.text}` : r.text));
          const hadPages = pagesRef.current.length > 0;
          pagesRef.current = [...pagesRef.current, ...r.pages];
          setPages(pagesRef.current);
          const c = combineReceipts(pagesRef.current);
          const cur = { total: num(formRef.current.total), tax: num(formRef.current.tax) };
          if (hadPages && c.total && (Math.abs(c.total - cur.total) > 0.005 || Math.abs((c.tax ?? 0) - cur.tax) > 0.005)) {
            setSuggest({ total: c.total, tax: c.tax ?? 0, note: c.warnings[0] ?? `Combined ${pagesRef.current.length} pages` });
          }
        } else {
          const a: Attachment = isPdf(file)
            ? { id: uid(), name: file.name, mime: 'application/pdf', blob: file, role: 'receipt', createdAt: Date.now() }
            : { id: uid(), name: file.name, mime: 'image/jpeg', blob: await compressForStorage(file), role: 'receipt', createdAt: Date.now() };
          setAtts((x) => [...x, a]);
        }
      } catch (err) {
        console.error(err);
        toast(`Could not read ${file.name}: ${(err as Error).message}`, 'err');
      }
    }
    setBusy(null);
  }

  const foreign = f.currency !== home;
  const total = num(f.total), tax = num(f.tax);
  const preTax = round2(total - tax);

  // Reference rate for foreign purchases (estimate only)
  useEffect(() => {
    if (!foreign || !f.date) { setFxRef(undefined); return; }
    let live = true;
    referenceRate(f.currency, f.date, home).then((r) => live && setFxRef(r));
    return () => { live = false; };
  }, [foreign, f.currency, f.date, home]);

  const chips = useMemo(() => {
    const vals = new Set<number>();
    normalizeText(ocrText).split('\n').forEach((l) => findAmounts(l).forEach((a) => a.value > 0 && vals.add(a.value)));
    return [...vals].sort((a, b) => b - a).slice(0, 14);
  }, [ocrText]);

  const applyChip = (v: number) => {
    if (chipTarget === 'total') set({ total: str(v) });
    else if (chipTarget === 'tax') set({ tax: str(v) });
    else set({ cadCharged: str(v) });
    setFlash(chipTarget);
    setTimeout(() => setFlash(''), 1300);
  };

  async function rotate(a: Attachment) {
    const blob = await rotateImage(a.blob, 90);
    setAtts((x) => x.map((y) => (y.id === a.id ? { ...a, id: uid(), blob } : y)));
    if (!removed.includes(a.id)) setRemoved((r) => [...r, a.id]);
  }

  async function save() {
    if (!f.date) return toast('Please enter a date', 'err');
    if (!(total > 0)) return toast('Please enter the total amount', 'err');
    if (tax > total) return toast('Tax cannot be more than the total', 'err');
    const cad = f.cadCharged ? num(f.cadCharged) : undefined;
    const e: Expense = {
      id: existing?.id ?? uid(),
      kind: 'receipt',
      date: f.date,
      category: f.category,
      description: f.description.trim() || f.merchant.trim(),
      merchant: f.merchant.trim() || undefined,
      currency: f.currency,
      preTax,
      tax,
      total,
      cadCharged: foreign ? cad : undefined,
      fxSource: foreign && cad !== undefined ? (existing?.fxSource && existing.cadCharged === cad ? existing.fxSource : 'manual') : undefined,
      fxReference: foreign ? fxRef?.rate : undefined,
      attachmentIds: atts.map((a) => a.id),
      notes: f.notes || undefined,
      ocrText: ocrText || undefined,
      needsReview: false,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const fresh = atts.filter((a) => !existing?.attachmentIds.includes(a.id));
    await saveExpense(e, fresh);
    const gone = [...removed, ...(existing?.attachmentIds ?? []).filter((x) => !atts.some((a) => a.id === x))];
    if (gone.length) await db.attachments.bulkDelete(gone);
    toast('Saved');
    back();
  }

  const fl = (k: string) => (flash.includes(k) ? ' flash' : '');

  return (
    <>
      <Header title={existing ? 'Edit expense' : 'New expense'} onBack={() => back()}
        right={existing && <Confirm className="icon-btn" text="Delete this expense?" onYes={async () => { await deleteExpense(existing.id); toast('Deleted'); back(); }}><Icon name="trash" /></Confirm>} />
      <div className="page">
        {busy && <div className="card"><ProgressBar value={busy.p} label={busy.label} /><div className="small muted" style={{ marginTop: 8 }}>Reading the receipt on your phone – nothing is uploaded.</div></div>}

        <div className="card">
          <h2><Icon name="doc" size={18} />Receipt</h2>
          <div className="thumbs">
            {atts.map((a) => (
              <AttachmentThumb key={a.id} a={a} onOpen={() => setViewing(a)} onRotate={() => rotate(a)}
                onRemove={() => { setAtts((x) => x.filter((y) => y.id !== a.id)); }} />
            ))}
            <FilePick className="add-thumb" accept="image/*" capture onFiles={(fs) => addFiles(fs, true, atts.length > 0)}><Icon name="camera" />{atts.length ? 'Add page' : 'Photo'}</FilePick>
            <FilePick className="add-thumb" accept="image/*,application/pdf,.pdf" multiple onFiles={(fs) => addFiles(fs, true, atts.length > 0)}><Icon name="upload" />File</FilePick>
          </div>
          {warnings.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Check: {warnings.join(' · ')}</div>}
          {pages.length > 1 && <div className="small muted" style={{ marginTop: 4 }}>{pages.length} pages read.</div>}
          {suggest && (
            <div className="notice info" style={{ marginTop: 10, marginBottom: 0 }}>
              <Icon name="doc" size={18} />
              <div style={{ flex: 1 }}>{suggest.note}: total <b>{suggest.total.toFixed(2)}</b>, tax <b>{suggest.tax.toFixed(2)}</b></div>
              <button className="btn sm primary" onClick={() => { set({ total: str(suggest.total), tax: suggest.tax ? str(suggest.tax) : '' }); setSuggest(undefined); setFlash('total,tax'); setTimeout(() => setFlash(''), 1300); }}>Apply</button>
            </div>
          )}
        </div>

        {chips.length > 0 && (
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="small muted">Tap an amount to use it as</span>
              <span className="spacer" />
              <div className="seg">
                <button className={chipTarget === 'total' ? 'on' : ''} onClick={() => setChipTarget('total')}>Total</button>
                <button className={chipTarget === 'tax' ? 'on' : ''} onClick={() => setChipTarget('tax')}>Tax</button>
                {foreign && <button className={chipTarget === 'cad' ? 'on' : ''} onClick={() => setChipTarget('cad')}>CAD</button>}
              </div>
            </div>
            <div className="chips">
              {chips.map((v) => (
                <button key={v} className={`chip${(chipTarget === 'total' && num(f.total) === v) || (chipTarget === 'tax' && num(f.tax) === v) ? ' on' : ''}`} onClick={() => applyChip(v)}>{v.toFixed(2)}</button>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="grid2">
            <Field label="Date"><input className={`input${fl('date')}`} type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
            <Field label="Category">
              <select className={`input${fl('category')}`} value={f.category} onChange={(e) => set({ category: e.target.value })}>
                {[...new Set([...CATEGORIES, f.category])].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description" hint="Shown in the report, e.g. “Uber”, “UW parking”, “Misumi_Coating head”">
            <input className={`input${fl('description')}`} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What was it for?" />
          </Field>
          <div className="grid3">
            <Field label="Currency">
              <select className={`input${fl('currency')}`} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>
                {KNOWN_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Total"><span className={fl('total')}><MoneyInput value={f.total} onChange={(v) => set({ total: v })} /></span></Field>
            <Field label="Tax"><span className={fl('tax')}><MoneyInput value={f.tax} onChange={(v) => set({ tax: v })} /></span></Field>
          </div>
          {f.currency === home && total > 0 && !tax && (settings.salesTaxRate ?? 13) > 0 && (
            <button className="btn sm" style={{ marginBottom: 8 }} onClick={() => {
              const r = (settings.salesTaxRate ?? 13) / 100;
              set({ tax: str(total - total / (1 + r)) });
              setFlash('tax'); setTimeout(() => setFlash(''), 1300);
            }}>+ {settings.salesTaxRate ?? 13}% tax included in total ({fmtMoney(round2(total - total / (1 + (settings.salesTaxRate ?? 13) / 100)), home)})</button>
          )}
          <div className="kpi"><span className="muted">Pre-tax</span><b>{fmtMoney(preTax, f.currency)}</b></div>
        </div>

        {foreign && (
          <div className="card">
            <h2><Icon name="card" size={18} />Charged on your card (CAD)</h2>
            <Field label={`Amount in ${home} from your credit-card statement`} hint="Leave empty if you don't know yet – Month-end will ask for your statement.">
              <span className={fl('cad')}><MoneyInput value={f.cadCharged} onChange={(v) => set({ cadCharged: v })} placeholder="e.g. 36.33" /></span>
            </Field>
            {f.cadCharged && total > 0 && <div className="kpi"><span className="muted">Effective rate {f.currency}:{home}</span><b>{(num(f.cadCharged) / total).toFixed(4)}</b></div>}
            {fxRef && total > 0 && (
              <div className="kpi">
                <span className="muted">{fxRef.source} rate {fxRef.rate.toFixed(4)}</span>
                <b>≈ {fmtMoney(total * fxRef.rate, home)}</b>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <Field label="Notes (optional)"><textarea className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          {ocrText && <details><summary>Scanned text</summary><pre className="ocr">{ocrText}</pre></details>}
        </div>

        <div className="sticky-actions">
          <button className="btn" onClick={() => back()}>Cancel</button>
          <button className="btn primary" disabled={!!busy} onClick={save}><Icon name="check" size={18} />Save</button>
        </div>
      </div>
      {viewing && <Viewer a={viewing} onClose={() => setViewing(undefined)} />}
    </>
  );
}
