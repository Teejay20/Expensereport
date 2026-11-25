# Expense Snap

Scan receipts, log car trips and export the monthly **ExpensesReimbursementForm** (Excel + receipts PDF) — from your phone, for free.

- **Runs entirely on the phone.** Receipts are read on-device (Tesseract OCR, WebAssembly). Data lives in the phone's local database (IndexedDB). No server, no account, no cost.
- **Android + iPhone** from one codebase: it is an installable web app (PWA). Install once from the link, then it works offline like a normal app.
- **Up to 10 people**: everyone installs from the same link; each phone keeps its own private data.

## Features

| Need | How |
|---|---|
| Scan paper receipt | **Scan** opens the camera → OCR fills date, merchant, category, currency, total, tax. Detected amounts appear as chips: tap one to fix a mis-read. |
| Emailed receipt | **Upload** a PDF or screenshot (several at once → batch import with a *review* tag). Android: share a Gmail attachment straight to *Expenses*. PDFs use their text layer; broken scanner text layers fall back to OCR. |
| Car mileage | **Trip**: A → up to 4 stops → B, optional round trip. Distance via OpenStreetMap routing; a route map image is generated and put in the receipts PDF. Amount = km × CRA rate (default $0.73/km, editable). *Open in Google Maps* + *Attach screenshot* if a Google picture is required. |
| Foreign currency | Receipt currency is detected (USD/EUR/…). At **Month-end**, upload your credit-card statement (PDF/screenshot): transactions are matched by date + amount (or the statement's own "USD 26.04" detail) and the real CAD charge is used. Or type it, or use a Bank of Canada estimate (flagged). |
| Export | **Month-end → Share both** (or download): `ExpensesReimbursementForm_<Initials>_<Month>_<YYYY>.xlsx` + `.pdf`. Excel reproduces the company template (README / month / Picklist sheets, formulas, dropdowns). PDF = form page + every receipt/map in row order. |
| Backup | Settings → Backup/Restore (single JSON file). Use it monthly and to move phones. |

## Install (each user)

1. Open the app link (see *Hosting* below).
   - **iPhone**: in **Safari** → Share → **Add to Home Screen**.
   - **Android**: in **Chrome** → ⋮ → **Install app**.
2. Open *Expenses* → Settings → enter name + Interac email → Save.

## Hosting (free, one time)

The app is static files; GitHub Pages hosts them for free.

1. Create a **public** GitHub repo (e.g. `expense-snap`) and push this folder to `main`.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push runs tests and publishes to `https://<user>.github.io/expense-snap/`.

Only the app code is public — no expense data ever leaves the phones.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (use --host URL on your phone, same Wi-Fi)
npm test           # parser, statement matching, Excel/PDF export tests
npm run build
```

### Layout

```
src/lib/receiptParser.ts   text → merchant/date/currency/total/tax  (pure, tested on real receipts)
src/lib/statementParser.ts card statement → transactions; foreign-receipt matching
src/lib/report.ts          month report model, file naming, CAD conversion rules
src/lib/export/xlsx.ts     company Excel template
src/lib/export/pdf.ts      form page + receipts bundle
src/lib/ingest.ts          file → stored attachment + OCR/PDF text → parsed fields
src/lib/ocr.ts, image.ts   on-device OCR + image clean-up (dark-mode invert, contrast, trim)
src/lib/maps.ts            OpenStreetMap geocoding/routing + static map rendering
src/lib/fx.ts              Bank of Canada reference rates (estimate only)
src/lib/db.ts              IndexedDB (Dexie): expenses, attachments, settings, merchant memory
src/sw.ts                  offline cache + Android share target
src/screens/*              UI
tests/fixtures/*           OCR/PDF text of real receipts (personal data redacted)
```

### Rules encoded

- CAD receipts: Pre-HST = total − tax, Tax = tax.
- Foreign receipts (as in the sample form): CAD-converted total goes in *Pre HST (CAD)*, tax blank; Foreign Currency section gets currency, pre-tax, tax, total, rate (= card CAD ÷ foreign total) and `=ROUND(L*K,2)`.
- Mileage: Category *Travel*, description lists the route, amount = km × rate; map page in the PDF.
- Receipt column = `Y` when an attachment exists.

### Known limits

- OCR of crumpled/curled thermal paper is imperfect — the app highlights detected amounts so a correction is one tap, and warns when subtotal + tax ≠ total. Flat, well-lit photos filling the frame work best.
- Address search/routing/exchange rates need internet; everything else works offline.
- iPhone has no "share into app" for web apps — save the attachment to Files, then use **Upload**.
