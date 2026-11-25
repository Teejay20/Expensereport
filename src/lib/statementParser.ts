// Parses credit-card statement text (PDF text layer or OCR) into transactions,
// then matches foreign-currency expenses to the CAD amount actually charged.

import { findAmounts, round2 } from './money';
import { daysBetween, findDates, findMonthDay, iso, isValidYMD } from './dates';
import { KNOWN_CURRENCIES } from './receiptParser';
import type { Expense } from './types';

export interface StatementTxn {
  date: string; // transaction date (ISO)
  description: string;
  amountCAD: number;
  foreignAmount?: number;
  foreignCurrency?: string;
  rate?: number;
  raw: string;
}

const CUR_RE = new RegExp(`\\b(${KNOWN_CURRENCIES.filter((c) => c !== 'CAD').join('|')})\\b`);
const FOREIGN_RE = new RegExp(
  `(?:(${KNOWN_CURRENCIES.join('|')})\\s*\\$?\\s*(\\d[\\d,]*\\.\\d{2})|(\\d[\\d,]*\\.\\d{2})\\s*(${KNOWN_CURRENCIES.join('|')}))(?:.*?(?:@|rate|exchange rate|taux)\\s*[:-]?\\s*(\\d+\\.\\d{2,8}))?`,
  'i',
);

/**
 * @param yearHint year of the statement period, used for "MAR 11" style dates.
 * @param monthHint month (1-12) of the statement, to roll "DEC 30" back a year in a January statement.
 */
export function parseStatement(text: string, yearHint: number, monthHint?: number): StatementTxn[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const txns: StatementTxn[] = [];

  const resolveYear = (month: number) => {
    if (monthHint && month > monthHint + 1) return yearHint - 1; // Dec item on a Jan statement
    return yearHint;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // --- date at (or near) the start of the line
    let date: string | undefined;
    let dateEnd = 0;
    const md = findMonthDay(line);
    if (md.length && md[0].index < 12) {
      const y = resolveYear(md[0].month);
      if (isValidYMD(y, md[0].month, md[0].day)) {
        date = iso(y, md[0].month, md[0].day);
        const last = md.length > 1 && md[1].index < 20 ? md[1] : md[0];
        dateEnd = last.index + 6;
      }
    }
    if (!date) {
      const full = findDates(line);
      if (full.length && full[0][0].index < 12) {
        date = full[0][0].iso;
        dateEnd = full[0][0].index + full[0][0].length;
        if (full[1] && full[1][0].index < 25) dateEnd = full[1][0].index + full[1][0].length; // posting date
      } else {
        // 03/11 or 03-11 (no year)
        const m = /^(\d{1,2})[/-](\d{1,2})\b(?![/-]\d)/.exec(line);
        if (m) {
          const y = resolveYear(+m[1]);
          if (isValidYMD(y, +m[1], +m[2])) { date = iso(y, +m[1], +m[2]); dateEnd = m[0].length; }
          const m2 = /^\s*(\d{1,2})[/-](\d{1,2})\b/.exec(line.slice(dateEnd));
          if (m2) dateEnd += m2[0].length;
        }
      }
    }
    if (!date) continue;

    const rest = line.slice(dateEnd);
    const amounts = findAmounts(rest);
    if (!amounts.length) continue;
    if (/\b(payment|paiement|thank you|merci|credit|interest|annual fee|balance)\b/i.test(rest) && !/foreign|usd|eur/i.test(rest)) {
      if (/\bpayment\b|thank you|balance/i.test(rest)) continue;
    }
    if (/CR\b|-\s*$/.test(rest)) continue; // credits/refunds

    const amt = amounts[amounts.length - 1];
    const description = rest.slice(0, amt.index).replace(/\s{2,}/g, ' ').trim();
    const txn: StatementTxn = { date, description, amountCAD: Math.abs(amt.value), raw: line };

    // Foreign info may be on the same line or the next 1–2 lines.
    for (const probe of [description, lines[i + 1] || '', lines[i + 2] || '']) {
      if (probe !== description && (findMonthDay(probe).some((d) => d.index < 12) || /^\d{1,2}[/-]\d{1,2}/.test(probe))) break;
      const f = FOREIGN_RE.exec(probe);
      if (f && CUR_RE.test(probe)) {
        const code = (f[1] || f[4]).toUpperCase();
        if (code === 'CAD') continue;
        const val = parseFloat((f[2] || f[3]).replace(/,/g, ''));
        txn.foreignCurrency = code;
        txn.foreignAmount = val;
        txn.rate = f[5] ? parseFloat(f[5]) : round2((txn.amountCAD / val) * 10000) / 10000;
        break;
      }
    }
    txns.push(txn);
  }
  return dedupe(txns);
}

