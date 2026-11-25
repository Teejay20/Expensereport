import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { attachmentsOf, db, deleteExpense, saveExpense, uid } from '../lib/db';
import { currentPosition, geocode, googleMapsUrl, renderRouteMap, reverseGeocode, route, type Place, type Route } from '../lib/maps';
import { compressForStorage } from '../lib/image';
import { fmtMoney, round2 } from '../lib/money';
import { todayISO } from '../lib/dates';
import { CATEGORIES, type Attachment, type Expense, type Settings } from '../lib/types';
import { AttachmentThumb, Confirm, Field, FilePick, Header, Icon, MoneyInput, useObjectUrl } from '../components/ui';
import { ReceiptViewer } from '../components/ReceiptPreview';
import { back, toast } from '../state';

interface Stop { text: string; place?: Place; options?: Place[]; busy?: boolean }
const MAX_STOPS = 6; // A + up to 4 stops + B
const COLORS = ['#188038', '#f29900', '#f29900', '#f29900', '#f29900', '#d93025'];

export function TripEditor({ id, settings }: { id?: string; settings: Settings }) {
  const [existing, setExisting] = useState<Expense>();
  const [date, setDate] = useState(todayISO());
  const [purpose, setPurpose] = useState('');
  const [category, setCategory] = useState('Travel');
  const [stops, setStops] = useState<Stop[]>([{ text: settings.homeAddress || '' }, { text: '' }]);
  const [roundTrip, setRoundTrip] = useState(false);
  const [rt, setRt] = useState<Route>();
  const [km, setKm] = useState('');
  const [rate, setRate] = useState(String(settings.kmRate));
  const [mapBlob, setMapBlob] = useState<Blob>();
  const [extra, setExtra] = useState<Attachment[]>([]);
  const [routing, setRouting] = useState(false);
  const [viewing, setViewing] = useState<Attachment>();
  const mapUrl = useObjectUrl(mapBlob);

  // Recent addresses from previous trips for quick fill
  const recent = useLiveQuery(async () => {
    const trips = await db.expenses.where('kind').equals('mileage').reverse().sortBy('updatedAt');
    const seen = new Map<string, Place | undefined>();
    for (const t of trips) t.mileage?.stops.forEach((s, i) => { if (!seen.has(s)) seen.set(s, t.mileage?.points?.[i]); });
    return [...seen.entries()].slice(0, 8);
  }, []);

  useEffect(() => {
    (async () => {
      if (!id || id === 'new') return;
      const e = await db.expenses.get(id);
      if (!e?.mileage) return back();
      setExisting(e);
      setDate(e.date);
      setPurpose(e.description);
      setCategory(e.category);
      setStops(e.mileage.stops.map((text, i) => ({ text, place: e.mileage!.points?.[i] })));
      setRoundTrip(e.mileage.roundTrip);
      setKm(String(e.mileage.distanceKm));
      setRate(String(e.mileage.ratePerKm));
      const atts = await attachmentsOf(e);
      const map = atts.find((a) => a.role === 'map' && a.name.startsWith('route-map'));
      if (map) setMapBlob(map.blob);
      setExtra(atts.filter((a) => a !== map));
    })();
  }, [id]);

  const update = (i: number, patch: Partial<Stop>) => setStops((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const invalidate = () => { setRt(undefined); };

  async function find(i: number) {
    const q = stops[i].text.trim();
    if (!q) return;
    update(i, { busy: true, options: undefined });
    try {
      const near = stops.find((s) => s.place)?.place;
      const res = await geocode(q, near);
      if (!res.length) toast(`No match for “${q}” – try adding the city`, 'err');
      if (res.length === 1) update(i, { place: res[0], busy: false });
      else update(i, { options: res, busy: false });
    } catch (e) {
      toast(`Address search failed: ${(e as Error).message}. Check your connection.`, 'err');
      update(i, { busy: false });
    }
  }

  async function useHere(i: number) {
    update(i, { busy: true });
    try {
      const pos = await currentPosition();
      const p = await reverseGeocode(pos.lat, pos.lon);
      update(i, { text: p.label.split(',').slice(0, 3).join(','), place: p, busy: false, options: undefined });
      invalidate();
    } catch (e) {
      toast((e as Error).message, 'err');
      update(i, { busy: false });
    }
  }

  async function calculate() {
    setRouting(true);
    try {
      const resolved: Place[] = [];
      for (let i = 0; i < stops.length; i++) {
        let p = stops[i].place;
        if (!p) {
          if (!stops[i].text.trim()) throw new Error(`Stop ${String.fromCharCode(65 + i)} is empty`);
          const res = await geocode(stops[i].text.trim(), resolved[0]);
          if (!res.length) throw new Error(`Couldn't find “${stops[i].text}”`);
          p = res[0];
          update(i, { place: p });
        }
        resolved.push(p);
      }
      const r = await route(resolved, roundTrip);
      setRt(r);
      setKm(r.distanceKm.toFixed(1));
      const blob = await renderRouteMap(r, resolved, { title: date });
      setMapBlob(blob);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setRouting(false);
    }
  }

  const kmN = parseFloat(km) || 0;
  const rateN = parseFloat(rate) || 0;
  const amount = round2(kmN * rateN);
  const gUrl = googleMapsUrl(stops.map((s) => s.text.trim()).filter(Boolean), roundTrip);

  async function save() {
    if (stops.some((s) => !s.text.trim())) return toast('Fill in every stop (or remove empty ones)', 'err');
    if (!(kmN > 0)) return toast('Calculate the route or enter the distance', 'err');
    const atts: Attachment[] = [];
    if (mapBlob) atts.push({ id: uid(), name: `route-map-${date}.jpg`, mime: 'image/jpeg', blob: mapBlob, role: 'map', createdAt: Date.now() });
    atts.push(...extra);
    const e: Expense = {
      id: existing?.id ?? uid(),
      kind: 'mileage',
      date,
      category,
      description: purpose.trim(),
      currency: settings.homeCurrency,
      preTax: amount,
      tax: 0,
      total: amount,
      mileage: {
        stops: stops.map((s) => s.text.trim()),
        points: stops.every((s) => s.place) ? stops.map((s) => s.place!) : undefined,
        distanceKm: kmN,
        routedKm: rt?.distanceKm ?? existing?.mileage?.routedKm,
        roundTrip,
        ratePerKm: rateN,
      },
      attachmentIds: atts.map((a) => a.id),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    if (existing) await db.attachments.bulkDelete(existing.attachmentIds.filter((x) => !atts.some((a) => a.id === x)));
    await saveExpense(e, atts.filter((a) => !existing?.attachmentIds.includes(a.id)));
    toast('Trip saved');
    back();
  }

  return (
    <>
      <Header title={existing ? 'Edit trip' : 'Log a car trip'} onBack={() => back()}
        right={existing && <Confirm className="icon-btn" text="Delete this trip?" onYes={async () => { await deleteExpense(existing.id); back(); }}><Icon name="trash" /></Confirm>} />
      <div className="page">
        <div className="card">
          <div className="grid2">
            <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Category">
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Purpose"><input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Supplier visit – Cambridge" /></Field>
        </div>

        <div className="card">
          <h2><Icon name="pin" size={18} />Route</h2>
          {stops.map((s, i) => (
            <div key={i} className="stop">
              <span className="stop-dot" style={{ background: i === stops.length - 1 ? COLORS[5] : COLORS[Math.min(i, 4)] }}>{String.fromCharCode(65 + i)}</span>
              <input className="input" value={s.text} list="recent-addr" placeholder={i === 0 ? 'Start address' : i === stops.length - 1 ? 'Destination' : 'Stop'}
                onChange={(e) => { const t = e.target.value; const known = recent?.find(([a]) => a === t)?.[1]; update(i, { text: t, place: known, options: undefined }); invalidate(); }}
                onBlur={() => { if (!stops[i].place && stops[i].text.trim().length > 4) find(i); }} />
              <div className="row">
                {i === 0 && <button className="icon-btn" aria-label="Use my location" onClick={() => useHere(i)}><Icon name="pin" /></button>}
                {stops.length > 2 && <button className="icon-btn" aria-label="Remove stop" onClick={() => { setStops((x) => x.filter((_, j) => j !== i)); invalidate(); }}><Icon name="x" /></button>}
              </div>
              {s.busy && <span className="stop-resolved muted">Searching…</span>}
              {s.place && !s.options && <span className="stop-resolved">✓ {s.place.label}</span>}
              {s.options && (
                <div className="suggest">
                  {s.options.map((o) => <button key={`${o.lat},${o.lon}`} onClick={() => { update(i, { place: o, options: undefined }); invalidate(); }}>{o.label}</button>)}
                </div>
              )}
            </div>
          ))}
          <datalist id="recent-addr">{recent?.map(([a]) => <option key={a} value={a} />)}</datalist>
          <div className="row wrap">
            {stops.length < MAX_STOPS && (
              <button className="btn sm" onClick={() => { setStops((x) => [...x.slice(0, -1), { text: '' }, x[x.length - 1]]); invalidate(); }}>
                <Icon name="plus" size={16} />Add stop ({MAX_STOPS - stops.length} left)
              </button>
            )}
            <label className="check small"><input type="checkbox" checked={roundTrip} onChange={(e) => { setRoundTrip(e.target.checked); invalidate(); }} />Round trip (back to A)</label>
          </div>
          <button className="btn primary block" style={{ marginTop: 10 }} disabled={routing} onClick={calculate}>
            <Icon name="map" size={18} />{routing ? 'Calculating…' : rt || mapBlob ? 'Recalculate route & map' : 'Calculate distance & map'}
          </button>
        </div>

        {mapUrl && (
          <div className="card">
            <img className="map-preview" src={mapUrl} alt="Route map" />
            <div className="small muted" style={{ marginTop: 6 }}>This map is added to your receipts PDF.</div>
          </div>
        )}

        <div className="card">
          <div className="grid2">
            <Field label="Distance (km)" hint={rt ? `Route: ${rt.distanceKm.toFixed(1)} km · ~${Math.round(rt.durationMin)} min` : 'Calculated, or type it'}>
              <MoneyInput value={km} onChange={setKm} placeholder="0.0" />
            </Field>
            <Field label="Rate ($/km)" hint="CRA rate (Settings)"><MoneyInput value={rate} onChange={setRate} /></Field>
          </div>
          <div className="kpi"><span>Reimbursement</span><b>{fmtMoney(amount, settings.homeCurrency)}</b></div>
        </div>

        <div className="card">
          <h2><Icon name="map" size={18} />Google Maps proof (optional)</h2>
          <p className="small muted" style={{ marginTop: 0 }}>If your company wants a Google Maps picture: open the route, take a screenshot, then attach it here.</p>
          <div className="row wrap">
            <a className="btn sm" href={gUrl} target="_blank" rel="noreferrer"><Icon name="map" size={16} />Open in Google Maps</a>
            <FilePick className="btn sm" accept="image/*" multiple onFiles={async (fs) => {
              const add = await Promise.all(fs.map(async (f) => ({ id: uid(), name: `google-maps-${f.name}`, mime: 'image/jpeg', blob: await compressForStorage(f), role: 'map' as const, createdAt: Date.now() })));
              setExtra((x) => [...x, ...add]);
            }}><Icon name="upload" size={16} />Attach screenshot</FilePick>
          </div>
          {extra.length > 0 && (
            <div className="thumbs" style={{ marginTop: 10 }}>
              {extra.map((a) => <AttachmentThumb key={a.id} a={a} onOpen={() => setViewing(a)} onRemove={() => setExtra((x) => x.filter((y) => y.id !== a.id))} />)}
            </div>
          )}
        </div>

        <div className="sticky-actions">
          <button className="btn" onClick={() => back()}>Cancel</button>
          <button className="btn primary" onClick={save}><Icon name="check" size={18} />Save trip</button>
        </div>
      </div>
      {viewing && <ReceiptViewer a={viewing} onClose={() => setViewing(undefined)} />}
    </>
  );
}
