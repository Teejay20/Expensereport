import { describe, expect, it } from 'vitest';
import { matchAll, parseStatement } from '../src/lib/statementParser';

// Synthetic statements in the layouts used by major Canadian issuers.
const RBC_STYLE = `
TRANSACTION POSTING ACTIVITY DESCRIPTION AMOUNT ($)
DATE DATE
MAR 02 MAR 03 UBER CANADA/UBERTRIP TORONTO ON 28.73
MAR 10 MAR 11 MISUMI USA INC SCHAUMBURG IL 36.33
Foreign Currency-USD 26.04 Exchange rate-1.395100
MAR 11 MAR 12 MISUMI USA INC SCHAUMBURG IL 24.22
Foreign Currency-USD 17.36 Exchange rate-1.395000
MAR 12 MAR 13 MISUMI USA INC SCHAUMBURG IL 107.86
MAR 13 MAR 14 PAYMENT - THANK YOU 500.00
MAR 17 MAR 18 MICHAELS #3405 WATERLOO ON 6.77
`;

const TD_STYLE = `
03/11/2026 03/12/2026 AMAZON.COM AMZN.COM/BILL WA USD 50.00 @ 1.3891 69.46
03/14/2026 03/15/2026 TIM HORTONS #1234 2.35
`;

describe('parseStatement', () => {
  it('reads month-name statements with foreign detail on the next line', () => {
    const t = parseStatement(RBC_STYLE, 2026, 3);
    expect(t).toHaveLength(5); // payment skipped
    const m = t.find((x) => x.amountCAD === 36.33)!;
    expect(m.date).toBe('2026-03-10');
    expect(m.foreignCurrency).toBe('USD');
    expect(m.foreignAmount).toBe(26.04);
    expect(m.rate).toBeCloseTo(1.3951, 4);
    expect(m.description).toBe('MISUMI USA INC SCHAUMBURG IL');
  });

  it('reads numeric-date statements with inline foreign amount', () => {
    const t = parseStatement(TD_STYLE, 2026, 3);
    expect(t[0]).toMatchObject({ date: '2026-03-11', amountCAD: 69.46, foreignCurrency: 'USD', foreignAmount: 50 });
    expect(t[1].amountCAD).toBe(2.35);
  });

  it('rolls December lines back a year on a January statement', () => {
    const t = parseStatement('DEC 30 DEC 31 HOTEL XYZ 120.00', 2027, 1);
    expect(t[0].date).toBe('2026-12-30');
  });
});

describe('matchAll', () => {
  it('matches foreign receipts to card lines one-to-one', () => {
    const txns = parseStatement(RBC_STYLE, 2026, 3);
    const expenses = [
      { id: 'a', date: '2026-03-10', currency: 'USD', total: 26.04, merchant: 'Misumi', description: 'Misumi' },
      { id: 'b', date: '2026-03-13', currency: 'USD', total: 17.36, merchant: 'Misumi', description: 'Misumi' },
      { id: 'c', date: '2026-03-12', currency: 'USD', total: 77.32, merchant: 'Misumi', description: 'Misumi' },
    ];
    const res = matchAll(expenses, txns);
    expect(res.get('a')?.txn.amountCAD).toBe(36.33);
    expect(res.get('b')?.txn.amountCAD).toBe(24.22);
    expect(res.get('c')?.txn.amountCAD).toBe(107.86);
  });

  it('does not match when the rate is implausible', () => {
    const txns = parseStatement('MAR 10 MAR 11 SOMETHING 500.00', 2026, 3);
    const res = matchAll([{ id: 'x', date: '2026-03-10', currency: 'USD', total: 20, merchant: 'X', description: 'X' }], txns);
    expect(res.size).toBe(0);
  });
});
