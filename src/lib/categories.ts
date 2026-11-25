// Merchant recognition + category suggestion. Pure functions (unit tested).

interface MerchantRule {
  /** Display name used as the default description. */
  name: string;
  pattern: RegExp;
  category: string;
  /** Generic rules only suggest a category; the merchant name comes from the receipt itself. */
  generic?: boolean;
}

// Order matters: first match wins.
export const MERCHANT_RULES: MerchantRule[] = [
  { name: 'Uber', pattern: /\buber\b|trip details[\s\S]{0,200}kilomet|courier saver/i, category: 'Travel' },
  { name: 'Lyft', pattern: /\blyft\b/i, category: 'Travel' },
  { name: 'UW parking', pattern: /universit\w*\s+of\s+wat\w*|waterl\w+\s+receipt|lot\s+h\s+visitor|parking location|lot [a-z] visitor|\bAMP purchase receipt/i, category: 'Travel' },
  { name: 'Parking', generic: true, pattern: /\b(impark|green\s?p|indigo|honk|paybyphone|precise parklink|parking)\b/i, category: 'Travel' },
  { name: 'Air Canada', pattern: /air\s?canada/i, category: 'Travel' },
  { name: 'WestJet', pattern: /westjet/i, category: 'Travel' },
  { name: 'Porter', pattern: /porter airlines/i, category: 'Travel' },
  { name: 'VIA Rail', pattern: /via\s?rail/i, category: 'Travel' },
  { name: 'GO Transit', pattern: /\bgo transit|presto\b/i, category: 'Travel' },
  { name: 'Esso', pattern: /\besso\b/i, category: 'Travel' },
  { name: 'Petro-Canada', pattern: /petro[- ]?canada/i, category: 'Travel' },
  { name: 'Shell', pattern: /\bshell\b/i, category: 'Travel' },
  { name: 'Hotel', generic: true, pattern: /\b(marriott|hilton|hyatt|holiday inn|best western|sheraton|airbnb|hotel|inn & suites)\b/i, category: 'Travel' },
  { name: 'Enterprise', pattern: /enterprise rent|\bhertz\b|\bavis\b|budget rent/i, category: 'Travel' },
  { name: 'Adobe', pattern: /\badobe\b/i, category: 'Office' },
  { name: 'Microsoft', pattern: /\bmicrosoft\b/i, category: 'Office' },
  { name: 'Google Workspace', pattern: /google workspace|g suite/i, category: 'Office' },
  { name: 'Zoom', pattern: /\bzoom\.us|zoom video/i, category: 'Office' },
  { name: 'Staples', pattern: /\bstaples\b/i, category: 'Office' },
  { name: 'Canada Post', pattern: /canada post|postes canada/i, category: 'Office' },
  { name: 'Misumi', pattern: /\bmisumi\b/i, category: 'Engineering/R&D' },
  { name: 'McMaster-Carr', pattern: /mcmaster/i, category: 'Engineering/R&D' },
  { name: 'DigiKey', pattern: /digi-?key/i, category: 'Engineering/R&D' },
  { name: 'Mouser', pattern: /\bmouser\b/i, category: 'Engineering/R&D' },
  { name: 'Canadian Tire', pattern: /canadian\s+tire/i, category: 'Engineering/R&D' },
  { name: 'Home Depot', pattern: /home\s?depot/i, category: 'Engineering/R&D' },
  { name: 'Lowe\'s', pattern: /\blowe'?s\b/i, category: 'Engineering/R&D' },
  { name: 'Princess Auto', pattern: /princess auto/i, category: 'Engineering/R&D' },
  { name: 'Michaels', pattern: /\bmichaels\b/i, category: 'Engineering/R&D' },
  { name: 'Amazon', pattern: /\bamazon\b/i, category: 'Engineering/R&D' },
  { name: 'Best Buy', pattern: /best\s?buy/i, category: 'Equipment' },
  { name: 'Dell', pattern: /\bdell\b/i, category: 'Equipment' },
  { name: 'Tim Hortons', pattern: /tim\s?horton/i, category: 'Meals' },
  { name: 'Starbucks', pattern: /starbucks/i, category: 'Meals' },
  { name: 'McDonald\'s', pattern: /mcdonald/i, category: 'Meals' },
  { name: 'Restaurant', generic: true, pattern: /\b(restaurant|bistro|grill|cafe|café|pizza|sushi|pub|eatery|kitchen|doordash|skip the dishes|ubereats|uber eats|burger|burgers|bowl|fries|combo|to go|dine[- ]in|take[- ]?out|server|table \d+|gratuity|tip|sandwich|shawarma|noodle|taco|bakery|coffee|latte|food court)\b/i, category: 'Meals' },
  { name: 'Conference', generic: true, pattern: /\b(conference|trade ?show|expo|registration|summit|eventbrite)\b/i, category: 'Trade Show Fees' },
  { name: 'Ads', generic: true, pattern: /\b(google ads|facebook ads|meta ads|linkedin ads|advertis)/i, category: 'Advertising' },
];

// Uber Eats must win over Uber.
const PRIORITY_FIRST: MerchantRule[] = [
  { name: 'Uber Eats', pattern: /uber\s?eats/i, category: 'Meals' },
];

/** A named brand (Uber, Adobe, …) found in the text. */
export function recognizeMerchant(text: string): MerchantRule | undefined {
  for (const r of [...PRIORITY_FIRST, ...MERCHANT_RULES]) if (!r.generic && r.pattern.test(text)) return r;
  return undefined;
}

/** Category suggested by generic words (parking, hotel, burger, conference…). */
export function inferCategory(text: string): string | undefined {
  return MERCHANT_RULES.find((r) => r.generic && r.pattern.test(text))?.category;
}

/** Food-court / airport operators printed above the actual brand name. */
export const OPERATOR_LINES = /^(ssp( canada)?|hmshost|host international|compass group|aramark|sodexo|otg|paradies)\b/i;

export function normalizeMerchantKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}
