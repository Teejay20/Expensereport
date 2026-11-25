// Image utilities (browser). All processing happens on-device.

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Safari fallback (and HEIC on iOS, which <img> can decode)
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

const dims = (img: ImageBitmap | HTMLImageElement) =>
  'naturalWidth' in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

/**
 * High-quality downscale: halve repeatedly, then a final smooth resize. A single big drawImage step
 * can behave like nearest-neighbour and wipe out thin receipt text.
 */
function drawScaled(img: ImageBitmap | HTMLImageElement | HTMLCanvasElement, W: number, H: number) {
  let src: ImageBitmap | HTMLImageElement | HTMLCanvasElement = img;
  let sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  let sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  while (sw / 2 >= W * 1.2) {
    const step = canvas(sw / 2, sh / 2);
    step.ctx.imageSmoothingEnabled = true;
    step.ctx.imageSmoothingQuality = 'high';
    step.ctx.drawImage(src, 0, 0, step.c.width, step.c.height);
    src = step.c; sw = step.c.width; sh = step.c.height;
  }
  const out = canvas(W, H);
  out.ctx.imageSmoothingEnabled = true;
  out.ctx.imageSmoothingQuality = 'high';
  out.ctx.fillStyle = '#fff';
  out.ctx.fillRect(0, 0, out.c.width, out.c.height);
  out.ctx.drawImage(src, 0, 0, out.c.width, out.c.height);
  return out;
}

const toBlob = (c: HTMLCanvasElement, type = 'image/jpeg', q = 0.85) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));

/** Downscale + re-encode to JPEG for storage and the PDF (keeps receipts readable, ~300-600 KB). */
export async function compressForStorage(blob: Blob, maxSide = 2200, quality = 0.82): Promise<Blob> {
  const img = await decode(blob);
  const { w, h } = dims(img);
  const s = Math.min(1, maxSide / Math.max(w, h));
  const { c } = drawScaled(img, w * s, h * s);
  return toBlob(c, 'image/jpeg', quality);
}

export async function rotateImage(blob: Blob, degrees: 90 | -90 | 180): Promise<Blob> {
  const img = await decode(blob);
  const { w, h } = dims(img);
  const swap = degrees !== 180;
  const { c, ctx } = canvas(swap ? h : w, swap ? w : h);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return toBlob(c, 'image/jpeg', 0.88);
}

/** Otsu threshold of a 256-bin histogram. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/** Longest run of indexes where `frac[i] >= min`. */
function longestRun(frac: Float32Array, min: number): [number, number] | null {
  let best: [number, number] | null = null, start = -1;
  for (let i = 0; i <= frac.length; i++) {
    if (i < frac.length && frac[i] >= min) { if (start < 0) start = i; }
    else if (start >= 0) { if (!best || i - start > best[1] - best[0]) best = [start, i - 1]; start = -1; }
  }
  return best;
}

/**
 * Find the sheet of paper in a photo taken on a darker surface (table, desk, car seat).
 * Returns the crop box, or null when the image isn't "paper on a background".
 */
