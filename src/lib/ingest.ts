// Receipt ingestion: file (photo / screenshot / PDF) → stored attachment + parsed fields.
import { compressForStorage, prepareForOcr } from './image';
import { recognize } from './ocr';
import { extractPdfText, renderPdfPages } from './pdfText';
import { parseReceipt, type ParsedReceipt } from './receiptParser';
import { uid } from './db';
import type { Attachment, Settings } from './types';

export interface IngestResult {
  attachment: Attachment;
  parsed: ParsedReceipt;
  text: string;
  source: 'pdf-text' | 'ocr';
  confidence?: number;
}

export type Progress = (fraction: number, label: string) => void;

const quality = (p: ParsedReceipt) => (p.total ? 2 : 0) + (p.date ? 1 : 0) + (p.merchant ? 0.5 : 0) + (p.tax ? 0.5 : 0);

export function isPdf(f: Blob & { name?: string }) {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? '');
}

export async function ingestFile(file: File | Blob, settings: Settings, onProgress: Progress = () => {}): Promise<IngestResult> {
  const name = (file as File).name || `receipt-${Date.now()}`;
  const opts = { homeCurrency: settings.homeCurrency, dateOrder: settings.dateOrder };

  if (isPdf(file)) {
    onProgress(0.1, 'Reading PDF…');
    const buf = await file.arrayBuffer();
    const attachment: Attachment = { id: uid(), name, mime: 'application/pdf', blob: new Blob([buf], { type: 'application/pdf' }), role: 'receipt', createdAt: Date.now() };
    let text = '';
    try {
      text = (await extractPdfText(buf)).text;
    } catch (e) {
      console.warn('pdf text failed', e);
    }
    let parsed = parseReceipt(text, opts);
    // Scanner apps often embed an unusable text layer – OCR the rendered page instead.
    if (quality(parsed) < 3 || text.replace(/\s/g, '').length < 40) {
      onProgress(0.3, 'Scanning PDF image…');
      const [page] = await renderPdfPages(buf, 2.5, 1);
      if (page) {
        const blob = await new Promise<Blob>((r) => page.toBlob((b) => r(b!), 'image/png'));
        const pre = await prepareForOcr(blob);
        const o = await recognize(pre, (p) => onProgress(0.3 + p * 0.65, 'Reading text…'));
        const p2 = parseReceipt(o.text, opts);
        if (quality(p2) > quality(parsed)) return { attachment, parsed: p2, text: o.text, source: 'ocr', confidence: o.confidence };
      }
    }
    onProgress(1, 'Done');
    return { attachment, parsed, text, source: 'pdf-text' };
  }

  onProgress(0.05, 'Preparing image…');
  const stored = await compressForStorage(file);
  const attachment: Attachment = { id: uid(), name: name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', blob: stored, role: 'receipt', createdAt: Date.now() };
  const pre = await prepareForOcr(file);
  onProgress(0.15, 'Loading text scanner…');
  const o = await recognize(pre, (p, s) => onProgress(0.15 + p * 0.8, s.includes('recogniz') ? 'Reading text…' : 'Loading text scanner…'));
  const parsed = parseReceipt(o.text, opts);
  onProgress(1, 'Done');
  return { attachment, parsed, text: o.text, source: 'ocr', confidence: o.confidence };
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
      const blob = await new Promise<Blob>((r) => pages[i].toBlob((b) => r(b!), 'image/png'));
      const o = await recognize(await prepareForOcr(blob), (p) => onProgress((i + p) / pages.length, `Scanning page ${i + 1}/${pages.length}`));
      parts.push(o.text);
    }
    return parts.join('\n');
  }
  const o = await recognize(await prepareForOcr(file), (p) => onProgress(p, 'Reading statement…'));
  return o.text;
}
