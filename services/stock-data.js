/**
 * Stock block-economics — the "block-money" layer of the stock advisor.
 *
 * Torn stock benefits (Stocks 3.0, all passive) are paid **per block**: every
 * block of a stock grants the benefit every `bonus.frequency` days. Requirements
 * are in **shares**:
 *
 *   - incremental shares of block N = req × 2^(N-1)
 *   - cumulative shares for N blocks  = req × (2^N - 1)
 *   - cash cost of that increment      = incrShares × currentPrice
 *
 * Payouts are cash, `Nx <item>` (valued live at the item market), or `N points`
 * (needs `pointsmarket` full-access key), or a non-cash perk/utility. Bank
 * comparison uses Torn's live per-term rates re-annualized.
 */

const { tornGet } = require('./torn-api');

const BANK_TERMS = { '1w': 7, '2w': 14, '1m': 30, '2m': 60, '3m': 90 };
const OWNER_KEY = process.env.TORN_API_KEY || '';

const cache = new Map();

function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const p = Promise.resolve()
    .then(loader)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    });
  cache.set(key, pending(p, key));
  return p;
}

function pending(p, key) {
  return {
    then(res, rej) { return p.then(res, rej); },
    catch(rej) { return p.catch(rej); },
  };
}

async function stockList() {
  const d = await tornGet('torn', '', 'stocks', 2, OWNER_KEY, { cacheTtl: 60 });
  return Object.values((d && d.stocks) || {}).map((s) => ({
    id: s.id,
    symbol: String(s.acronym || s.id || '').toUpperCase(),
    name: s.name || s.acronym || String(s.id),
    price: Number((s.market && s.market.price) || 0),
    cap: Number((s.market && s.market.cap) || 0),
    shares: Number((s.market && s.market.shares) || 0),
    investors: Number((s.market && s.market.investors) || 0),
    bonus: s.bonus || null,
  }));
}

async function itemsIndex() {
  return cached('items', 10 * 60 * 1000, async () => {
    const d = await tornGet('torn', '', 'items', 1, OWNER_KEY, { cacheTtl: 600 });
    const idx = {};
    for (const [id, item] of Object.entries((d && d.items) || {})) {
      const lower = String(item.name || '').toLowerCase();
      if (lower) idx[lower] = { id, name: item.name, market_value: Number(item.market_value) || 0 };
    }
    return idx;
  });
}

async function itemPrice(itemName) {
  const key = 'item:' + String(itemName).toLowerCase();
  return cached(key, 10 * 60 * 1000, async () => {
    const idx = await itemsIndex();
    const item = idx[String(itemName).toLowerCase()];
    if (!item) return 0;
    try {
      const d = await tornGet('market', String(item.id), 'itemmarket', 2, OWNER_KEY, { cacheTtl: 600, retries: 1 });
      const avg = d && d.itemmarket && Number(d.itemmarket.average_price);
      if (avg > 0) return avg;
    } catch (e) { /* fall back to items.market_value */ }
    return item.market_value || 0;
  });
}

async function propertyAvg() {
  return cached('properties', 12 * 60 * 60 * 1000, async () => {
    let d;
    try {
      d = await tornGet('torn', '', 'properties', 1, OWNER_KEY, { cacheTtl: 43200, retries: 1 });
    } catch (e) {
      return 0;
    }
    const costs = Object.values((d && d.properties) || {}).map((p) => Number(p.cost) || 0).filter((c) => c > 0);
    if (!costs.length) return 0;
    return costs.reduce((a, b) => a + b, 0) / costs.length;
  });
}

function parseBenefit(bonus) {
  const desc = (bonus && bonus.description || '').replace(/\s+/g, ' ').trim();
  const out = { desc, type: 'perk', cash: 0, qty: 1, item: '', points: 0, note: '' };
  if (!desc) return out;

  const cash = desc.match(/^\$([\d,]+)$/);
  if (cash) {
    out.type = 'cash';
    out.cash = Number(cash[1].replace(/,/g, ''));
    return out;
  }

  const item = desc.match(/^(\d+)x\s+(.+)$/i);
  if (item) {
    out.type = 'item';
    out.qty = Number(item[1]);
    out.item = item[2].trim();
    return out;
  }

  const points = desc.match(/^(\d+)\s+points?$/i);
  if (points) {
    out.type = 'points';
    out.points = Number(points[1]);
    return out;
  }

  const qtyNerve = desc.match(/^(50)\s+nerve$/i) || desc.match(/^(1000)\s+happiness$/i) || desc.match(/^(100)\s+energy$/i);
  if (qtyNerve) {
    out.type = 'utility';
    out.qty = Number(qtyNerve[1]);
    out.note = desc;
    return out;
  }

  // "1x Random Property" — a property, not a market item; price via avg property cost.
  const rp = desc.match(/^1x\s+Random\s+Property$/i);
  if (rp) {
    out.type = 'perk';
    out.item = 'Random Property';
    out.note = desc;
    return out;
  }

  out.type = 'perk';
  out.note = desc;
  return out;
}

