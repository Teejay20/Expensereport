// On-device OCR with Tesseract (WebAssembly). Engine + English model are bundled and
// cached by the service worker, so scanning works offline and costs nothing.
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

const BASE = import.meta.env.BASE_URL;
const abs = (p: string) => new URL(`${BASE}${p}`, location.href).href;

let workerP: Promise<Worker> | null = null;
let progressCb: ((p: number, status: string) => void) | null = null;

function getWorker(): Promise<Worker> {
  if (!workerP) {
    workerP = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: abs('tesseract/worker.min.js'),
      corePath: abs('tesseract/'),
      langPath: abs('tesseract/lang'),
      gzip: true,
      cacheMethod: 'write', // keep a copy in IndexedDB as well
      logger: (m) => progressCb?.(m.progress ?? 0, m.status ?? ''),
    }).then(async (w) => {
      await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: PSM.AUTO });
      return w;
    });
    workerP.catch(() => (workerP = null));
  }
  return workerP;
}

/** Warm up the engine in the background (first load downloads ~6 MB, then cached). */
export function preloadOcr() {
  getWorker().catch(() => undefined);
}

export async function recognize(
  image: HTMLCanvasElement | Blob,
  onProgress?: (p: number, status: string) => void,
): Promise<{ text: string; confidence: number }> {
  progressCb = onProgress ?? null;
  const w = await getWorker();
  const { data } = await w.recognize(image);
  progressCb = null;
  return { text: data.text, confidence: data.confidence };
}
