// Core domain model. Everything is stored locally in IndexedDB on the device.

export const CATEGORIES = [
  'Travel',
  'Advertising',
  'Office',
  'Trade Show Fees',
  'Meals',
  'Equipment',
  'Engineering/R&D',
] as const;
export type Category = (typeof CATEGORIES)[number] | string;

export type ExpenseKind = 'receipt' | 'mileage';

/** How the CAD amount of a foreign-currency expense was established. */
export type FxSource = 'statement' | 'manual' | 'estimate';

export interface MileageInfo {
  /** 2–6 addresses: start, up to 4 stops, end. */
  stops: string[];
  distanceKm: number;
  /** Distance computed by the router before any manual override. */
  routedKm?: number;
  roundTrip: boolean;
  ratePerKm: number;
  /** Geocoded coordinates of each stop (so editing doesn't need to re-geocode). */
  points?: { label: string; lat: number; lon: number }[];
}

export interface Expense {
  id: string;
  kind: ExpenseKind;
  /** ISO date YYYY-MM-DD */
  date: string;
  category: Category;
  description: string;
  merchant?: string;
  /** ISO 4217 code of the receipt. */
  currency: string;
  /** Amounts in receipt currency. */
  preTax: number;
  tax: number;
  total: number;
  /** For foreign currency only: what the credit card actually charged in CAD. */
  cadCharged?: number;
  fxSource?: FxSource;
  /** Reference rate (e.g. Bank of Canada) used for an estimate or sanity check. */
  fxReference?: number;
  mileage?: MileageInfo;
  attachmentIds: string[];
  notes?: string;
  ocrText?: string;
  /** Set for batch-imported receipts until the user has reviewed them. */
  needsReview?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Attachment {
  id: string;
  expenseId?: string;
  name: string;
  mime: string; // image/jpeg | image/png | application/pdf
  blob: Blob;
  /** 'receipt' | 'map' | 'statement' */
  role: 'receipt' | 'map' | 'statement';
  createdAt: number;
}

export interface Settings {
  id: 'me';
  fullName: string;
  /** e.g. "JSmith" — used in file names. Auto-derived from name if empty. */
  fileInitials: string;
  interacEmail: string;
  homeCurrency: string; // CAD
  kmRate: number; // CRA rate, $/km
  fileNamePattern: string; // tokens: {initials} {Month} {MM} {YYYY} {YY}
  /** Date style used when a receipt date is ambiguous (03/04/2026). */
  dateOrder: 'MDY' | 'DMY';
  homeAddress?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'me',
  fullName: '',
  fileInitials: '',
  interacEmail: '',
  homeCurrency: 'CAD',
  kmRate: 0.73,
  fileNamePattern: 'ExpensesReimbursementForm_{initials}_{Month}_{YYYY}',
  dateOrder: 'MDY',
  homeAddress: '',
};

/** Merchant memory: learns category/description the user chose last time. */
export interface MerchantMemory {
  key: string; // normalized merchant
  category: string;
  description: string;
  uses: number;
  updatedAt: number;
}
