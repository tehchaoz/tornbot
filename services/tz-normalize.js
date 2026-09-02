const ZONES = [
  { names: ['eastern', 'eastern standard', 'est', 'edt', 'et'], std: -5, dst: -4, tag: 'ET' },
  { names: ['central', 'cst', 'cdt', 'ct'], std: -6, dst: -5, tag: 'CT' },
  { names: ['mountain', 'mst', 'mdt', 'mt'], std: -7, dst: -6, tag: 'MT' },
  { names: ['pacific', 'pst', 'pdt', 'pt'], std: -8, dst: -7, tag: 'PT' },
  { names: ['alaska', 'akst', 'akdt', 'akt'], std: -9, dst: -8, tag: 'AKT' },
  { names: ['hawaii', 'hst', 'hdt', 'aleutian'], std: -10, dst: -10, tag: 'HT' },
  { names: ['west coast', 'beijing', 'china', 'malaysia', 'singapore', 'philippines', 'manila', 'hong kong', 'taipei', 'taiwan', 'sgt'], std: 8, dst: 8, tag: 'CNST' },
  { names: ['japan', 'tokyo', 'jst', 'korea', 'seoul', 'kst'], std: 9, dst: 9, tag: 'JST' },
  { names: ['australia', 'eastern australia', 'sydney', 'melbourne', 'brisbane', 'canberra', 'aest', 'aedt', 'aet'], std: 10, dst: 11, tag: 'AET' },
  { names: ['central australia', 'adelaide', 'darwin', 'acst', 'acdt'], std: 9.5, dst: 10.5, tag: 'ACT' },
  { names: ['western australia', 'perth', 'awst'], std: 8, dst: 8, tag: 'AWST' },
  { names: ['new zealand', 'auckland', 'wellington', 'nzst', 'nzdt'], std: 12, dst: 13, tag: 'NZT' },
  { names: ['india', 'mumbai', 'delhi', 'kolkata', 'ist'], std: 5.5, dst: 5.5, tag: 'IST' },
  { names: ['indonesia', 'jakarta', 'wib', 'thailand', 'bangkok', 'vietnam', 'hanoi'], std: 7, dst: 7, tag: 'WIB' },
  { names: ['russia', 'moscow', 'msk'], std: 3, dst: 3, tag: 'MSK' },
  { names: ['eastern europe', 'greece', 'athens', 'romania', 'bucharest', 'bulgaria', 'turkey', 'istanbul', 'ukraine', 'kyiv', 'kiev', 'finland', 'helsinki', 'eet', 'eest'], std: 2, dst: 3, tag: 'EET' },
  { names: ['uk', 'britain', 'england', 'london', 'ireland', 'dublin', 'scotland', 'greenwich', 'gmt', 'bst', 'western europe', 'portugal', 'lisbon'], std: 0, dst: 1, tag: 'GMT' },
  { names: ['spain', 'madrid', 'paris', 'france', 'berlin', 'germany', 'monaco', 'italy', 'rome', 'netherlands', 'amsterdam', 'belgium', 'brussels', 'poland', 'warsaw', 'sweden', 'stockholm', 'norway', 'austria', 'vienna', 'switzerland', 'zurich', 'czech', 'prague', 'hungary', 'budapest', 'denmark', 'copenhagen', 'croatia', 'slovenia', 'cet', 'cest', 'central europe', 'west europe', 'europe'], std: 1, dst: 2, tag: 'CET' },
];

const STOPWORDS = new Set(['us', 'usa', 'united', 'states', 'america', 'north', 'south', 'time', 'zone', 'zones', 'area', 'standard', 'daylight', 'saving', 'savings', 'observed']);
const NAME_TOKEN = /utc|ut|gmt|europe|[a-z]{2,}/gi;

function fmtOffset(hours) {
  const sign = hours < 0 ? '-' : '+';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `${sign}${h}${m ? ':' + ('0' + m).slice(-2) : ''}`;
}

function fromOffsets(std, dst) {
  const base = `UTC${fmtOffset(std)}`;
  if (dst === std) return base;
  return `${base}/${fmtOffset(dst)}`;
}

function parseClockNum(s) {
  const v = s.replace(/[±−]/g, '-');
  if (v.includes(':')) {
    const [h, m] = v.split(':');
    return parseFloat(h) + (m ? parseInt(m, 10) / 60 : 0);
  }
  return parseFloat(v);
}

function extractOffsets(input) {
  const hit = /(?:utc|ut|gmt)[^0-9]*|[+\-±−]/.test(input);
  if (!hit) return null;
  const nums = (input.match(/[+\-−]?[0-9]{1,2}(?::[0-9]{2})?/g) || []).map(parseClockNum).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const std = nums[0];
  const dst = nums.length > 1 ? nums[1] : std;
  const valid = (n) => n >= -14 && n <= 14;
  if (!valid(std) || !valid(dst)) return null;
  return { std, dst };
}

function matchNamed(input) {
  const lc = input.toLowerCase();
  const tokens = new Set((lc.match(NAME_TOKEN) || []).filter((w) => !STOPWORDS.has(w)));
  const hasEurope = tokens.has('europe');

  if (hasEurope) {
    const eu = ZONES.find((z) => z.tag === 'EET');
    const cet = ZONES.find((z) => z.tag === 'CET');
    const gmt = ZONES.find((z) => z.tag === 'GMT');
    if (tokens.has('eastern')) return tokens.has('middle') ? cet : eu;
    if (tokens.has('western') || tokens.has('uk') || tokens.has('britain') || tokens.has('gmt')) return gmt;
    return cet;
  }

  for (const z of ZONES) {
    for (const name of z.names) {
      const n = name.toLowerCase();
      if (!n || n === 'europe') continue;
      const isAbbrev = /^[a-z]{2,4}$/.test(n) && !n.includes(' ');
      if (isAbbrev) {
        if (tokens.has(n)) return z;
      } else if (lc.includes(n)) {
        return z;
      }
    }
  }
  return null;
}

function normalize(raw) {
  const input = String(raw || '').trim();
  if (!input) return { code: input, display: '' };

  const named = matchNamed(input);
  if (named) {
    const base = fromOffsets(named.std, named.dst);
    return { code: base, display: `${base} (${named.tag})` };
  }

  const off = extractOffsets(input);
  if (off) {
    const base = fromOffsets(off.std, off.dst);
    return { code: base, display: base };
  }

  const tidied = input.replace(/\s+/g, ' ').trim();
  const cleaned = tidied.replace(/\b\w+\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  return { code: cleaned, display: cleaned };
}

module.exports = { normalize };
