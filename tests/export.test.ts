import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { buildReport, deriveInitials, fileBaseFor } from '../src/lib/report';
import { exportXlsx } from '../src/lib/export/xlsx';
import { exportPdf } from '../src/lib/export/pdf';
import { DEFAULT_SETTINGS, type Expense, type Settings } from '../src/lib/types';

const settings: Settings = { ...DEFAULT_SETTINGS, fullName: 'Alex Doe', interacEmail: 'user@example.com' };

let n = 0;
const ex = (p: Partial<Expense>): Expense => ({
  id: `e${++n}`, kind: 'receipt', date: '2026-03-01', category: 'Travel', description: '', currency: 'CAD',
  preTax: 0, tax: 0, total: 0, attachmentIds: ['a'], createdAt: n, updatedAt: n, ...p,
});

// Mirrors the March 2026 sample form
export const MARCH: Expense[] = [
  ex({ date: '2026-03-02', description: 'Uber', preTax: 28.73, total: 28.73 }),
  ex({ date: '2026-03-03', category: 'Office', description: 'Adobe', preTax: 38.99, tax: 5.07, total: 44.06 }),
  ex({ date: '2026-03-11', category: 'Engineering/R&D', description: 'Misumi_Coating head', currency: 'USD', preTax: 26.04, total: 26.04, cadCharged: 36.33, fxSource: 'statement' }),
  ex({ date: '2026-03-13', category: 'Travel', description: 'UW parking', preTax: 5.48, tax: 0.71, total: 6.19 }),
  ex({ date: '2026-03-20', kind: 'mileage', description: 'Client visit', mileage: { stops: ['265 Main Dr, Waterloo, ON', '27 Jarvis St, Cambridge, ON'], distanceKm: 29, roundTrip: true, ratePerKm: 0.73 } }),
  ex({ date: '2026-03-25', category: 'Engineering/R&D', description: 'Supplier', currency: 'EUR', preTax: 10, tax: 2, total: 12, fxReference: 1.5 }),
  ex({ date: '2026-02-27', description: 'other month' }),
];

describe('naming', () => {
  it('derives initials like the sample (JSmith)', () => {
    expect(deriveInitials('Jane Smith')).toBe('JSmith');
    expect(deriveInitials('mary ann smith')).toBe('MSmith');
  });
  it('matches the sample file name', () => {
    expect(fileBaseFor({ ...settings, fullName: 'Jane Smith' }, '2026-03')).toBe('ExpensesReimbursementForm_JSmith_March_2026');
  });
});

describe('report', () => {
  const r = buildReport(MARCH, settings, '2026-03');
  it('filters month, sorts by date, computes CAD totals', () => {
    expect(r.rows).toHaveLength(6);
    expect(r.rows[2].foreign).toMatchObject({ currency: 'USD', total: 26.04, converted: 36.33 });
    expect(r.rows[2].foreign!.rate).toBeCloseTo(1.395161, 6);
    expect(r.rows[4].totalCAD).toBe(21.17); // 29 km × 0.73
    expect(r.rows[5].foreign!.estimated).toBe(true);
    expect(r.totalCAD).toBeCloseTo(154.48, 2);
    expect(r.periodLine).toBe('For the Period Ending 1st March - 31st March 2026');
    expect(r.issues.some((i) => i.message.includes('estimate'))).toBe(true);
  });
});

describe('exports', () => {
  const out = process.env.EXPORT_OUT;
  it('writes an xlsx matching the template structure', async () => {
    const r = buildReport(MARCH, settings, '2026-03');
    const blob = await exportXlsx(r);
    const buf = Buffer.from(await blob.arrayBuffer());
    if (out) fs.writeFileSync(path.join(out, `${r.fileBase}.xlsx`), buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['README', 'March 2026', 'Picklist']);
    const ws = wb.getWorksheet('March 2026')!;
    expect(ws.getCell('A2').value).toBe('Name: Alex Doe');
    expect(ws.getCell('A8').value).toBe('03/02/2026');
    expect((ws.getCell('F8').value as { formula: string }).formula).toBe('D8+E8');
    expect(ws.getCell('H10').value).toBe('USD');
    expect((ws.getCell('M10').value as { formula: string }).formula).toBe('ROUND(L10*K10,2)');
    expect((ws.getCell('F31').value as { formula: string }).formula).toBe('SUM(F8:F29)');
  });

  it('writes a pdf with the form first and every attachment after', async () => {
    const r = buildReport(MARCH, settings, '2026-03');
    const fixtures = process.env.FIXTURE_IMG_DIR;
    const smallPdf = await PDFDocument.create();
    smallPdf.addPage([300, 400]).drawText('Emailed invoice', { x: 20, y: 350, size: 14 });
    const pdfBytes = await smallPdf.save();
    const png = fixtures && fs.existsSync(path.join(fixtures, 'p-02.png'))
      ? fs.readFileSync(path.join(fixtures, 'p-02.png'))
      : Buffer.from(await (await PDFDocument.create()).save()) as Buffer; // fallback (won't be used as image)
    const blob = await exportPdf(r, {
      attachmentsFor: async (row) => [
        row.expense.description === 'Adobe'
          ? { id: 'x', name: 'adobe.pdf', mime: 'application/pdf', blob: new Blob([pdfBytes as Uint8Array<ArrayBuffer>]), role: 'receipt' as const, createdAt: 0 }
          : fixtures
            ? { id: 'y', name: 'r.png', mime: 'image/png', blob: new Blob([png as unknown as Uint8Array<ArrayBuffer>]), role: row.expense.kind === 'mileage' ? ('map' as const) : ('receipt' as const), createdAt: 0 }
            : { id: 'x', name: 'adobe.pdf', mime: 'application/pdf', blob: new Blob([pdfBytes as Uint8Array<ArrayBuffer>]), role: 'receipt' as const, createdAt: 0 },
      ],
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (out) fs.writeFileSync(path.join(out, `${r.fileBase}.pdf`), bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1 + 6);
  }, 60000);
});