export function findPaper(gray: Uint8ClampedArray, W: number, H: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const hist = new Uint32Array(256);
  for (let j = 0; j < gray.length; j++) hist[gray[j]]++;
  const t = Math.max(100, otsu(hist, gray.length));
  const step = Math.max(1, Math.floor(Math.min(W, H) / 400));
  const col = new Float32Array(W), row = new Float32Array(H);
  let bright = 0, n = 0;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const b = gray[y * W + x] > t ? 1 : 0;
    col[x] += b; row[y] += b; bright += b; n++;
  }
  const frac = bright / n;
  if (frac > 0.8 || frac < 0.08) return null; // all paper (scan/screenshot) or no paper
  const rows = Math.ceil(H / step), cols = Math.ceil(W / step);
  const cf = new Float32Array(Math.ceil(W / step)), rf = new Float32Array(Math.ceil(H / step));
  for (let x = 0, i = 0; x < W; x += step, i++) cf[i] = col[x] / rows;
  for (let y = 0, i = 0; y < H; y += step, i++) rf[i] = row[y] / cols;
  const cr = longestRun(cf, 0.3);
  if (!cr || (cr[1] - cr[0] + 1) < cf.length * 0.15) return null;
  // rows: measure brightness only inside the paper columns
  const x0 = cr[0] * step, x1 = Math.min(W - 1, (cr[1] + 1) * step);
  const rf2 = new Float32Array(rf.length);
  for (let y = 0, i = 0; y < H; y += step, i++) {
    let c = 0, m = 0;
    for (let x = x0; x <= x1; x += step) { c += gray[y * W + x] > t ? 1 : 0; m++; }
    rf2[i] = c / m;
  }
  const rr = longestRun(rf2, 0.4);
  if (!rr || (rr[1] - rr[0] + 1) < rf2.length * 0.15) return null;
  const pad = 8;
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, rr[0] * step - pad), x1: Math.min(W - 1, x1 + pad), y1: Math.min(H - 1, (rr[1] + 1) * step + pad) };
}

export type OcrPolarity = 'auto' | 'normal' | 'inverted';

/**
 * Prepare a photo for OCR: grayscale, crop to the paper (receipt on a dark table), invert dark-mode
 * screenshots, stretch contrast, trim blank margins.
 */
export async function prepareForOcr(blob: Blob, polarity: OcrPolarity = 'auto', opts: { crop?: boolean } = {}): Promise<{ canvas: HTMLCanvasElement; inverted: boolean; cropped: boolean }> {
  const img = await decode(blob);
  const { w, h } = dims(img);
  const s = Math.min(1, 3000 / Math.max(w, h));
  let W = Math.round(w * s), H = Math.round(h * s);
  const { c, ctx } = drawScaled(img, W, H);
  let gray = new Uint8ClampedArray(W * H);
  {
    const px = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  }

  // 1) Crop to the paper when photographed on a darker background
  const paper = opts.crop === false ? null : findPaper(gray, W, H);
  if (paper) {
    const nW = paper.x1 - paper.x0 + 1, nH = paper.y1 - paper.y0 + 1;
    const g2 = new Uint8ClampedArray(nW * nH);
    for (let y = 0; y < nH; y++) g2.set(gray.subarray((y + paper.y0) * W + paper.x0, (y + paper.y0) * W + paper.x0 + nW), y * nW);
    gray = g2; W = nW; H = nH;
  }

  // 2) Polarity: dark-mode screenshots (light text on dark) are inverted
  let sum = 0;
  for (let j = 0; j < gray.length; j++) sum += gray[j];
  const invert = polarity === 'inverted' || (polarity === 'auto' && !paper && sum / gray.length < 110);
  if (invert) for (let j = 0; j < gray.length; j++) gray[j] = 255 - gray[j];

  // 3) Contrast stretch using 2nd/98th percentiles
  const hist = new Uint32Array(256);
  for (let j = 0; j < gray.length; j++) hist[gray[j]]++;
  const pct = (p: number) => {
    let acc = 0;
    const target = gray.length * p;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= target) return v;
    return 255;
  };
  const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98));

  // 4) Trim blank margins (bounding box of "ink")
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const ink = lo + (hi - lo) * 0.5;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (gray[y * W + x] < ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  const pad = 20;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);

  const work = canvas(W, H);
  const out = work.ctx.createImageData(W, H);
  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / (hi - lo)));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  work.ctx.putImageData(out, 0, 0);
  void c;
  const res = canvas(x1 - x0 + 1, y1 - y0 + 1);
  res.ctx.drawImage(work.c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, res.c.width, res.c.height);
  return { canvas: res.c, inverted: invert, cropped: !!paper };
}

export async function anyImageToJpeg(blob: Blob): Promise<Blob> {
  return compressForStorage(blob, 2600, 0.88);
}

export async function thumbnail(blob: Blob, size = 160): Promise<string> {
  const b = await compressForStorage(blob, size, 0.7);
  return URL.createObjectURL(b);
}
