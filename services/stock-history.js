/**
 * Tornsy stock price history (public candle service used by the Torn
 * stock-tooling community). Torn's own API does not expose multi-day stock
 * price history, so forecasts in `!stocks` / `!stockforecast` are built from
 * these daily candles instead. No Torn API key required.
 *
 * Row format: [timestamp (s), open, high, low, close, volume].
 */

const cache = new Map();
const TTL_MS = 10 * 60 * 1000; // refresh every 10 minutes

async function getDailyHistory(symbol) {
  const key = String(symbol || '').toUpperCase();
  if (!key) throw new Error('No symbol provided');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.points;

  const res = await fetch(`https://tornsy.com/api/${encodeURIComponent(key)}?interval=d1`, { timeout: 8000 });
  if (!res.ok) throw new Error(`Tornsy HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const rows = (data && data.data) || [];
  const points = rows
    .filter((r) => r && r.length >= 5 && Number(r[4]) > 0)
    .map((r) => ({ t: Number(r[0]), p: Number(r[4]) }))
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error(`No Tornsy history for ${key}`);
  cache.set(key, { at: Date.now(), points });
  return points;
}

function clearHistoryCache() {
  cache.clear();
}

module.exports = { getDailyHistory, clearHistoryCache };