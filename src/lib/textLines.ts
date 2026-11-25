// Rebuild reading-order lines from positioned text fragments (pdf.js text content).

export interface PositionedText {
  str: string;
  x: number;
  y: number; // PDF space: larger = higher on the page
  width: number;
  height: number;
}

export function itemsToLines(items: PositionedText[]): string[] {
  const clean = items.filter((i) => i.str && i.str.trim());
  // Sort top→bottom then left→right
  clean.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedText[][] = [];
  for (const it of clean) {
    const tol = Math.max(2, (it.height || 8) * 0.45);
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= tol);
    if (row) row.push(it);
    else rows.push([it]);
  }
  rows.sort((a, b) => b[0].y - a[0].y);
  return rows.map((r) => {
    r.sort((a, b) => a.x - b.x);
    let line = '';
    let lastEnd = -Infinity;
    for (const it of r) {
      const gap = it.x - lastEnd;
      if (line && gap > (it.height || 8) * 0.25) line += gap > (it.height || 8) * 3 ? '   ' : ' ';
      line += it.str;
      lastEnd = it.x + it.width;
    }
    return line.replace(/\s+$/, '');
  });
}
