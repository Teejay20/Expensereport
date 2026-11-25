// Excel export that mirrors the company's ExpensesReimbursementForm template.
import ExcelJS from 'exceljs';
import { CATEGORIES } from '../types';
import type { Report } from '../report';

const BLUE = 'FFDDEBF7'; // theme accent 5, 80% tint (header fill in template)
const GREY = 'FFEDEDED'; // theme accent 3, 80% tint (formula cells)
const ACCT = '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)';
const thin = { style: 'thin' as const };
const box = { top: thin, left: thin, bottom: thin, right: thin };

const README_LINES: [number | null, string][] = [
  [null, 'Reimbursements happen at the end of every month and we reimburse in CAD only.'],
  [null, 'Cells in grey contains formula and do not require any input. '],
  [1, 'Make a copy of this form.'],
  [2, 'Rename the form to the same format as the placeholder, e.g.: "ExpensesReimbursementForm_COoi_230630".'],
  [3, 'Complete your information in row 2 to 4.'],
  [4, 'In the table, enter the date of purchase.'],
  [5, 'Select the appropriate category for your purchase.'],
  [6, 'Include a short description on what the purchase is.'],
  [7, 'Enter Pre-HST amount in CAD.'],
  [8, 'Enter Tax amount in CAD.'],
  [9, 'The total amount will be autocalculated'],
  [10, 'For foreign purchases, enter the pre-tax and tax amount in the "Foreign Currency" section.'],
  [11, 'Enter the conversion rate from the foreign currency to CAD. '],
  [null, 'For example, USD:CAD is 1.32'],
  [12, 'For gas, please include a map showing where you are traveling from and to. The rate based on the handbook will be applied for reimbursing gases.'],
  [13, 'Compile your receipts in one PDF with the filename in this format, Expenses_FirstInitialLastName_YYMMDD, e.g.: "Expenses_COoi_230630".'],
  [14, 'Add more rows if required.'],
  [15, 'Send the form and your receipt to Candice via email.'],
];

export async function buildWorkbook(report: Report): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Expense Snap';
  wb.created = new Date();

  // ---------- README
  const rd = wb.addWorksheet('README');
  rd.getCell('A1').value = 'How to Submit Expenses';
  rd.getCell('A1').font = { bold: true, name: 'Calibri', size: 11 };
  README_LINES.forEach(([n, text], i) => {
    const r = i + 3;
    if (n !== null) rd.getCell(`A${r}`).value = n;
    rd.getCell(`B${r}`).value = text;
  });

  // ---------- Month sheet
  const ws = wb.addWorksheet(report.sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 1 as never },
  });
  const widths = [19.82, 16.45, 33.73, 13.27, 13, 12.82, 9.18, 8.27, 7, 9.54, 11, 27.82, 21];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  // Description column grows for long mileage descriptions
  const longest = Math.max(0, ...report.rows.map((r) => r.description.length));
  if (longest > 38) ws.getColumn(3).width = Math.min(70, longest * 0.95);

  const header = (row: number, text: string, size = 11) => {
    ws.mergeCells(`A${row}:M${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = text;
    c.font = { bold: true, size, name: 'Calibri' };
    c.alignment = { horizontal: 'center' };
  };
  header(1, report.title, 20);
  ws.getRow(1).height = 26;
  header(2, report.nameLine);
  header(3, report.periodLine);
  header(4, report.emailLine);

  ws.mergeCells('A6:G6');
  ws.mergeCells('H6:M6');
  const fc = ws.getCell('H6');
  fc.value = 'Foreign Currency';
  fc.font = { bold: true };
  fc.alignment = { horizontal: 'center' };
  for (const a of ['A6', 'H6']) {
    ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell(a).border = box;
  }

  const heads = ['Date (MM/DD/YYYY)', 'Category', 'Description', 'Pre HST (CAD)', 'Tax (CAD)', 'Total', 'Receipt',
    'Currency', 'Pre Tax', 'Tax', 'Total', 'Conversation Rate (XXX:CAD)', 'Total after conversion'];
  heads.forEach((h, i) => {
    const c = ws.getRow(7).getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.border = box;
  });

  const first = 8;
  const minRows = 22; // template has rows 8..29
  const lastRow = first + Math.max(minRows, report.rows.length + 5) - 1;
  for (let r = first; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 13; c++) row.getCell(c).border = box;
    const data = report.rows[r - first];
    const F = row.getCell(6);
    F.value = { formula: `D${r}+E${r}`, result: data ? data.totalCAD : 0 };
    F.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    F.numFmt = ACCT;
    row.getCell(4).numFmt = ACCT;
    row.getCell(5).numFmt = ACCT;
    row.getCell(7).dataValidation = { type: 'list', allowBlank: true, formulae: ['Picklist!$E$2:$E$3'] };
    row.getCell(2).dataValidation = { type: 'list', allowBlank: true, formulae: [`Picklist!$A$2:$A$${CATEGORIES.length + 1}`] };
    if (!data) continue;
    row.getCell(1).value = data.dateMDY;
    row.getCell(2).value = data.category;
    row.getCell(3).value = data.description;
    row.getCell(4).value = data.preCAD;
    if (data.taxCAD) row.getCell(5).value = data.taxCAD;
    row.getCell(7).value = data.receipt;
    if (data.foreign) {
      const f = data.foreign;
      row.getCell(8).value = f.currency;
      row.getCell(9).value = f.preTax;
      if (f.tax) row.getCell(10).value = f.tax;
      row.getCell(11).value = f.total;
      row.getCell(12).value = f.rate;
      row.getCell(12).numFmt = '0.0000##';
      const M = row.getCell(13);
      M.value = { formula: `ROUND(L${r}*K${r},2)`, result: f.converted };
      M.numFmt = '#,##0.00';
      M.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
      if (f.estimated) {
        row.getCell(12).note = 'Estimated rate (Bank of Canada) – card statement not provided';
      }
    }
  }

  const totalRow = lastRow + 2;
  ws.getCell(`E${totalRow}`).value = 'Total';
  ws.getCell(`E${totalRow}`).font = { bold: true };
  const T = ws.getCell(`F${totalRow}`);
  T.value = { formula: `SUM(F${first}:F${lastRow})`, result: report.totalCAD };
  T.font = { bold: true };
  T.numFmt = ACCT;

  // ---------- Picklist
  const pl = wb.addWorksheet('Picklist');
  pl.getColumn(1).width = 16;
  pl.getCell('A1').value = 'Category';
  pl.getCell('C1').value = 'Currency';
  pl.getCell('E1').value = 'Yes/No';
  CATEGORIES.forEach((c, i) => (pl.getCell(`A${i + 2}`).value = c));
  ['CAD', 'USD', 'EUR'].forEach((c, i) => (pl.getCell(`C${i + 2}`).value = c));
  pl.getCell('E2').value = 'Y';
  pl.getCell('E3').value = 'N';

  wb.views = [{ activeTab: 1, x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, visibility: 'visible' }];
  return wb;
}

export async function exportXlsx(report: Report): Promise<Blob> {
  const wb = await buildWorkbook(report);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