async function benefitValue(bonus) {
  const b = parseBenefit(bonus);
  const freq = Number(bonus && bonus.frequency) || 0;
  const payoutsPerYear = freq > 0 ? 365 / freq : 0;

  if (b.type === 'cash') {
    return { ...b, perBlock: b.cash, annual: b.cash * payoutsPerYear, payoutsPerYear, priced: true, note: '' };
  }
  if (b.type === 'item') {
    let perBlock = 0;
    let priced = true;
    let note = '';
    if (/^Random Property$/i.test(b.item || '')) {
      const avg = await propertyAvg();
      perBlock = avg > 0 ? avg * b.qty : 0;
      if (!perBlock) { priced = false; note = 'avg property value unavailable'; }
    } else {
      perBlock = await itemPrice(b.item) * b.qty;
      if (!perBlock) { priced = false; note = 'no market price found'; }
    }
    return { ...b, perBlock, annual: perBlock * payoutsPerYear, payoutsPerYear, priced, note };
  }
  if (b.type === 'points') {
    return { ...b, perBlock: 0, annual: 0, payoutsPerYear, priced: false, note: 'points value needs pointsmarket access' };
  }
  return { ...b, perBlock: 0, annual: 0, payoutsPerYear, priced: false, note: '' };
}

function blockIncrementShares(req, shares, n) {
  if (shares != null) {
    const blocks = blocksHeld(shares, req);
    return req * Math.pow(2, blocks);
  }
  return req * Math.pow(2, n - 1);
}

function blocksHeld(totalShares, req) {
  if (!req || !totalShares) return 0;
  if (totalShares < req) return 0;
  return Math.floor(Math.log2(totalShares / req + 1));
}

async function bankRates() {
  return cached('bank', 10 * 60 * 1000, async () => {
    let d;
    try {
      d = await tornGet('torn', '', 'bank', 1, OWNER_KEY, { cacheTtl: 600, retries: 1 });
    } catch (e) {
      return null;
    }
    const rates = (d && d.bank) || {};
    let best = null;
    for (const [term, days] of Object.entries(BANK_TERMS)) {
      const r = Number(rates[term]) || 0;
      if (!r) continue;
      // Torn publishes these as APR (annual percentage rate) per term — the
      // official economic reports plot them as an APR yield curve, so the value
      // is directly comparable to a stock block's annualized payout/cost.
      if (!best || r > best.apr) best = { term, days, rate: r, apr: r };
    }
    return { perTerm: rates, best };
  });
}

async function getUserStocks(apiKey) {
  if (!apiKey) return {};
  const d = await tornGet('user', '', 'stocks', 2, apiKey, { cacheTtl: 60, retries: 1 });
  const raw = (d && d.stocks) || {};
  const held = {};
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const id = String(s.stock_id != null ? s.stock_id : s.id || '');
      if (!id) continue;
      held[id] = dblShares(s);
    }
  } else {
    for (const [id, s] of Object.entries(raw)) {
      held[String(id)] = dblShares(s);
    }
  }
  return held;
}

function dblShares(s) {
  const shares = Number(s && (s.total_shares != null ? s.total_shares : s.shares)) || 0;
  return {
    shares,
    boughtPrice: Number(s && (s.bought_price != null ? s.bought_price : s.total_spent)) || 0,
    totalSpent: Number(s && s.total_spent) || 0,
  };
}

async function getUserWallet(apiKey) {
  if (!apiKey) return 0;
  let d;
  try {
    d = await tornGet('user', '', 'money', 2, apiKey, { cacheTtl: 60, retries: 1 });
  } catch (e) {
    return 0;
  }
  return Number((d && d.money && d.money.wallet)) || 0;
}

function clearDataCache() {
  cache.clear();
}

module.exports = {
  stockList,
  itemPrice,
  itemsIndex,
  propertyAvg,
  parseBenefit,
  benefitValue,
  blocksHeld,
  blockIncrementShares,
  bankRates,
  getUserStocks,
  getUserWallet,
  clearDataCache,
};