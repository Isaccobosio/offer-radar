// Signals that the product description has ended and compatibility noise begins
const NOISE_BOUNDARIES = [
  /compatib[il]/i,
  /funziona con/i,
  /works with/i,
  /adatto per/i,
  /ideale per/i,
  /in the box/i,
  /nella confezione/i,
  /colori disponibili/i,
  /modelli compatibili/i,
  /\bper (iphone|ipad|samsung|android|apple watch|huawei|xiaomi|oppo|pixel)\b/i,
  /\bcarica (iphone|ipad|airpods|samsung|android)\b/i,
];

// Promotional noise to strip from product name (trailing)
const PROMO_TAIL = [
  /\s+in offerta\b.*/i,
  /\s+su (amazon|ebay|zalando|mediaworld|unieuro|euronics|walmart)\b.*/i,
  /\s*[-–]\s*(offerta|sconto|promo|deal|sale)\b.*/i,
  /\s+al prezzo di\b.*/i,
  /\s+prezzo minimo\b.*/i,
  /\s+disponibile su\b.*/i,
  /\s*[-–]\s*sconto\s+\d+%\b.*/i,
  // Strip trailing price (e.g. "Cuffie Wireless €279", "TV 55\" - 1.299,00€")
  /\s*[-–]?\s*(?:€|euro)\s*[\d.,]+.*$/i,
  /\s*[-–]?\s*[\d.,]+\s*(?:€|euro).*$/i,
];

// Lines that are never a product title
const SKIP_LINE = [
  /^https?:\/\//i,
  /^(usa il codice|coupon|sconto del|offerta valida|disponibile su|su amazon|link in bio|promo code)/i,
  /^\s*$/,
];

/**
 * Robust Italian price parser.
 * Handles EU format (1.299,00€), US format (39.99€), integer (229€).
 * Returns integer cents or null.
 */
function parsePriceCents(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str.replace(/[€$£\s]/g, '').replace(/\beuro\b/gi, '').trim();

  if (s.includes(',') && s.includes('.')) {
    // Both: last separator is decimal → "1.299,00" → remove dots, comma→dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    // Only comma: "39,99" → decimal
    s = s.replace(',', '.');
  } else if (/\.\d{3}$/.test(s)) {
    // Dot followed by exactly 3 digits = EU thousands: "1.699" → "1699"
    s = s.replace(/\./g, '');
  }
  // else: "39.99" → standard decimal, leave as-is

  const match = s.match(/^\d+(?:\.\d+)?/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  return isNaN(val) ? null : Math.round(val * 100);
}

/**
 * Extract price string from raw text.
 * Matches: €229, €1.099,00, 229€, 39,99€, 229 euro, euro 39.99
 */
function extractPriceString(text) {
  // Pattern covers optional thousands (X.XXX) + optional decimal (,XX or .XX)
  const num = /\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+/;
  const patterns = [
    new RegExp(`€\\s*(${num.source})`, 'i'),
    new RegExp(`(${num.source})\\s*€`, 'i'),
    new RegExp(`euro\\s+(${num.source})`, 'i'),
    new RegExp(`(${num.source})\\s+euro\\b`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

/**
 * Extract structured product info from raw Telegram channel post text.
 * Rule-based — fast, no LLM quota used. LLM refines later via updateOffer.
 *
 * @param {string} rawText
 * @returns {{ product_name: string|null, price: string|null, price_cents: number|null }}
 */
function extractProductInfo(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { product_name: null, price: null, price_cents: null };
  }

  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 2 && !SKIP_LINE.some(p => p.test(l)));

  let productLine = null;

  for (const line of lines.slice(0, 4)) {
    let clean = line;

    // Truncate at compatibility noise boundaries
    for (const pat of NOISE_BOUNDARIES) {
      const idx = clean.search(pat);
      if (idx >= 0 && idx <= 10) {
        clean = '';  // noise too early — skip line
        break;
      }
      if (idx > 10) {
        clean = clean.slice(0, idx).replace(/[\s,.\-:]+$/, '');
      }
    }

    // Strip trailing promotional noise
    for (const pat of PROMO_TAIL) {
      clean = clean.replace(pat, '').trim();
    }

    // Strip emoji and URLs
    clean = clean
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (clean.length > 5) {
      productLine = clean.slice(0, 100);
      break;
    }
  }

  const priceRaw = extractPriceString(rawText);
  const price_cents = priceRaw ? parsePriceCents(priceRaw) : null;

  return {
    product_name: productLine,
    price: priceRaw,
    price_cents,
  };
}

module.exports = { extractProductInfo, parsePriceCents };
