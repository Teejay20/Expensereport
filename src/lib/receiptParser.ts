// Turns raw receipt text (from OCR or a PDF text layer) into structured fields.
// Pure & deterministic so it can be unit-tested against real receipts.

import { findAmounts, lastAmount, round2 } from './money';
import { findDates, pickByRecency, recencyPenalty, todayISO } from './dates';
import { inferCategory, OPERATOR_LINES, recognizeMerchant } from './categories';

export interface ParsedReceipt {
  merchant?: string;
  category?: string;
  date?: string;
  currency: string;
  currencyConfident: boolean;
  subtotal?: number;
  tax?: number;
  total?: number;
  taxLines: { label: string; amount: number }[];
  /** Fields the user should double check. */
  warnings: string[];
}

export interface ParseOptions {
  homeCurrency?: string;
  today?: string;
  dateOrder?: 'MDY' | 'DMY';
}

export const KNOWN_CURRENCIES = [
  'CAD', 'USD', 'EUR', 'GBP', 'INR', 'JPY', 'CNY', 'AUD', 'MXN', 'CHF', 'HKD', 'SGD',
  'NZD', 'SEK', 'NOK', 'DKK', 'KRW', 'BRL', 'ZAR', 'AED', 'TWD', 'THB', 'PLN', 'CZK', 'TRY', 'ILS',
];

const SYMBOLS: [RegExp, string][] = [
  [/(?:US\$|USD\s?\$)/, 'USD'],
  [/(?:C\$|CA\$|CAD\s?\$)/, 'CAD'],
  [/(?:A\$|AU\$)/, 'AUD'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/₹|\bRs\.?\s?\d/, 'INR'],
  [/¥|円/, 'JPY'],
  [/₩/, 'KRW'],
];

