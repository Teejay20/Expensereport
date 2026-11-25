import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { attachmentsOf, db } from '../lib/db';
import { monthKey, monthLabel, toMDY } from '../lib/dates';
import { fmtMoney, round2 } from '../lib/money';
import { buildReport } from '../lib/report';
import { matchAll, parseStatement, type MatchCandidate, type StatementTxn } from '../lib/statementParser';
import { statementText } from '../lib/ingest';
import { referenceRate } from '../lib/fx';
import { rasterizePdfToJpegs } from '../lib/pdfText';
import { anyImageToJpeg } from '../lib/image';
import { canShareFiles, downloadBlob, shareFiles } from '../lib/share';
import type { Expense, Settings } from '../lib/types';
import { FilePick, Header, Icon, MonthNav, MoneyInput, ProgressBar } from '../components/ui';
import { back, go, toast, useMonth } from '../state';

function FxRow({ e, home, txns, suggestion, onSaved }: { e: Expense; home: string; txns: StatementTxn[]; suggestion?: MatchCandidate; onSaved: () => void }) {
  const [val, setVal] = useState(e.cadCharged !== undefined ? String(e.cadCharged) : '');
  const [busy, setBusy] = useState(false);
  const save = async (cad: number, source: Expense['fxSource'], ref?: number) => {
    await db.expenses.update(e.id, { cadCharged: round2(cad), fxSource: source, ...(ref ? { fxReference: ref } : {}), updatedAt: Date.now() });
    setVal(String(round2(cad)));
    onSaved();
  };
  const near = txns.filter((t) => Math.abs((Date.parse(t.date) - Date.parse(e.date)) / 864e5) <= 10);
  const status = e.cadCharged === undefined ? <span className="badge danger">missing</span>
    : e.fxSource === 'statement' ? <span className="badge ok">from statement</span>
      : e.fxSource === 'manual' ? <span className="badge ok">entered</span> : <span className="badge warn">estimate</span>;

  return (
    <div className="fx-row">
      <div className="row">
        <div className="main" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{e.description || e.merchant} {status}</div>
          <div className="small muted">{toMDY(e.date)} · {fmtMoney(e.total, e.currency)}{e.cadCharged !== undefined && ` → ${fmtMoney(e.cadCharged, home)} (rate ${(e.cadCharged / e.total).toFixed(4)})`}</div>
        </div>
      </div>
      {suggestion && e.fxSource !== 'statement' && (
        <div className="notice info" style={{ marginTop: 8 }}>
          <Icon name="card" size={18} />
          <div style={{ flex: 1 }}>
            <div>Statement: <b>{suggestion.txn.description || 'transaction'}</b> on {toMDY(suggestion.txn.date)} – <b>{fmtMoney(suggestion.txn.amountCAD, home)}</b></div>
            <div className="small">{suggestion.reason}</div>
          </div>
          <button className="btn sm primary" onClick={() => save(suggestion.txn.amountCAD, 'statement')}>Use</button>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <div style={{ flex: 1 }}><MoneyInput value={val} onChange={setVal} placeholder={`CAD charged`} /></div>
        <button className="btn sm" disabled={!parseFloat(val)} onClick={() => save(parseFloat(val), 'manual')}>Save</button>
        <button className="btn sm ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await referenceRate(e.currency, e.date, home);
          setBusy(false);
          if (!r) return toast('Could not get a rate (offline?)', 'err');
          await save(e.total * r.rate, 'estimate', r.rate);
          toast(`${r.source}: ${r.rate.toFixed(4)}`);
        }}>Estimate</button>
      </div>
      {near.length > 0 && e.fxSource !== 'statement' && (
        <select className="input" style={{ marginTop: 8 }} value="" onChange={(ev) => { const t = near[+ev.target.value]; if (t) save(t.amountCAD, 'statement'); }}>
          <option value="">Pick the matching statement line…</option>
          {near.map((t, i) => <option key={i} value={i}>{toMDY(t.date)} · {t.description.slice(0, 32)} · {t.amountCAD.toFixed(2)}</option>)}
        </select>
      )}
    </div>
  );
}

