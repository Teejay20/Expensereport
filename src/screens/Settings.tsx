import { useEffect, useState } from 'react';
import { saveSettings, requestPersistence } from '../lib/db';
import { createBackup, restoreBackup } from '../lib/backup';
import { deriveInitials, fileBaseFor } from '../lib/report';
import { downloadBlob } from '../lib/share';
import { KNOWN_CURRENCIES } from '../lib/receiptParser';
import { todayISO, monthKey } from '../lib/dates';
import type { Settings as S } from '../lib/types';
import { Field, FilePick, Header, Icon, MoneyInput } from '../components/ui';
import { back, toast } from '../state';

export function SettingsScreen({ settings }: { settings: S }) {
  const [s, setS] = useState<S>(settings);
  const [rate, setRate] = useState(String(settings.kmRate));
  const [usage, setUsage] = useState<string>();
  const [persisted, setPersisted] = useState<boolean>();
  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB used`));
    navigator.storage?.persisted?.().then(setPersisted);
  }, []);
  const set = (p: Partial<S>) => setS((x) => ({ ...x, ...p }));
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;

  async function save() {
    await saveSettings({ ...s, kmRate: parseFloat(rate) || 0.73 });
    toast('Settings saved');
    back();
  }

  return (
    <>
      <Header title="Settings" onBack={() => back()} />
      <div className="page">
        <div className="card">
          <h2>Your details (printed on the form)</h2>
          <Field label="Full name"><input className="input" value={s.fullName} onChange={(e) => set({ fullName: e.target.value })} placeholder="First Last" autoComplete="name" /></Field>
          <Field label="Interac e-Transfer email"><input className="input" type="email" value={s.interacEmail} onChange={(e) => set({ interacEmail: e.target.value })} autoComplete="email" /></Field>
          <Field label="File initials" hint={`Leave blank to use “${deriveInitials(s.fullName)}”`}>
            <input className="input" value={s.fileInitials} onChange={(e) => set({ fileInitials: e.target.value.replace(/\s/g, '') })} placeholder={deriveInitials(s.fullName)} />
          </Field>
          <Field label="File name pattern" hint={<>Tokens: {'{initials} {Month} {Mon} {MM} {YYYY} {YY} {DD}'}<br />Preview: <b>{fileBaseFor(s, monthKey(todayISO()))}.xlsx</b></>}>
            <input className="input" value={s.fileNamePattern} onChange={(e) => set({ fileNamePattern: e.target.value })} />
          </Field>
        </div>

        <div className="card">
          <h2>Rules</h2>
          <div className="grid2">
            <Field label="Mileage rate ($/km)" hint="CRA automobile allowance"><MoneyInput value={rate} onChange={setRate} /></Field>
            <Field label="Reimbursement currency">
              <select className="input" value={s.homeCurrency} onChange={(e) => set({ homeCurrency: e.target.value })}>
                {KNOWN_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Ambiguous receipt dates like 03/04/2026 mean">
            <select className="input" value={s.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as S['dateOrder'] })}>
              <option value="MDY">Month/Day (March 4)</option>
              <option value="DMY">Day/Month (3 April)</option>
            </select>
          </Field>
          <Field label="Sales tax rate (%)" hint="Used by the “tax included” button – Ontario HST 13%">
            <MoneyInput value={String(s.salesTaxRate ?? 13)} onChange={(v) => set({ salesTaxRate: parseFloat(v) || 0 })} />
          </Field>
          <Field label="Home / office address" hint="Pre-filled as the start of new trips"><input className="input" value={s.homeAddress ?? ''} onChange={(e) => set({ homeAddress: e.target.value })} /></Field>
        </div>

        <button className="btn primary block" onClick={save} style={{ marginBottom: 12 }}><Icon name="check" size={18} />Save settings</button>

        <div className="card">
          <h2>Your data</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Everything is stored only on this phone. {usage} · {persisted ? 'Protected from automatic cleanup.' : 'Not yet protected from cleanup.'}</p>
          {!persisted && <button className="btn sm" onClick={async () => { const ok = await requestPersistence(); setPersisted(ok); toast(ok ? 'Storage protected' : 'Install the app to home screen to protect storage', ok ? 'ok' : 'err'); }}>Protect storage</button>}
          <div className="grid2" style={{ marginTop: 10 }}>
            <button className="btn" onClick={async () => { downloadBlob(await createBackup(), `expense-snap-backup-${todayISO()}.json`); }}><Icon name="download" size={18} />Backup</button>
            <FilePick className="btn" accept="application/json,.json" onFiles={async ([f]) => {
              try { const r = await restoreBackup(f); toast(`Restored ${r.expenses} expenses`); location.reload(); } catch (e) { toast((e as Error).message, 'err'); }
            }}><Icon name="upload" size={18} />Restore</FilePick>
          </div>
          <p className="small muted">Tip: make a backup after each month-end and keep it in Google Drive or email it to yourself. Use it to move to a new phone.</p>
        </div>

        {!standalone && (
          <div className="card">
            <h2>Install on your phone</h2>
            {isIOS ? (
              <ol className="steps-list small">
                <li>Open this page in <b>Safari</b>.</li>
                <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</li>
                <li>Open “Expenses” from your home screen.</li>
              </ol>
            ) : (
              <ol className="steps-list small">
                <li>In <b>Chrome</b>, tap the ⋮ menu → <b>Install app</b> (or <b>Add to Home screen</b>).</li>
                <li>After installing, “Expenses” appears in the Android share menu – share receipts from Gmail straight into it.</li>
              </ol>
            )}
          </div>
        )}

        <div className="card small muted">
          <b>Privacy:</b> receipts are read on this phone (no cloud OCR). Only address lookups (OpenStreetMap) and exchange rates (Bank of Canada) use the internet, and they never include your receipts.
          <br />Version {__APP_VERSION__}
        </div>
      </div>
    </>
  );
}
