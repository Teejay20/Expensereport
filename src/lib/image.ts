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

const toBlob = (c: HTMLCanvasElement, type = 'image/jpeg', q = 0.85) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));

/** Downscale + re-encode to JPEG for storage and the PDF (keeps receipts readable, ~300-600 KB). */
export async function compressForStorage(blob: Blob, maxSide = 2200, quality = 0.82): Promise<Blob> {
  const img = await decode(blob);
  const { w, h } = dims(img);
  const s = Math.min(1, maxSide / Math.max(w, h));
  const { c, ctx } = canvas(w * s, h * s);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
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

/**
 * Prepare a photo for OCR: grayscale, invert dark-mode screenshots, trim blank margins,
 * stretch contrast. (Tested against real receipts: keeping native resolution works best.)
 */
export async function prepareForOcr(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await decode(blob);
  const { w, h } = dims(img);
  const s = Math.min(1, 3000 / Math.max(w, h));
  const W = Math.round(w * s), H = Math.round(h * s);
  const { c, ctx } = canvas(W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;
  const gray = new Uint8ClampedArray(W * H);
  let sum = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gray[j] = g;
    sum += g;
  }
  const invert = sum / gray.length < 110; // dark-mode app screenshots (e.g. Uber)
  if (invert) for (let j = 0; j < gray.length; j++) gray[j] = 255 - gray[j];

  // Contrast stretch using 2nd/98th percentiles
  const hist = new Uint32Array(256);
  for (let j = 0; j < gray.length; j++) hist[gray[j]]++;
  const pct = (p: number) => {
    let acc = 0;
    const target = gray.length * p;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= target) return v;
    return 255;
  };
  const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98));

  // Trim margins: bounding box of "ink" pixels
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const ink = lo + (hi - lo) * 0.5;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (gray[y * W + x] < ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  const pad = 20;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);

  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / (hi - lo)));
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  out.ctx.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, out.c.width, out.c.height);
  return out.c;
}

export async function anyImageToJpeg(blob: Blob): Promise<Blob> {
  return compressForStorage(blob, 2600, 0.88);
}

export async function thumbnail(blob: Blob, size = 160): Promise<string> {
  const b = await compressForStorage(blob, size, 0.7);
  return URL.createObjectURL(b);
}