/** Pre-clean OCR noise that hurts parsing. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    // "T O T A L" → "TOTAL"
    .replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, (s) => s.replace(/ /g, ''))
    // "$ 21.70" / "$21 .70" → "$21.70"
    .replace(/(\d)\s+\.(\d{2})\b/g, '$1.$2')
    // OCR often reads "$" as "S" before digits: "S21.70"
    .replace(/(^|\s)S(\d+\.\d{2})\b/g, '$1$$$2')
    // "H.S.T." / "G.S.T." → "HST" / "GST"
    .replace(/\b([HGPQ])\.\s?S\.\s?T\.?/gi, (_, a) => `${a.toUpperCase()}ST`)
    .replace(/\t/g, '   ')
    .replace(/ {4,}/g, '   ');
}

export function detectCurrency(text: string, home = 'CAD'): { code: string; confident: boolean } {
  const score: Record<string, number> = {};
  const add = (c: string, n: number) => (score[c] = (score[c] || 0) + n);
  const codeRe = new RegExp(`\\b(${KNOWN_CURRENCIES.join('|')})\\b`, 'g');
  for (const line of text.split('\n')) {
    let m: RegExpExecArray | null;
    codeRe.lastIndex = 0;
    while ((m = codeRe.exec(line))) {
      const near = line.slice(Math.max(0, m.index - 12), m.index + 16);
      const nextToAmount = findAmounts(near).length > 0;
      const inParens = /\(\s*[A-Z]{3}\s*\)/.test(near);
      add(m[1], nextToAmount || inParens ? 3 : 1);
    }
    for (const [re, code] of SYMBOLS) {
      // A symbol only counts when it is attached to a number (avoids OCR noise like "€ED" from status-bar icons).
      const src = re.source;
      const attached = new RegExp(`(?:${src})\\s?\\d|\\d[\\d.,]*\\s?(?:${src})`);
      if (attached.test(line)) add(code, 3);
    }
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 3) return { code: best[0], confident: true };
  if (best) return { code: best[0], confident: false };

  // Only "$": look at address hints.
  const canadian = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d\b/.test(text) ||
    /\b(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE)\b|\b(HST|GST|PST|QST|TPS|TVQ)\b/.test(text);
  const american = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}(-\d{4})?\b/.test(text);
  if (american && !canadian) return { code: 'USD', confident: false };
  return { code: home, confident: !american };
}

const TOTAL_EXCLUDE = /sub\s?-?total|total\s+(savings|saved|items?|qty|quantity|discount|tax|points)|you\s+saved|before\s+tax|pre-?tax/i;
const TOTAL_STRONG = /grand\s+total|order\s+total|total\s+(due|paid|charged|amount)|amount\s+(due|paid|charged)|balance\s+due|invoice\s+total|debit\s+total/i;
const TOTAL_WEAK = /\btotal\b|\btot\b/i;
const TOTAL_FALLBACK = /\b(amount|fee|purchase|m\/c tend|visa|mastercard|amex|debit|paid|charged|payment)\b/i;
const SUBTOTAL = /sub\s?-?total|sub\/sous|\bsous[- ]total|\bpass:|\bfare\b|amount\s+before\s+tax|\bnet\s*:/i;
/** GST 5, HST 13/15, QC 14.975, BC 12, SK 11, MB 12, PST-only 6/7/9.975 */
const TAX_RATES = [5, 6, 7, 9.975, 11, 12, 13, 14.975, 15];
/** Distance (in % points) between the receipt's tax rate and the nearest real rate. */
export const taxRateError = (tax: number, total: number) => Math.min(...TAX_RATES.map((r) => Math.abs((tax / (total - tax)) * 100 - r)));
const TAX_LABEL = /\b(HST|H[S5]|H5T|GST|PST|QST|RST|TPS|TVQ|TVH|VAT|IVA|MWST|GST\/HST|tax(?:es)?|sales\s+tax)\b/i;
const TAX_EXCLUDE = /pre-?tax|tax\s*(id|no\.?|number|reg|registration|#)|business\s+number|(hst|gst|qst|tps|tvq)\s*(#|no\.?|number|reg)|incl\.?\s*tax|tax\s+included|calculated\s+pre-tax|before\s+tax|tax\s+exempt/i;

function linesOf(text: string) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Amount appearing after a label on the same line (or on the next line if the label line has none). */
function amountForLabel(lines: string[], i: number, labelRe: RegExp): number | undefined {
  const line = lines[i];
  const m = labelRe.exec(line);
  const after = m ? line.slice(m.index) : line;
  const hits = findAmounts(after);
  if (hits.length) return hits[0].value;
  // label alone on its line (e.g. "Tax/VAT" ... "CAD $5.07" next line)
  if (i + 1 < lines.length && findAmounts(lines[i + 1]).length && !/[a-z]{2,}/i.test(lines[i + 1].replace(/\b(CAD|USD|EUR|GBP)\b|\/mo\b/g, ''))) {
    return findAmounts(lines[i + 1])[0].value;
  }
  return undefined;
}

export function parseReceipt(rawText: string, opts: ParseOptions = {}): ParsedReceipt {
  const home = opts.homeCurrency || 'CAD';
  const today = opts.today || todayISO();
  const text = normalizeText(rawText);
  const lines = linesOf(text);
  const warnings: string[] = [];

  // ---- Merchant / category
  const rule = recognizeMerchant(text);
  let merchant = rule?.name;
  if (!merchant) {
    merchant = lines
      .slice(0, 8)
      .map((l) => l.split(/\s{3,}/)[0]) // drop right-hand columns ("REGIONAL HOSE   Remit To: …")
      .find((l) => /[a-z]{3,}/i.test(l) && !OPERATOR_LINES.test(l) && !/receipt|invoice|welcome|thank|customer|copy|total|remit|\d{1,2}[/:]\d{2}|www\.|@|gmail|page \d/i.test(l) && !findAmounts(l).length)
      ?.replace(/[^\w &'.-]/g, '')
      .replace(/\s+\w$/, '') // stray OCR letter at the end
      .trim()
      .split(/\s+/).slice(0, 5).join(' ')
      .slice(0, 40);
  }
  const category = rule?.category ?? inferCategory(text);

  // ---- Currency
  const cur = detectCurrency(text, home);

  // ---- Totals
  let total: number | undefined;
  let totalGuessed = false;
  const strong: number[] = [];
  const weak: number[] = [];
  lines.forEach((l, i) => {
    if (TOTAL_EXCLUDE.test(l)) return;
    if (TOTAL_STRONG.test(l)) {
      const v = amountForLabel(lines, i, TOTAL_STRONG);
      if (v !== undefined && v > 0) strong.push(v);
    } else if (TOTAL_WEAK.test(l)) {
      const v = amountForLabel(lines, i, TOTAL_WEAK);
      if (v !== undefined && v > 0) weak.push(v);
    }
  });
  if (strong.length) total = Math.max(...strong);
  else if (weak.length) total = Math.max(...weak);
  else {
    const fb = lines.filter((l) => TOTAL_FALLBACK.test(l)).map(lastAmount).filter((v): v is number => !!v && v > 0);
    if (fb.length) total = Math.max(...fb);
    else {
      const all = lines.flatMap((l) => findAmounts(l).map((a) => a.value)).filter((v) => v > 0);
      if (all.length) {
        total = Math.max(...all);
        totalGuessed = true;
        warnings.push('Total guessed as the largest amount');
      }
    }
  }

  // ---- Subtotal
  let subtotal: number | undefined;
  lines.forEach((l, i) => {
    if (subtotal !== undefined) return;
    if (SUBTOTAL.test(l)) {
      const v = amountForLabel(lines, i, SUBTOTAL);
      if (v !== undefined && (!total || v <= total)) subtotal = v;
    }
  });

  // ---- Tax lines
  const taxLines: { label: string; amount: number }[] = [];
  let totalTaxLine: number | undefined;
  lines.forEach((l, i) => {
    if (TAX_EXCLUDE.test(l)) {
      // "HST R135299063 13% .78" has a reg number *and* an amount; allow if a decimal amount follows
      if (!/(hst|gst|tax)\s+r?\d{6,}.*\d?\.\d{2}\b/i.test(l)) return;
    }
    const m = TAX_LABEL.exec(l);
    if (!m) return;
    if (/\btotal\b/i.test(l) && !/total\s+tax|tax\s+total/i.test(l)) return; // "Total incl. tax"
    const v = amountForLabel(lines, i, TAX_LABEL);
    if (v === undefined || v < 0) return;
    if (total && v >= total) return; // tax can't exceed total
    if (/total\s+tax|tax\s+total|total\s+taxes/i.test(l)) { totalTaxLine = v; return; }
    const label = m[1].toUpperCase();
    if (!taxLines.some((t) => t.label === label)) taxLines.push({ label, amount: v });
  });
  const taxTmp: number | undefined = totalTaxLine ?? (taxLines.length ? round2(taxLines.reduce((s, t) => s + t.amount, 0)) : undefined);
  // No readable total line: the guess is probably the subtotal. If subtotal+tax appears (even with a
  // dropped last digit, e.g. "$ 81.3"), use it.
  if (totalGuessed && total !== undefined && taxTmp) {
    const sum = round2(total + taxTmp);
    const compact = text.replace(/\s/g, '');
    if (compact.includes(sum.toFixed(2)) || compact.includes(sum.toFixed(2).slice(0, -1))) {
      subtotal = total;
      total = sum;
      warnings.splice(warnings.indexOf('Total guessed as the largest amount'), 1, 'Total = subtotal + tax (total line unclear)');
    }
  }
  let tax: number | undefined = totalTaxLine ?? (taxLines.length ? round2(taxLines.reduce((s, t) => s + t.amount, 0)) : undefined);

  // Reconcile with subtotal/total
  if (total !== undefined && subtotal !== undefined) {
    const implied = round2(total - subtotal);
    if (tax === undefined && implied >= 0 && implied <= total * 0.3) {
      // Only infer tax when a tax keyword exists somewhere – otherwise the gap may be tip/fees.
      if (TAX_LABEL.test(text)) tax = implied;
    }
  }
  if (total === undefined && subtotal !== undefined) total = round2(subtotal + (tax ?? 0));
  if (tax !== undefined && total !== undefined && tax > total * 0.35) {
    warnings.push('Tax looked too high – please check');
    tax = undefined;
  }
  // OCR digit slip in the tax line (3.06 read as 3.00) while subtotal & total agree → trust total − subtotal
  if (subtotal !== undefined && tax && total !== undefined && Math.abs(subtotal + tax - total) > 0.02) {
    const implied = round2(total - subtotal);
    // Which reading is right? The one whose rate matches a real Canadian sales-tax rate.
    const rateErr = (t: number) => taxRateError(t, total!);
    if (implied > 0 && implied <= total * 0.3 && Math.abs(implied - tax) < 1 && rateErr(implied) < rateErr(tax) && rateErr(implied) < 0.15) tax = implied;
  }
  if (subtotal !== undefined && tax && total !== undefined && Math.abs(subtotal + tax - total) > 0.02) {
    warnings.push(`Subtotal ${subtotal.toFixed(2)} + tax ${tax.toFixed(2)} ≠ total ${total.toFixed(2)} – check the total`);
    subtotal = round2(total - tax); // what the report uses anyway
  }
  if (tax && total !== undefined && taxRateError(tax, total) > 0.15 && !warnings.some((w) => w.includes('≠'))) {
    // e.g. 3.00 on 26.56 = 12.7 % – likely an OCR slip (or a partly tax-exempt purchase)
    warnings.push(`Tax ${tax.toFixed(2)} isn't a usual rate – check`);
  }
  if (subtotal === undefined && total !== undefined) subtotal = round2(total - (tax ?? 0));

  // ---- Date
  const date = pickReceiptDate(lines, today, opts.dateOrder || 'MDY');
  if (!date) warnings.push('Date not found');
  if (total === undefined) warnings.push('Total not found');
  if (!cur.confident) warnings.push(`Currency assumed ${cur.code}`);

  return {
    merchant,
    category,
    date,
    currency: cur.code,
    currencyConfident: cur.confident,
    subtotal,
    tax: tax ?? 0,
    total,
    taxLines,
    warnings,
  };
}

const DATE_KEYWORD = /\b(date|purchase|purchased|ordered|order date|invoice date|transaction|trans|txn|time|paid|issued|billing|charged|en:|ex:)\b/i;
const PRINT_STAMP = /^\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}\s*[AP]M\b/i; // browser print header

export function pickReceiptDate(lines: string[], today: string, order: 'MDY' | 'DMY'): string | undefined {
  interface Scored { iso: string; score: number }
  const scored: Scored[] = [];
  lines.forEach((line, li) => {
    const groups = findDates(line, order);
    for (const g of groups) {
      const best = pickByRecency(g, today);
      let score = 0;
      if (DATE_KEYWORD.test(line)) score += 3;
      if (/ship|due|expir|valid|until|end time|ex:|trial ends|renew/i.test(line)) score -= 2;
      if (li === 0 && PRINT_STAMP.test(line)) score -= 6;
      if (/^https?:|mail\.google/.test(line)) score -= 6;
      const pen = recencyPenalty(best.iso, today);
      if (pen >= 10000) score -= 8; // future
      else if (pen > 400) score -= 3;
      if (best.ambiguous) score -= 0.5;
      score -= li * 0.01; // earlier lines slightly preferred
      scored.push({ iso: best.iso, score });
    }
  });
  if (!scored.length) return undefined;
  // Combine repeated dates
  const agg = new Map<string, number>();
  for (const s of scored) agg.set(s.iso, Math.max(agg.get(s.iso) ?? -Infinity, s.score) + (agg.has(s.iso) ? 0.5 : 0));
  return [...agg.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Several separate invoices (each with its own tax line and a different total), not one document over several pages. */
function separateInvoices(ps: ParsedReceipt[]): boolean {
  const totals = ps.map((p) => p.total!.toFixed(2));
  return ps.every((p) => (p.tax ?? 0) > 0) && new Set(totals).size === totals.length;
}

const PAYMENT_SLIP = /\b(approved|approval|auth(orization)?\.?\s*(#|code)?|appr\s+code|visa|mastercard|master card|amex|debit|interac|chip|tap|card\s*#|customer copy|cardholder)\b/i;

/**
 * Combine several pages/photos belonging to one expense, e.g. a card slip plus the invoices it paid.
 * - If invoice totals add up to the card payment, tax = sum of invoice taxes.
 * - Otherwise the largest total wins and tax comes from the page with that total.
 */
export function combineReceipts(pages: { parsed: ParsedReceipt; text: string }[]): ParsedReceipt {
  const valid = pages.filter((p) => p.parsed.total !== undefined && p.parsed.total > 0);
  if (pages.length === 1 || valid.length <= 1) {
    const base = valid[0]?.parsed ?? pages[0]?.parsed;
    const others = pages.map((p) => p.parsed);
    return {
      ...base,
      merchant: base.merchant ?? others.find((o) => o.merchant)?.merchant,
      category: base.category ?? others.find((o) => o.category)?.category,
      date: base.date ?? others.find((o) => o.date)?.date,
    };
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.02 * Math.max(1, pages.length);
  const slips = valid.filter((p) => !p.parsed.tax && PAYMENT_SLIP.test(p.text));
  const invoices = valid.filter((p) => !slips.includes(p));
  const invTotal = round2(invoices.reduce((s, p) => s + (p.parsed.total ?? 0), 0));
  const invTax = round2(invoices.reduce((s, p) => s + (p.parsed.tax ?? 0), 0));
  const slip = slips.sort((a, b) => (b.parsed.total ?? 0) - (a.parsed.total ?? 0))[0];
  const first = (k: 'merchant' | 'category' | 'date' | 'currency') =>
    (slip?.parsed[k] as string | undefined) ?? valid.map((p) => p.parsed[k]).find(Boolean) as string | undefined;
  const warnings: string[] = [];

  let total: number, tax: number;
  if (slip && invoices.length && close(slip.parsed.total!, invTotal)) {
    total = slip.parsed.total!;
    tax = invTax;
  } else if (!slip && invoices.length > 1 && separateInvoices(invoices.map((p) => p.parsed))) {
    total = invTotal; // several invoices, no payment slip: add them up
    tax = invTax;
    warnings.push(`Added up ${invoices.length} receipts`);
  } else {
    // One receipt split over pages (e.g. an email): largest total, preferring the page that shows the tax
    const top = [...valid].sort((a, b) => (b.parsed.total ?? 0) - (a.parsed.total ?? 0) || (b.parsed.tax ?? 0) - (a.parsed.tax ?? 0))[0];
    total = top.parsed.total!;
    tax = top.parsed.tax ?? 0;
    if (invoices.length && slip) warnings.push(`Invoices add up to ${invTotal.toFixed(2)}, payment was ${total.toFixed(2)} – check tax`);
  }
  // Prefer the latest invoice/slip date for the expense date (when it was paid)
  const dates = valid.map((p) => p.parsed.date).filter((d): d is string => !!d).sort();
  return {
    merchant: first('merchant'),
    category: first('category'),
    date: slip?.parsed.date ?? dates[dates.length - 1],
    currency: first('currency') ?? 'CAD',
    currencyConfident: valid.every((p) => p.parsed.currencyConfident),
    total,
    tax,
    subtotal: round2(total - tax),
    taxLines: invoices.flatMap((p) => p.parsed.taxLines),
    warnings,
  };
}
