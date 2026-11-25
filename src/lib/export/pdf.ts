// Receipt bundle PDF: page 1 = the reimbursement form, then every receipt/map in row order.
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { Report, ReportRow } from '../report';
import type { Attachment } from '../types';
import { fmtMoney } from '../money';

export interface PdfDeps {
  attachmentsFor: (row: ReportRow) => Promise<Attachment[]>;
  /** Rasterize PDF pages when pdf-lib cannot copy them (encrypted/broken PDFs). */
  rasterizePdf?: (bytes: ArrayBuffer) => Promise<Blob[]>;
  /** Convert unsupported image types (webp/heic/gif) to JPEG. */
  toJpeg?: (blob: Blob) => Promise<Blob>;
}

const BLUE = rgb(0xdd / 255, 0xeb / 255, 0xf7 / 255);
const GREY = rgb(0xed / 255, 0xed / 255, 0xed / 255);
const LINE = rgb(0.35, 0.35, 0.35);
const MUTED = rgb(0.45, 0.45, 0.45);

/** pdf-lib standard fonts only support WinAnsi. */
export function winAnsi(s: string): string {
  return s
    .replace(/→/g, '>')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  let t = winAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1);
  return t + '...';
}

const acct = (n?: number) => (n === undefined || n === null ? '' : n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function drawFormPages(doc: PDFDocument, report: Report, font: PDFFont, bold: PDFFont) {
  const W = 792, H = 612, M = 24;
  const colChars = [19.8, 16.5, 33.7, 13.3, 13, 12.8, 9.2, 8.3, 7, 9.5, 11, 27.8, 21];
  const longest = Math.max(0, ...report.rows.map((r) => r.description.length));
  if (longest > 38) colChars[2] = Math.min(60, longest * 0.95);
  const scale = (W - 2 * M) / colChars.reduce((a, b) => a + b, 0);
  const colW = colChars.map((c) => c * scale);
  const colX = colW.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? M) + w], [M]);
  const RH = 11.5, FS = 7;
  const heads = ['Date (MM/DD/YYYY)', 'Category', 'Description', 'Pre HST (CAD)', 'Tax (CAD)', 'Total', 'Receipt',
    'Currency', 'Pre Tax', 'Tax', 'Total', 'Conversation Rate (XXX:CAD)', 'Total after conversion'];
  const numeric = new Set([3, 4, 5, 8, 9, 10, 11, 12]);

  const rows = report.rows;
  const blank = Math.max(0, 22 - rows.length, 3);
  const all: (ReportRow | null)[] = [...rows, ...Array(blank).fill(null)];
  const perPage = 36;
  const pages = Math.max(1, Math.ceil(all.length / perPage));

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([W, H]);
    let y = H - 40;
    const center = (t: string, f: PDFFont, s: number) => {
      const tt = winAnsi(t);
      page.drawText(tt, { x: W / 2 - f.widthOfTextAtSize(tt, s) / 2, y, size: s, font: f });
    };
    center(report.title, bold, 14); y -= 13;
    center(report.nameLine, bold, 7.5); y -= 10;
    center(report.periodLine, bold, 7.5); y -= 10;
    center(report.emailLine, bold, 7.5); y -= 18;

    // Row 6 band
    const cell = (x: number, w: number, yy: number, fill?: ReturnType<typeof rgb>) =>
      page.drawRectangle({ x, y: yy, width: w, height: RH, color: fill, borderColor: LINE, borderWidth: 0.5 });
    const leftW = colW.slice(0, 7).reduce((a, b) => a + b, 0);
    const rightW = colW.slice(7).reduce((a, b) => a + b, 0);
    cell(M, leftW, y, BLUE);
    cell(M + leftW, rightW, y, BLUE);
    const fcw = bold.widthOfTextAtSize('Foreign Currency', FS);
    page.drawText('Foreign Currency', { x: M + leftW + rightW / 2 - fcw / 2, y: y + 3, size: FS, font: bold });
    y -= RH;
    heads.forEach((h, i) => {
      cell(colX[i], colW[i], y, BLUE);
      let hs = FS;
      while (hs > 4.5 && bold.widthOfTextAtSize(h, hs) > colW[i] - 3) hs -= 0.25;
      page.drawText(fit(bold, h, hs, colW[i] - 3), { x: colX[i] + 1.5, y: y + 3, size: hs, font: bold });
    });
    y -= RH;

    for (const r of all.slice(p * perPage, (p + 1) * perPage)) {
      const vals: string[] = r
        ? [r.dateMDY, r.category, r.description, acct(r.preCAD), acct(r.taxCAD), `$ ${acct(r.totalCAD)}`, r.receipt,
          r.foreign?.currency ?? '', acct(r.foreign?.preTax), acct(r.foreign?.tax), acct(r.foreign?.total),
          r.foreign ? String(r.foreign.rate) + (r.foreign.estimated ? '*' : '') : '', acct(r.foreign?.converted)]
        : ['', '', '', '', '', '$        -', '', '', '', '', '', '', ''];
      vals.forEach((v, i) => {
        cell(colX[i], colW[i], y, i === 5 ? GREY : undefined);
        if (!v) return;
        const t = fit(font, v, FS, colW[i] - 3);
        const x = numeric.has(i) ? colX[i] + colW[i] - 1.5 - font.widthOfTextAtSize(t, FS) : colX[i] + 1.5;
        page.drawText(t, { x, y: y + 3, size: FS, font });
      });
      y -= RH;
    }
    if (p === pages - 1) {
      y -= 14;
      page.drawText('Total', { x: colX[4] + 4, y, size: 8, font: bold });
      const tt = `$ ${acct(report.totalCAD)}`;
      page.drawText(tt, { x: colX[5] + colW[5] - 2 - bold.widthOfTextAtSize(tt, 8), y, size: 8, font: bold });
      if (report.rows.some((r) => r.foreign?.estimated)) {
        page.drawText('* Estimated exchange rate (Bank of Canada) - card statement amount not available.', { x: M, y: y - 16, size: 6.5, font, color: MUTED });
      }
    }
  }
}

