export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtMoney(n: number | undefined, currency = 'CAD'): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export interface AmountHit {
  value: number;
  index: number; // position in the line
  raw: string;
}

/**
 * Finds money-looking numbers in a line: requires exactly two decimals
 * ("12.34", "1,234.56", ".78", "12,34" European). Percentages are skipped.
 */
export function findAmounts(line: string): AmountHit[] {
  const out: AmountHit[] = [];
  const re = /(?<![\d.,])(-?)(\d{1,3}(?:[, ]\d{3})+|\d+)?([.,])(\d{2})(?![\d%])(?!\s?%)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const [raw, sign, intPartRaw = '', sep, dec] = m;
    if (!intPartRaw && sep === ',') continue; // ",50" is not money
    let intPart = intPartRaw;
    if (sep === ',') {
      // European decimal comma: only accept when integer part has no grouping
      if (/[, ]/.test(intPart)) continue;
    } else {
      intPart = intPart.replace(/[, ]/g, '');
    }
    // Skip things like phone numbers / long ids: 1234567.89 is fine but 10+ digits isn't money
    if (intPart.length > 7) continue;
    const value = parseFloat(`${sign}${intPart || '0'}.${dec}`);
    if (Number.isFinite(value)) out.push({ value, index: m.index, raw });
  }
  return out;
}

export const lastAmount = (line: string) => {
  const a = findAmounts(line);
  return a.length ? a[a.length - 1].value : undefined;
};
