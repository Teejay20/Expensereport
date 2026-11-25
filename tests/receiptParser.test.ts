import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseReceipt, detectCurrency, combineReceipts } from '../src/lib/receiptParser';
import { findAmounts } from '../src/lib/money';
import { findDates } from '../src/lib/dates';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const opts = { homeCurrency: 'CAD', today: '2026-04-15' };

// Expected values come from the real March 2026 reimbursement form (personal data redacted).
const CASES: {
  file: string;
  merchant?: string;
  category?: string;
  date?: string;
  currency: string;
  total: number;
  tax?: number;
}[] = [
  { file: 'uber1.txt', merchant: 'Uber', category: 'Travel', date: '2026-03-02', currency: 'CAD', total: 28.73, tax: 0 },
  { file: 'uber2.txt', merchant: 'Uber', category: 'Travel', date: '2026-03-06', currency: 'CAD', total: 33.62, tax: 3.87 },
  { file: 'uber3.txt', merchant: 'Uber', category: 'Travel', date: '2026-03-20', currency: 'CAD', total: 41.38, tax: 4.76 },
  { file: 'adobe.txt', merchant: 'Adobe', category: 'Office', currency: 'CAD', total: 44.06, tax: 5.07 },
  { file: 'misumi1.txt', merchant: 'Misumi', category: 'Engineering/R&D', date: '2026-03-10', currency: 'USD', total: 26.04, tax: 0 },
  { file: 'misumi2.txt', merchant: 'Misumi', date: '2026-03-13', currency: 'USD', total: 17.36, tax: 0 },
  { file: 'misumi3.txt', merchant: 'Misumi', date: '2026-03-12', currency: 'USD', total: 77.32, tax: 0 },
  { file: 'uwpark1.txt', merchant: 'UW parking', category: 'Travel', date: '2026-03-13', currency: 'CAD', total: 6.19, tax: 0.71 },
  { file: 'uwpark2.txt', merchant: 'UW parking', date: '2026-03-13', currency: 'CAD', total: 6.19, tax: 0.71 },
  { file: 'uwpark3.txt', merchant: 'UW parking', date: '2026-03-25', currency: 'CAD', total: 7.25, tax: 0.83 },
  { file: 'uwlot_paper.txt', merchant: 'UW parking', date: '2026-03-17', currency: 'CAD', total: 1.0 },
  { file: 'michaels.txt', merchant: 'Michaels', date: '2026-03-17', currency: 'CAD', total: 6.77, tax: 0.78 },
];

describe('parseReceipt – real receipts', () => {
  for (const c of CASES) {
    it(c.file, () => {
      const r = parseReceipt(fx(c.file), opts);
      if (c.merchant) expect(r.merchant).toBe(c.merchant);
      if (c.category) expect(r.category).toBe(c.category);
      if (c.date) expect(r.date).toBe(c.date);
      expect(r.currency).toBe(c.currency);
      expect(r.total).toBeCloseTo(c.total, 2);
      if (c.tax !== undefined) expect(r.tax).toBeCloseTo(c.tax, 2);
    });
  }

  it('does not crash on unreadable scans and still finds the merchant', () => {
    const r = parseReceipt(fx('uwlot_badlayer.txt'), opts);
    expect(r.currency).toBe('CAD');
    const ct = parseReceipt(fx('canadiantire_paper.txt'), opts);
    expect(ct.merchant).toBe('Canadian Tire');
    expect(ct.date).toBe('2026-03-31');
  });
});

describe('parseReceipt – synthetic edge cases', () => {
  it('sums multiple Canadian taxes', () => {
    const r = parseReceipt('CAFE DU NORD\n2026-03-04\nSubtotal 20.00\nTPS 1.00\nTVQ 2.00\nTotal 23.00', opts);
    expect(r.tax).toBe(3);
    expect(r.subtotal).toBe(20);
    expect(r.total).toBe(23);
  });
  it('detects euro receipts with comma decimals', () => {
    const r = parseReceipt('Boulangerie Paul\n12/03/2026\nTOTAL 12,50 €\nTVA 10% 1,14', { ...opts, dateOrder: 'DMY' });
    expect(r.currency).toBe('EUR');
    expect(r.total).toBe(12.5);
    expect(r.date).toBe('2026-03-12');
  });
  it('detects US$ via state + zip', () => {
    expect(detectCurrency('Joe Diner\n123 Main St\nAustin, TX 78701\nTotal $10.00').code).toBe('USD');
  });
  it('ignores percentages and long ids as money', () => {
    expect(findAmounts('HST 13.00% 5.07').map((a) => a.value)).toEqual([5.07]);
    expect(findAmounts('Ref 123456789012.34')).toEqual([]);
    expect(findAmounts('HST R135299063 13% .78').map((a) => a.value)).toEqual([0.78]);
  });
  it('parses YY/MM/DD parking dates using recency', () => {
    const groups = findDates('EN:26/03/17 12:00');
    expect(groups[0].map((g) => g.iso)).toContain('2026-03-17');
  });
});

