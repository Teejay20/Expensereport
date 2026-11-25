// Receipt ingestion: file (photo / screenshot / PDF) → stored attachment + parsed fields.
import { compressForStorage, prepareForOcr, type OcrPolarity } from './image';
import { recognize } from './ocr';
import { extractPdfText, renderPdfPages } from './pdfText';
import { combineReceipts, parseReceipt, type ParsedReceipt } from './receiptParser';
import { uid } from './db';
import type { Attachment, Settings } from './types';

export interface PageRead {
  parsed: ParsedReceipt;
  text: string;
  confidence?: number;
}

export interface IngestResult {
  attachment: Attachment;
  /** Combined result of all pages in this file. */
  parsed: ParsedReceipt;
  /** One entry per page/photo (used to combine with more photos added later). */
  pages: PageRead[];
  text: string;
  source: 'pdf-text' | 'ocr';
  confidence?: number;
}

export type Progress = (fraction: number, label: string) => void;

export const readQuality = (p: ParsedReceipt) =>
  (p.total ? 2 : 0) + (p.date ? 1 : 0) + (p.merchant ? 0.5 : 0) + (p.tax ? 0.5 : 0) - (p.warnings.some((w) => w.includes('≠') || w.includes('usual rate')) ? 0.5 : 0);

export function isPdf(f: Blob & { name?: string }) {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? '');
}

const MAX_PAGES = 6;

/**
 * OCR one image. If the first reading is weak, try the opposite polarity (receipt on a dark table
 * vs. dark-mode screenshot) and keep whichever reading parses better.
 */
export async function ocrImage(blob: Blob, settings: Settings, onProgress: Progress = () => {}): Promise<PageRead> {
  const opts = { homeCurrency: settings.homeCurrency, dateOrder: settings.dateOrder };
  const run = async (pol: OcrPolarity, crop: boolean, from: number, span: number) => {
    const pre = await prepareForOcr(blob, pol, { crop });
    const o = await recognize(pre.canvas, (p, s) => onProgress(from + p * span, s.includes('recogniz') ? 'Reading text…' : 'Loading text scanner…'));
    return { read: { parsed: parseReceipt(o.text, opts), text: o.text, confidence: o.confidence }, inverted: pre.inverted, cropped: pre.cropped };
  };
  const first = await run('auto', true, 0, 0.6);
  if (readQuality(first.read.parsed) >= 3.5 && (first.read.confidence ?? 0) >= 60) return first.read;
  onProgress(0.6, 'Taking a second look…');
  // Second look: undo whichever automatic decision was made (paper crop, or dark-mode inversion)
  const second = first.cropped ? await run('normal', false, 0.6, 0.4) : await run(first.inverted ? 'normal' : 'inverted', false, 0.6, 0.4);
  const score = (r: PageRead) => readQuality(r.parsed) * 100 + (r.confidence ?? 0);
  const [best, other] = score(second.read) > score(first.read) ? [second.read, first.read] : [first.read, second.read];
  return { ...best, parsed: mergeReads(best.parsed, other.parsed), text: `${best.text}\n\n— second look —\n\n${other.text}` };
}

const suspectTax = (p: ParsedReceipt) => p.warnings.some((w) => w.includes('usual rate') || w.includes('≠'));

/** Fill gaps in the better reading with fields the other reading found. */
function mergeReads(a: ParsedReceipt, b: ParsedReceipt): ParsedReceipt {
  const sameTotal = a.total !== undefined && b.total !== undefined && Math.abs(a.total - b.total) < 0.005;
  const m: ParsedReceipt = { ...a, warnings: [...a.warnings] };
  if (!m.date && b.date) { m.date = b.date; m.warnings = m.warnings.filter((w) => w !== 'Date not found'); }
  if (!m.merchant && b.merchant) m.merchant = b.merchant;
  if (!m.category && b.category) m.category = b.category;
  if (m.total === undefined && b.total !== undefined) { m.total = b.total; m.tax = b.tax; m.subtotal = b.subtotal; }
  else if (sameTotal && b.tax && (!m.tax || (suspectTax(a) && !suspectTax(b)))) {
    m.tax = b.tax;
    m.subtotal = b.subtotal;
    m.warnings = m.warnings.filter((w) => !w.includes('usual rate') && !w.includes('≠'));
  }
  return m;
}

const canvasToBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));

export async function ingestFile(file: File | Blob, settings: Settings, onProgress: Progress = () => {}): Promise<IngestResult> {
  const name = (file as File).name || `receipt-${Date.now()}`;
  const opts = { homeCurrency: settings.homeCurrency, dateOrder: settings.dateOrder };

  if (isPdf(file)) {
    onProgress(0.05, 'Reading PDF…');
    const buf = await file.arrayBuffer();
    const attachment: Attachment = { id: uid(), name, mime: 'application/pdf', blob: new Blob([buf], { type: 'application/pdf' }), role: 'receipt', createdAt: Date.now() };
    let pagesText: string[] = [];
    try {
      pagesText = (await extractPdfText(buf, MAX_PAGES)).pageTexts;
    } catch (e) {
      console.warn('pdf text failed', e);
    }
    const textPages: PageRead[] = pagesText.map((t) => ({ text: t, parsed: parseReceipt(t, opts) }));
    const fromText = textPages.length ? combineReceipts(textPages) : undefined;
    const textChars = pagesText.join('').replace(/\s/g, '').length;
    // Photos/scans inside a PDF (CamScanner etc.) have no or a broken text layer → OCR each page.
    if (!fromText || readQuality(fromText) < 3 || textChars < 40 * Math.max(1, pagesText.length)) {
      const canvases = await renderPdfPages(buf, 2.5, MAX_PAGES);
      const ocrPages: PageRead[] = [];
      for (let i = 0; i < canvases.length; i++) {
        const label = canvases.length > 1 ? ` page ${i + 1}/${canvases.length}` : '';
        ocrPages.push(await ocrImage(await canvasToBlob(canvases[i]), settings, (p, l) => onProgress(0.1 + ((i + p) / canvases.length) * 0.88, l + label)));
      }
      const fromOcr = combineReceipts(ocrPages);
      if (!fromText || readQuality(fromOcr) > readQuality(fromText)) {
        onProgress(1, 'Done');
        return { attachment, parsed: fromOcr, pages: ocrPages, text: ocrPages.map((p) => p.text).join('\n\n— page —\n\n'), source: 'ocr', confidence: ocrPages[0]?.confidence };
      }
    }
    onProgress(1, 'Done');
    return { attachment, parsed: fromText!, pages: textPages, text: pagesText.join('\n\n— page —\n\n'), source: 'pdf-text' };
  }

  onProgress(0.03, 'Preparing image…');
  const stored = await compressForStorage(file);
  const attachment: Attachment = { id: uid(), name: name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', blob: stored, role: 'receipt', createdAt: Date.now() };
  const page = await ocrImage(file, settings, onProgress);
  onProgress(1, 'Done');
  return { attachment, parsed: page.parsed, pages: [page], text: page.text, source: 'ocr', confidence: page.confidence };
}

/** Plain text of any statement file (PDF text layer, or OCR for images/scans). */
export async function statementText(file: File, onProgress: Progress = () => {}): Promise<string> {
  if (isPdf(file)) {
    const buf = await file.arrayBuffer();
    const { text } = await extractPdfText(buf, 30);
    if (text.replace(/\s/g, '').length > 200) return text;
    const pages = await renderPdfPages(buf, 2.5, 10);
    const parts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const pre = await prepareForOcr(await canvasToBlob(pages[i]));
      const o = await recognize(pre.canvas, (p) => onProgress((i + p) / pages.length, `Scanning page ${i + 1}/${pages.length}`));
      parts.push(o.text);
    }
    return parts.join('\n');
  }
  const pre = await prepareForOcr(file);
  const o = await recognize(pre.canvas, (p) => onProgress(p, 'Reading statement…'));
  return o.text;
}
