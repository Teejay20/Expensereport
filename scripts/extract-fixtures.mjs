// Dev tool: builds tests/fixtures/*.txt from a sample receipt PDF so the parser can be regression-tested.
// usage: node scripts/extract-fixtures.mjs <receipts.pdf> <outDir> <pngDir>
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';

const [pdfPath, outDir, pngDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;

function itemsToLines(items) {
  const clean = items.filter((i) => i.str && i.str.trim());
  clean.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of clean) {
    const tol = Math.max(2, (it.height || 8) * 0.45);
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= tol);
    row ? row.push(it) : rows.push([it]);
  }
  rows.sort((a, b) => b[0].y - a[0].y);
  return rows.map((r) => {
    r.sort((a, b) => a.x - b.x);
    let line = '', lastEnd = -Infinity;
    for (const it of r) {
      const gap = it.x - lastEnd;
      if (line && gap > (it.height || 8) * 0.25) line += gap > (it.height || 8) * 3 ? '   ' : ' ';
      line += it.str; lastEnd = it.x + it.width;
    }
    return line;
  });
}

const worker = await createWorker('eng', 1, { langPath: path.resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'), gzip: true });
await worker.setParameters({ preserve_interword_spaces: '1' });
for (let p = 2; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const items = tc.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height || Math.abs(i.transform[3]) }));
  let text = itemsToLines(items).join('\n');
  let src = 'pdf';
  if (text.replace(/\s/g, '').length < 30) {
    const png = path.join(pngDir, `p-${String(p).padStart(2, '0')}.png`);
    const { data } = await worker.recognize(png);
    text = data.text; src = 'ocr';
  }
  fs.writeFileSync(path.join(outDir, `p${String(p).padStart(2, '0')}.${src}.txt`), text);
  console.log(`page ${p}: ${src}, ${text.length} chars`);
}
await worker.terminate();