function footer(page: PDFPage, font: PDFFont, label: string) {
  const { width } = page.getSize();
  const t = fit(font, label, 7, width - 40);
  page.drawRectangle({ x: 14, y: 6, width: font.widthOfTextAtSize(t, 7) + 8, height: 12, color: rgb(1, 1, 1), opacity: 0.85 });
  page.drawText(t, { x: 18, y: 9.5, size: 7, font, color: MUTED });
}

async function addImagePage(doc: PDFDocument, bytes: ArrayBuffer, mime: string, font: PDFFont, label: string, heading?: string) {
  const img = mime.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const landscape = img.width > img.height * 1.15;
  const [W, H] = landscape ? [792, 612] : [612, 792];
  const page = doc.addPage([W, H]);
  const M = 28;
  let top = H - M;
  if (heading) {
    const lines = heading.split('\n');
    lines.forEach((ln, i) => page.drawText(fit(font, ln, i === 0 ? 11 : 9, W - 2 * M), { x: M, y: top - 11 - i * 12, size: i === 0 ? 11 : 9, font }));
    top -= 12 * lines.length + 10;
  }
  const maxW = W - 2 * M, maxH = top - 24;
  const s = Math.min(maxW / img.width, maxH / img.height, 2);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img, { x: (W - w) / 2, y: top - h, width: w, height: h });
  footer(page, font, label);
}

export async function exportPdf(report: Report, deps: PdfDeps): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.setTitle(report.fileBase);
  doc.setCreator('Expense Snap');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  drawFormPages(doc, report, font, bold);

  for (let i = 0; i < report.rows.length; i++) {
    const row = report.rows[i];
    const e = row.expense;
    const amount = row.foreign ? `${row.foreign.currency} ${row.foreign.total.toFixed(2)} = ${fmtMoney(row.totalCAD)}` : fmtMoney(row.totalCAD);
    const label = `#${i + 1}  ${row.dateMDY}  ${row.description}  ${amount}`;
    const atts = await deps.attachmentsFor(row);
    for (const a of atts) {
      const heading = a.role === 'map' && e.mileage
        ? `Mileage - ${row.dateMDY} - ${e.mileage.distanceKm.toFixed(1)} km x $${e.mileage.ratePerKm.toFixed(2)}/km = ${fmtMoney(row.totalCAD)}\n` +
          e.mileage.stops.map((s, k) => `${String.fromCharCode(65 + k)}: ${s}`).join('\n') +
          (e.mileage.roundTrip ? '\n(Round trip - return to A)' : '')
        : undefined;
      try {
        if (a.mime === 'application/pdf') {
          const bytes = await a.blob.arrayBuffer();
          try {
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const pages = await doc.copyPages(src, src.getPageIndices());
            for (const pg of pages) { doc.addPage(pg); footer(pg, font, label); }
          } catch (err) {
            if (!deps.rasterizePdf) throw err;
            for (const img of await deps.rasterizePdf(bytes)) await addImagePage(doc, await img.arrayBuffer(), 'image/jpeg', font, label);
          }
        } else if (/image\/(jpeg|jpg|png)/.test(a.mime)) {
          await addImagePage(doc, await a.blob.arrayBuffer(), a.mime, font, label, heading);
        } else if (a.mime.startsWith('image/') && deps.toJpeg) {
          const j = await deps.toJpeg(a.blob);
          await addImagePage(doc, await j.arrayBuffer(), 'image/jpeg', font, label, heading);
        }
      } catch (err) {
        const page = doc.addPage([612, 792]);
        page.drawText(winAnsi(`Could not include attachment "${a.name}" for ${label}`), { x: 36, y: 740, size: 10, font });
        console.error(err);
      }
    }
  }
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}
