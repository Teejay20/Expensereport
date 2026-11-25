// Builds the month-end report model shared by the Excel and PDF exporters.

import { lastDayOfMonth, MONTHS, monthKey, ordinal, toMDY } from './dates';
import { round2 } from './money';
import type { Expense, Settings } from './types';

export interface ReportRow {
  expense: Expense;
  dateMDY: string;
  category: string;
  description: string;
  preCAD: number;
  taxCAD?: number;
  totalCAD: number;
  receipt: 'Y' | 'N';
  foreign?: {
    currency: string;
    preTax: number;
    tax?: number;
    total: number;
    rate: number;
    converted: number;
    estimated: boolean;
  };
}

export interface ReportIssue {
  level: 'block' | 'warn';
  expenseId?: string;
  message: string;
}

export interface Report {
  month: string; // YYYY-MM
  sheetName: string; // "March 2026"
  title: string;
  nameLine: string;
  periodLine: string;
  emailLine: string;
  fileBase: string;
  rows: ReportRow[];
  totalCAD: number;
  issues: ReportIssue[];
}

export function deriveInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Me';
  if (parts.length === 1) return parts[0].replace(/[^A-Za-z0-9]/g, '');
  const first = parts[0][0].toUpperCase();
  const last = parts[parts.length - 1].replace(/[^A-Za-z0-9]/g, '');
  return first + last.charAt(0).toUpperCase() + last.slice(1);
}

export function fileBaseFor(settings: Settings, month: string): string {
  const [y, m] = month.split('-').map(Number);
  const initials = settings.fileInitials?.trim() || deriveInitials(settings.fullName);
  const lastDay = lastDayOfMonth(month);
  return (settings.fileNamePattern || 'ExpensesReimbursementForm_{initials}_{Month}_{YYYY}')
    .replace(/\{initials\}/g, initials)
    .replace(/\{Month\}/g, MONTHS[m - 1])
    .replace(/\{Mon\}/g, MONTHS[m - 1].slice(0, 3))
    .replace(/\{MM\}/g, String(m).padStart(2, '0'))
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(2))
    .replace(/\{DD\}/g, String(lastDay))
    .replace(/[\\/:*?"<>|]/g, '-');
}

export function mileageDescription(e: Expense, arrow = ' → '): string {
  const mi = e.mileage!;
  const short = (a: string) => a.split(',')[0].trim();
  const route = mi.stops.map(short).join(arrow) + (mi.roundTrip ? `${arrow}${short(mi.stops[0])}` : '');
  const base = e.description && !e.description.startsWith('Mileage') ? `${e.description} – ` : '';
  return `${base}Mileage ${route} (${mi.distanceKm.toFixed(1)} km @ $${mi.ratePerKm.toFixed(2)}/km)`;
}

/** CAD value for one expense, falling back to the reference estimate when the card amount is unknown. */
export function cadFor(e: Expense, home = 'CAD'): { pre: number; tax?: number; total: number; estimated: boolean; rate?: number } {
  if (e.kind === 'mileage' && e.mileage) {
    const v = round2(e.mileage.distanceKm * e.mileage.ratePerKm);
    return { pre: v, total: v, estimated: false };
  }
  if (e.currency === home) return { pre: round2(e.preTax), tax: e.tax ? round2(e.tax) : undefined, total: round2(e.preTax + (e.tax || 0)), estimated: false };
  if (e.cadCharged !== undefined) {
    return { pre: e.cadCharged, total: e.cadCharged, estimated: e.fxSource === 'estimate', rate: e.cadCharged / e.total };
  }
  if (e.fxReference) {
    const v = round2(e.total * e.fxReference);
    return { pre: v, total: v, estimated: true, rate: e.fxReference };
  }
  return { pre: 0, total: 0, estimated: true };
}

export function buildReport(all: Expense[], settings: Settings, month: string): Report {
  const [y, m] = month.split('-').map(Number);
  const monthName = MONTHS[m - 1];
  const expenses = all
    .filter((e) => monthKey(e.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const home = settings.homeCurrency || 'CAD';
  const issues: ReportIssue[] = [];
  if (!settings.fullName.trim()) issues.push({ level: 'block', message: 'Add your name in Settings' });
  if (!settings.interacEmail.trim()) issues.push({ level: 'warn', message: 'Add your Interac e-Transfer email in Settings' });

  const rows: ReportRow[] = expenses.map((e) => {
    const cad = cadFor(e, home);
    const isForeign = e.kind !== 'mileage' && e.currency !== home;
    if (isForeign && e.cadCharged === undefined) {
      issues.push({
        level: e.fxReference ? 'warn' : 'block',
        expenseId: e.id,
        message: `${e.description || e.merchant}: CAD amount charged on card is unknown${e.fxReference ? ' (using estimate)' : ''}`,
      });
    }
    if (isForeign && e.fxSource === 'estimate') {
      issues.push({ level: 'warn', expenseId: e.id, message: `${e.description}: uses an estimated exchange rate, not your card statement` });
    }
    if (!e.attachmentIds.length) {
      issues.push({ level: 'warn', expenseId: e.id, message: `${e.description || e.merchant || 'Expense'} on ${toMDY(e.date)} has no ${e.kind === 'mileage' ? 'map' : 'receipt'}` });
    }
    if (!(cad.total > 0)) issues.push({ level: 'block', expenseId: e.id, message: `${e.description || 'Expense'} on ${toMDY(e.date)} has no amount` });

    const row: ReportRow = {
      expense: e,
      dateMDY: toMDY(e.date),
      category: e.category,
      description: e.kind === 'mileage' ? mileageDescription(e) : e.description || e.merchant || '',
      preCAD: cad.pre,
      taxCAD: cad.tax,
      totalCAD: cad.total,
      receipt: e.attachmentIds.length ? 'Y' : 'N',
    };
    if (isForeign) {
      const rate = cad.rate ?? 0;
      row.foreign = {
        currency: e.currency,
        preTax: e.preTax,
        tax: e.tax || undefined,
        total: e.total,
        rate: Math.round(rate * 1e6) / 1e6,
        converted: cad.total,
        estimated: cad.estimated,
      };
    }
    return row;
  });

  const totalCAD = round2(rows.reduce((s, r) => s + r.totalCAD, 0));
  return {
    month,
    sheetName: `${monthName} ${y}`,
    title: 'Expenses Reimbursement Form',
    nameLine: `Name: ${settings.fullName}`,
    periodLine: `For the Period Ending 1st ${monthName} - ${ordinal(lastDayOfMonth(month))} ${monthName} ${y}`,
    emailLine: `Interact E-transfer Email: ${settings.interacEmail}`,
    fileBase: fileBaseFor(settings, month),
    rows,
    totalCAD,
    issues,
  };
}