export function MonthEnd({ settings }: { settings: Settings }) {
  const [month, setMonth] = useMonth();
  const [tick, setTick] = useState(0);
  const all = useLiveQuery(() => db.expenses.where('date').between(`${month}-01`, `${month}-31￿`, true, true).toArray(), [month, tick]);
  const expenses = useMemo(() => (all ?? []).filter((e) => monthKey(e.date) === month), [all, month]);
  const report = useMemo(() => buildReport(expenses, settings, month), [expenses, settings, month]);
  const home = settings.homeCurrency;
  const foreign = expenses.filter((e) => e.kind === 'receipt' && e.currency !== home).sort((a, b) => a.date.localeCompare(b.date));
  const [txns, setTxns] = useState<StatementTxn[]>([]);
  const [matches, setMatches] = useState<Map<string, MatchCandidate>>(new Map());
  const [stmtBusy, setStmtBusy] = useState<{ p: number; label: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const fixedFx = foreign.filter((e) => e.cadCharged !== undefined && e.fxSource !== 'estimate').length;

  async function onStatement(files: File[]) {
    try {
      let text = '';
      for (const f of files) {
        setStmtBusy({ p: 0.05, label: `Reading ${f.name}…` });
        text += '\n' + (await statementText(f, (p, label) => setStmtBusy({ p, label })));
      }
      const [y, m] = month.split('-').map(Number);
      // Statements can close in the following month – parse with both hints
      const t = [...parseStatement(text, y, m), ...parseStatement(text, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1)];
      const uniq = t.filter((x, i) => t.findIndex((z) => z.raw === x.raw && z.date === x.date) === i);
      setTxns(uniq);
      const refs: Record<string, number | undefined> = {};
      setStmtBusy({ p: 0.9, label: 'Matching transactions…' });
      await Promise.all(foreign.map(async (e) => { refs[e.id] = (await referenceRate(e.currency, e.date, home))?.rate; }));
      const res = matchAll(foreign.filter((e) => e.fxSource !== 'statement'), uniq, refs);
      setMatches(res);
      toast(`${uniq.length} transactions read · ${res.size} match${res.size === 1 ? '' : 'es'} found`);
    } catch (e) {
      toast(`Could not read statement: ${(e as Error).message}`, 'err');
    } finally {
      setStmtBusy(null);
    }
  }

  async function acceptAll() {
    for (const [id, m] of matches) await db.expenses.update(id, { cadCharged: round2(m.txn.amountCAD), fxSource: 'statement', updatedAt: Date.now() });
    setMatches(new Map());
    setTick((t) => t + 1);
    toast('Card amounts applied');
  }

  async function build(kind: 'xlsx' | 'pdf'): Promise<File> {
    if (kind === 'xlsx') {
      const { exportXlsx } = await import('../lib/export/xlsx');
      const b = await exportXlsx(report);
      return new File([b], `${report.fileBase}.xlsx`, { type: b.type });
    }
    const { exportPdf } = await import('../lib/export/pdf');
    const b = await exportPdf(report, {
      attachmentsFor: (row) => attachmentsOf(row.expense),
      rasterizePdf: rasterizePdfToJpegs,
      toJpeg: anyImageToJpeg,
    });
    return new File([b], `${report.fileBase}.pdf`, { type: 'application/pdf' });
  }

  async function run(label: string, fn: () => Promise<void>) {
    setExporting(label);
    try { await fn(); } catch (e) { console.error(e); toast(`Export failed: ${(e as Error).message}`, 'err'); } finally { setExporting(null); }
  }

  const blocking = report.issues.filter((i) => i.level === 'block');
  const warns = report.issues.filter((i) => i.level === 'warn' && !i.message.includes('CAD amount charged'));

  return (
    <>
      <Header title="Month-end report" onBack={() => back()} />
      <div className="page">
        <MonthNav month={month} onChange={setMonth} />
        <div className="card summary">
          <div>
            <div className="muted small">{monthLabel(month)} · {report.rows.length} item{report.rows.length === 1 ? '' : 's'}</div>
            <div className="big">{fmtMoney(report.totalCAD, home)}</div>
          </div>
          {blocking.length === 0 ? <span className="badge ok">ready</span> : <span className="badge danger">{blocking.length} to fix</span>}
        </div>

        <div className="card">
          <h2><span className="step">1</span>Foreign currency → CAD</h2>
          {foreign.length === 0 ? (
            <div className="small muted">No foreign-currency purchases this month. 🎉</div>
          ) : (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                Your company reimburses what your card actually charged. Upload your credit-card statement (PDF or screenshot) and the app matches each purchase, or type the CAD amount yourself.
                <br /><b>{fixedFx}/{foreign.length}</b> confirmed.
              </p>
              <FilePick className="btn block" accept="application/pdf,.pdf,image/*" multiple onFiles={onStatement}><Icon name="upload" size={18} />Upload card statement</FilePick>
              {stmtBusy && <div style={{ marginTop: 10 }}><ProgressBar value={stmtBusy.p} label={stmtBusy.label} /></div>}
              {matches.size > 1 && <button className="btn primary block" style={{ marginTop: 10 }} onClick={acceptAll}><Icon name="check" size={18} />Accept all {matches.size} matches</button>}
              {txns.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{txns.length} statement lines read. Nothing is uploaded – the statement is processed on this phone and not stored.</div>}
              {foreign.map((e) => (
                <FxRow key={`${e.id}-${e.updatedAt}`} e={e} home={home} txns={txns} suggestion={matches.get(e.id)} onSaved={() => { setMatches((m) => { const n = new Map(m); n.delete(e.id); return n; }); setTick((t) => t + 1); }} />
              ))}
            </>
          )}
        </div>

        <div className="card">
          <h2><span className="step">2</span>Checks</h2>
          {blocking.length === 0 && warns.length === 0 && <div className="notice ok"><Icon name="check" size={18} />Everything looks complete.</div>}
          {[...blocking, ...warns].map((i, k) => (
            <div key={k} className={`notice ${i.level === 'block' ? 'danger' : 'warn'}`}>
              <Icon name="alert" size={18} />
              <div style={{ flex: 1 }}>{i.message}</div>
              {i.expenseId && <button className="link" onClick={() => { const e = expenses.find((x) => x.id === i.expenseId); go(`${e?.kind === 'mileage' ? 'trip' : 'expense'}/${i.expenseId}`); }}>Open</button>}
              {!i.expenseId && <button className="link" onClick={() => go('settings')}>Settings</button>}
            </div>
          ))}
        </div>

        <div className="card">
          <h2><span className="step">3</span>Export &amp; send</h2>
          <div className="small muted">Files</div>
          <div className="file-name">{report.fileBase}.xlsx</div>
          <div className="file-name" style={{ marginTop: 4 }}>{report.fileBase}.pdf</div>
          {exporting && <div style={{ marginTop: 10 }}><ProgressBar value={0.6} label={exporting} /></div>}
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {canShareFiles() && (
              <button className="btn primary" disabled={!!exporting || report.rows.length === 0} onClick={() => run('Building Excel + PDF…', async () => {
                const files = [await build('xlsx'), await build('pdf')];
                const r = await shareFiles(files, report.fileBase, `Expense report – ${report.sheetName} – total ${fmtMoney(report.totalCAD, home)}`);
                if (r === 'unsupported') files.forEach((f) => downloadBlob(f, f.name));
              })}><Icon name="share" size={18} />Share both (email, Drive…)</button>
            )}
            <div className="grid2">
              <button className="btn" disabled={!!exporting || report.rows.length === 0} onClick={() => run('Building Excel…', async () => { const f = await build('xlsx'); downloadBlob(f, f.name); })}><Icon name="download" size={18} />Excel</button>
              <button className="btn" disabled={!!exporting || report.rows.length === 0} onClick={() => run('Building PDF…', async () => { const f = await build('pdf'); downloadBlob(f, f.name); })}><Icon name="download" size={18} />PDF</button>
            </div>
          </div>
          {blocking.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>You can export now, but fix the red items first for a complete report.</div>}
        </div>
      </div>
    </>
  );
}
