// Reference exchange rates (free, no key): Bank of Canada Valet API, ECB (Frankfurter) fallback.
// Used only as an estimate / sanity check — the card statement amount is what gets reimbursed.
import { addDays } from './dates';

const cacheKey = (cur: string, date: string) => `fx:${cur}:${date}`;

function readCache(k: string): number | undefined {
  try {
    const v = localStorage.getItem(k);
    return v ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}
function writeCache(k: string, v: number) {
  try { localStorage.setItem(k, String(v)); } catch { /* ignore */ }
}

export async function referenceRate(currency: string, date: string, home = 'CAD'): Promise<{ rate: number; source: string } | undefined> {
  if (currency === home) return { rate: 1, source: 'same currency' };
  const k = cacheKey(currency, date);
  const cached = readCache(k);
  if (cached) return { rate: cached, source: 'Bank of Canada (cached)' };

  if (home === 'CAD') {
    try {
      const url = `https://www.bankofcanada.ca/valet/observations/FX${currency}CAD/json?start_date=${addDays(date, -7)}&end_date=${date}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const obs = (j.observations as Record<string, { v: string }>[]) || [];
        const last = obs[obs.length - 1]?.[`FX${currency}CAD`]?.v;
        if (last) {
          const rate = Number(last);
          writeCache(k, rate);
          return { rate, source: 'Bank of Canada' };
        }
      }
    } catch { /* fall through */ }
  }
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=${home}`);
    if (r.ok) {
      const j = await r.json();
      const rate = j.rates?.[home];
      if (rate) {
        writeCache(k, rate);
        return { rate, source: 'European Central Bank' };
      }
    }
  } catch { /* offline */ }
  return undefined;
}