function dedupe(t: StatementTxn[]): StatementTxn[] {
  const seen = new Set<string>();
  return t.filter((x) => {
    const k = `${x.date}|${x.amountCAD}|${x.description.slice(0, 12)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Rough sanity ranges (CAD per unit) used only when no reference rate is available. */
const APPROX_RATE: Record<string, number> = {
  USD: 1.38, EUR: 1.5, GBP: 1.75, INR: 0.0165, JPY: 0.0093, CNY: 0.19, AUD: 0.9, MXN: 0.075,
  CHF: 1.6, HKD: 0.177, SGD: 1.03, NZD: 0.82, SEK: 0.13, NOK: 0.13, DKK: 0.2, KRW: 0.001,
};

export interface MatchCandidate {
  txn: StatementTxn;
  score: number; // 0..1
  impliedRate: number;
  reason: string;
}

export function matchExpense(e: Pick<Expense, 'date' | 'currency' | 'total' | 'merchant' | 'description'>, txns: StatementTxn[], refRate?: number): MatchCandidate[] {
  const ref = refRate || APPROX_RATE[e.currency];
  const out: MatchCandidate[] = [];
  for (const t of txns) {
    const lag = daysBetween(e.date, t.date); // card posts same day or a few days later
    if (lag < -3 || lag > 10) continue;
    const implied = t.amountCAD / e.total;
    let score = 0;
    let reason = '';
    if (t.foreignAmount !== undefined && Math.abs(t.foreignAmount - e.total) < 0.015 && (!t.foreignCurrency || t.foreignCurrency === e.currency)) {
      score = 0.95;
      reason = `Statement shows ${t.foreignCurrency ?? ''} ${t.foreignAmount.toFixed(2)}`;
    } else if (ref) {
      const err = Math.abs(implied - ref) / ref;
      if (err > (refRate ? 0.06 : 0.2)) continue;
      score = 0.75 - err * (refRate ? 5 : 1.5);
      reason = `Implied rate ${implied.toFixed(4)} ≈ reference ${ref.toFixed(4)}`;
    } else continue;
    const nameHint = (e.merchant || e.description || '').toLowerCase().split(/\s+/)[0];
    if (nameHint && nameHint.length > 2 && t.description.toLowerCase().includes(nameHint)) score += 0.1;
    score -= Math.max(0, Math.abs(lag) - 2) * 0.02;
    out.push({ txn: t, score: Math.max(0, Math.min(1, score)), impliedRate: implied, reason });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Greedy one-to-one assignment so two receipts never claim the same card line.
 */
export function matchAll<E extends Pick<Expense, 'id' | 'date' | 'currency' | 'total' | 'merchant' | 'description'>>(
  expenses: E[],
  txns: StatementTxn[],
  refRates: Record<string, number | undefined> = {},
): Map<string, MatchCandidate> {
  const all: { id: string; c: MatchCandidate }[] = [];
  for (const e of expenses) for (const c of matchExpense(e, txns, refRates[e.id])) all.push({ id: e.id, c });
  all.sort((a, b) => b.c.score - a.c.score);
  const used = new Set<StatementTxn>();
  const res = new Map<string, MatchCandidate>();
  for (const { id, c } of all) {
    if (res.has(id) || used.has(c.txn) || c.score < 0.3) continue;
    res.set(id, c);
    used.add(c.txn);
  }
  return res;
}