describe('round 2 – receipts reported by the user', () => {
  it('Built Burger photo: total includes HST, Meals, brand not operator', () => {
    const r = parseReceipt(fx('builtburger_photo.txt'), { ...opts, today: '2026-11-25' });
    expect(r.total).toBe(26.56);
    expect(r.tax).toBe(3.06);
    expect(r.subtotal).toBe(23.5);
    expect(r.date).toBe('2026-11-23');
    expect(r.category).toBe('Meals');
    expect(r.merchant).toMatch(/uilt burger/i); // right line (not 'SSP Canada'); OCR may misread a letter
  });

  it('reads "H.S.T." and "Net:" on invoices', () => {
    const r = parseReceipt(fx('regionalhose_inv1.txt'), { ...opts, today: '2023-01-31' });
    expect(r.total).toBe(59.78);
    expect(r.tax).toBe(6.88);
    expect(r.subtotal).toBe(52.9);
    expect(r.merchant).toBe('REGIONAL HOSE');
  });

  it('card slip + 2 invoices → tax is the sum of invoice HST', () => {
    const today = '2023-01-31';
    const pages = ['regionalhose_slip.txt', 'regionalhose_inv1.txt', 'regionalhose_inv2.txt'].map((f) => ({ text: fx(f), parsed: parseReceipt(fx(f), { ...opts, today }) }));
    const c = combineReceipts(pages);
    expect(c.total).toBe(310.19);
    expect(c.tax).toBe(35.69);
    expect(c.subtotal).toBe(274.5);
    expect(c.date).toBe('2023-01-17');
  });

  it('two invoices without a slip are added up', () => {
    const today = '2023-01-31';
    const pages = ['regionalhose_inv1.txt', 'regionalhose_inv2.txt'].map((f) => ({ text: fx(f), parsed: parseReceipt(fx(f), { ...opts, today }) }));
    const c = combineReceipts(pages);
    expect(c.total).toBe(310.19);
    expect(c.tax).toBe(35.69);
  });
});

describe('OCR cross-checks', () => {
  const today = '2026-11-25';
  it('Burger pass A: "23:50" misread – never borrows the HST line as subtotal', () => {
    const r = parseReceipt(fx('builtburger_psm6_a.txt'), { ...opts, today });
    expect(r.total).toBe(26.56);
    expect(r.date).toBe('2026-11-23');
    expect(r.subtotal).not.toBe(3);
  });
  it('Burger pass B: tax "3.00" corrected to total − subtotal = 3.06', () => {
    const r = parseReceipt(fx('builtburger_psm6_b.txt'), { ...opts, today });
    expect(r.total).toBe(26.56);
    expect(r.tax).toBe(3.06);
    expect(r.subtotal).toBe(23.5);
  });
  it('Canadian Tire: unreadable TOTAL line → subtotal + HST found as "$ 81.3"', () => {
    const r = parseReceipt(fx('canadiantire_psm6.txt'), { ...opts, today: '2026-04-15' });
    expect(r.total).toBe(81.31);
    expect(r.tax).toBe(9.35);
    expect(r.subtotal).toBe(71.96);
  });
});

describe('combineReceipts – one document over several pages', () => {
  it('does not double-count a total repeated on two pages of the same email', () => {
    const p1 = parseReceipt('Adobe\nYou will be charged CAD $44.06 (incl. tax) monthly\nOrder Total CAD $44.06', opts);
    const p2 = parseReceipt('Adobe\nSubtotal CAD $38.99\nTax/VAT CAD $5.07\nOrder Total CAD $44.06', opts);
    const c = combineReceipts([{ parsed: p1, text: '' }, { parsed: p2, text: '' }]);
    expect(c.total).toBe(44.06);
    expect(c.tax).toBe(5.07);
  });
});
