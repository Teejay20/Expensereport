// Copies the OCR engine + English model into public/ so the app works fully offline (no CDN).
import fs from 'node:fs';
import path from 'node:path';
const out = 'public/tesseract';
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });
const copy = (src, dst) => fs.copyFileSync(src, path.join(out, dst));
copy('node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) copy(`node_modules/tesseract.js-core/${f}`, f);
copy('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
console.log('OCR assets copied to', out);
