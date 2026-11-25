// Date helpers. Expense dates are stored as ISO "YYYY-MM-DD" strings (no timezone surprises).

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_LOOKUP: Record<string, number> = {};
MONTHS.forEach((m, i) => {
  MONTH_LOOKUP[m.toLowerCase()] = i + 1;
  MONTH_LOOKUP[m.slice(0, 3).toLowerCase()] = i + 1;
});
MONTH_LOOKUP['sept'] = 9;

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const iso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function todayISO(now = new Date()): string {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((isoToDate(b).getTime() - isoToDate(a).getTime()) / 86400000);
}

export function addDays(s: string, n: number): string {
  const d = isoToDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** "2026-03-02" → "03/02/2026" (format used in the reimbursement form) */
export function toMDY(s: string): string {
  const [y, m, d] = s.split('-');
  return `${m}/${d}/${y}`;
}

export const monthKey = (s: string) => s.slice(0, 7); // YYYY-MM

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function lastDayOfMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface DateCandidate {
  iso: string;
  index: number; // char offset in line
  length: number;
  ambiguous: boolean;
}

const y4 = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * Extract every plausible date from a line. Numeric dates can yield several
 * interpretations; `pickBest` uses recency to disambiguate.
 */
export function findDates(line: string, order: 'MDY' | 'DMY' = 'MDY'): DateCandidate[][] {
  const groups: DateCandidate[][] = [];
  const push = (cands: DateCandidate[]) => {
    const uniq = cands.filter((c, i, a) => a.findIndex((x) => x.iso === c.iso) === i);
    if (uniq.length) groups.push(uniq);
  };
  let m: RegExpExecArray | null;

  // 2026-03-11, 2026/03/11, 2026.03.11
  const reYMD = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = reYMD.exec(line))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (isValidYMD(y, mo, d)) push([{ iso: iso(y, mo, d), index: m.index, length: m[0].length, ambiguous: false }]);
  }

  // 03/11/2026, 11-03-2026, 03/17/26, 26/03/17
  const reNum = /(?<![\d/.-])(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?![\d/])/g;
  while ((m = reNum.exec(line))) {
    const a = +m[1], b = +m[2], c = +m[3];
    const four = m[3].length === 4;
    const cands: DateCandidate[] = [];
    const add = (y: number, mo: number, d: number) => {
      if (isValidYMD(y, mo, d)) cands.push({ iso: iso(y, mo, d), index: m!.index, length: m![0].length, ambiguous: false });
    };
    if (order === 'MDY') { add(y4(c), a, b); add(y4(c), b, a); } else { add(y4(c), b, a); add(y4(c), a, b); }
    if (!four) add(y4(a), b, c); // YY/MM/DD (common on parking/fuel receipts)
    if (cands.length > 1) cands.forEach((x) => (x.ambiguous = true));
    push(cands);
  }

  // Mar 2, 2026 | March 10, 2026 | Mar. 03, 2026 | MAR-17-2026 | Mar 11 (no year)
  const monthNames = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const reMDY = new RegExp(`\\b(${monthNames})\\.?[\\s-]*(\\d{1,2})(?:st|nd|rd|th)?(?:,?[\\s-]*(\\d{4}|'?\\d{2}))?\\b`, 'gi');
  while ((m = reMDY.exec(line))) {
    const mo = MONTH_LOOKUP[m[1].toLowerCase().replace('.', '')];
    const d = +m[2];
    if (!m[3]) continue; // year-less handled by statement parser
    const y = y4(+m[3].replace("'", ''));
    if (mo && isValidYMD(y, mo, d)) push([{ iso: iso(y, mo, d), index: m.index, length: m[0].length, ambiguous: false }]);
  }
  // 2 Mar 2026 | 02-MAR-2026
  const reDMY = new RegExp(`\\b(\\d{1,2})[\\s-]*(${monthNames})\\.?,?[\\s-]*(\\d{4})\\b`, 'gi');
  while ((m = reDMY.exec(line))) {
    const mo = MONTH_LOOKUP[m[2].toLowerCase()];
    const d = +m[1], y = +m[3];
    if (mo && isValidYMD(y, mo, d)) push([{ iso: iso(y, mo, d), index: m.index, length: m[0].length, ambiguous: false }]);
  }
  return groups;
}

/** Choose the interpretation closest to "now" in the past (receipts are rarely future-dated). */
export function pickByRecency(cands: DateCandidate[], today: string): DateCandidate {
  return [...cands].sort((a, b) => recencyPenalty(a.iso, today) - recencyPenalty(b.iso, today))[0];
}

export function recencyPenalty(d: string, today: string): number {
  const diff = daysBetween(d, today); // positive = past
  if (diff < -2) return 10000 + Math.abs(diff); // future
  return Math.abs(diff);
}

/** Month/day without year, e.g. "MAR 11" or "03/11" – used for card statements. */
export function findMonthDay(line: string): { month: number; day: number; index: number }[] {
  const out: { month: number; day: number; index: number }[] = [];
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b(?![,:]?\s*\d{4})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    out.push({ month: MONTH_LOOKUP[m[1].toLowerCase()], day: +m[2], index: m.index });
  }
  const re2 = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b(?!\s*\d{4})/gi;
  while ((m = re2.exec(line))) {
    out.push({ month: MONTH_LOOKUP[m[2].toLowerCase()], day: +m[1], index: m.index });
  }
  out.sort((a, b) => a.index - b.index);
  // "MAR 10 MAR 11" also contains "10 MAR" – drop matches overlapping an earlier one
  const kept: typeof out = [];
  for (const m of out) if (!kept.length || m.index >= kept[kept.length - 1].index + 5) kept.push(m);
  return kept;
}
