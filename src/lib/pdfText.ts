// PDF helpers (browser): read the text layer and rasterize pages, via pdf.js.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { itemsToLines, type PositionedText } from './textLines';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

async function open(data: ArrayBuffer) {
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
}

export async function extractPdfText(data: ArrayBuffer, maxPages = 6): Promise<{ text: string; pages: number }> {
  const doc = await open(data);
  const parts: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: PositionedText[] = tc.items
      .filter((i): i is typeof i & { str: string; transform: number[]; width: number; height: number } => 'str' in i)
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height || Math.abs(i.transform[3]) }));
    parts.push(itemsToLines(items).join('\n'));
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text: parts.join('\n'), pages };
}

export async function renderPdfPages(data: ArrayBuffer, scale = 2, maxPages = 20): Promise<HTMLCanvasElement[]> {
  const doc = await open(data);
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as Parameters<typeof page.render>[0]).promise;
    out.push(c);
  }
  await doc.destroy();
  return out;
}

export async function rasterizePdfToJpegs(data: ArrayBuffer): Promise<Blob[]> {
  const canvases = await renderPdfPages(data, 2);
  return Promise.all(
    canvases.map((c) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.85))),
  );
}
