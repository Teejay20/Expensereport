import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { monthKey, monthLabel } from '../lib/dates';
import { fmtMoney } from '../lib/money';
import { cadFor } from '../lib/report';
import type { Expense, Settings } from '../lib/types';
import { FilePick, Header, Icon, MonthNav, useObjectUrl } from '../components/ui';
import { go, setPendingFiles, useMonth } from '../state';
import { ScanTip } from './ScanGuide';

function Thumb({ e }: { e: Expense }) {
  const att = useLiveQuery(() => (e.attachmentIds[0] ? db.attachments.get(e.attachmentIds[0]) : undefined), [e.attachmentIds[0]]);
  const url = useObjectUrl(att && att.mime.startsWith('image/') ? att.blob : undefined);
  if (url) return <span className="ico"><img src={url} alt="" /></span>;
  return <span className="ico"><Icon name={e.kind === 'mileage' ? 'car' : att ? 'doc' : 'alert'} /></span>;
}

export function Home({ settings }: { settings: Settings }) {
  const [month, setMonth] = useMonth();
  const expenses = useLiveQuery(
    () => db.expenses.where('date').between(`${month}-01`, `${month}-31￿`, true, true).toArray(),
    [month],
  );
  const home = settings.homeCurrency;
  const list = (expenses ?? []).filter((e) => monthKey(e.date) === month).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = list.reduce((s, e) => s + cadFor(e, home).total, 0);
  const needFx = list.filter((e) => e.kind === 'receipt' && e.currency !== home && (e.cadCharged === undefined || e.fxSource === 'estimate')).length;
  const needReview = list.filter((e) => e.needsReview).length;

  const startWith = (files: File[], multiple = false) => {
    setPendingFiles(files);
    go(multiple && files.length > 1 ? 'import' : 'expense/new');
  };

  const byDay = new Map<string, Expense[]>();
  for (const e of list) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  return (
    <>
      <Header title="Expenses" right={<button className="icon-btn" aria-label="Settings" onClick={() => go('settings')}><Icon name="settings" /></button>} />
      <div className="page">
        <MonthNav month={month} onChange={setMonth} />

        <div className="card summary">
          <div>
            <div className="muted small">Total to reimburse</div>
            <div className="big">{fmtMoney(total, home)}</div>
            <div className="muted small">{list.length} expense{list.length === 1 ? '' : 's'} · {monthLabel(month)}</div>
          </div>
          <button className="btn sm primary" onClick={() => go('report')}><Icon name="report" size={18} />Month-end</button>
        </div>

        {(needFx > 0 || needReview > 0) && (
          <div className="notice warn">
            <Icon name="alert" size={18} />
            <div>
              {needReview > 0 && <div>{needReview} imported receipt{needReview > 1 ? 's' : ''} to review.</div>}
              {needFx > 0 && <div>{needFx} foreign purchase{needFx > 1 ? 's' : ''} need the CAD amount from your card. <button className="link" onClick={() => go('report')}>Fix at month-end</button></div>}
            </div>
          </div>
        )}

        <div className="actions">
          <FilePick className="action primary" accept="image/*" capture onFiles={(f) => startWith(f)}><Icon name="camera" />Scan</FilePick>
          <FilePick className="action" accept="image/*,application/pdf,.pdf" multiple onFiles={(f) => startWith(f, true)}><Icon name="upload" />Upload</FilePick>
          <button className="action" onClick={() => go('trip/new')}><Icon name="car" />Trip</button>
          <button className="action" onClick={() => go('expense/new')}><Icon name="pencil" />Manual</button>
        </div>
        <ScanTip onOpen={() => go('scan-help')} />

        {expenses && list.length === 0 && (
          <div className="empty">
            <Icon name="list" size={40} />
            <div>No expenses in {monthLabel(month)} yet.</div>
            <div className="small">Scan a paper receipt, upload an emailed one (PDF or screenshot), or log a car trip.</div>
          </div>
        )}

        {[...byDay.entries()].map(([day, items]) => (
          <section key={day}>
            <div className="day">{new Date(day + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            {items.map((e) => {
              const cad = cadFor(e, home);
              const foreign = e.kind === 'receipt' && e.currency !== home;
              return (
                <button key={e.id} className="item" onClick={() => go(`${e.kind === 'mileage' ? 'trip' : 'expense'}/${e.id}`)}>
                  <Thumb e={e} />
                  <span className="main">
                    <span className="title">
                      {e.kind === 'mileage' ? `${e.mileage?.distanceKm.toFixed(1)} km · ${e.description || 'Trip'}` : e.description || e.merchant || 'Untitled'}
                      {e.needsReview && <span className="badge info">review</span>}
                    </span>
                    <span className="sub">
                      {e.category}
                      {!e.attachmentIds.length && <span className="badge danger">no receipt</span>}
                      {foreign && e.cadCharged === undefined && <span className="badge warn">CAD?</span>}
                      {foreign && e.fxSource === 'estimate' && <span className="badge warn">est. rate</span>}
                    </span>
                  </span>
                  <span className="amt">
                    {foreign && e.cadCharged === undefined ? '—' : fmtMoney(cad.total, home)}
                    {foreign && <span className="orig">{fmtMoney(e.total, e.currency)}</span>}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
