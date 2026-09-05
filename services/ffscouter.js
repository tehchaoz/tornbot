const fetch = globalThis.fetch;

const BASE = 'https://ffscouter.com/api/v1';
const RATE_LIMIT_PER_MINUTE = 5;
const CACHE_TTL_MS = 90 * 1000;
const NOT_REGISTERED_TTL_MS = 5 * 60 * 1000;

const cache = new Map();
const rateWindow = [];
const unregistered = new Map();

function isRateLimited() {
  const now = Date.now();
  while (rateWindow.length && now - rateWindow[0] > 60000) rateWindow.shift();
  return rateWindow.length >= RATE_LIMIT_PER_MINUTE;
}

function recordRequest() {
  rateWindow.push(Date.now());
}

function getCached(rawUrl) {
  const entry = cache.get(rawUrl);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(rawUrl);
    return null;
  }
  return entry.data;
}

function setCached(rawUrl, data) {
  cache.set(rawUrl, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function request(path, params, { ttl }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    qs.set(k, String(v));
  }
  const rawUrl = `${BASE}${path}?${qs.toString()}`;

  const cached = getCached(rawUrl);
  if (cached) return cached;

  const key = params.key;
  const notRegisteredAt = unregistered.get(key);
  if (notRegisteredAt && Date.now() - notRegisteredAt < NOT_REGISTERED_TTL_MS) {
    throw Object.assign(new Error('FFScouter API key not registered'), { code: 6, silent: true });
  }

  if (isRateLimited()) {
    throw Object.assign(new Error('FFScouter rate limited'), { code: 20, silent: true });
  }

  let res;
  try {
    res = await fetch(rawUrl, { timeout: 10000 });
  } catch (e) {
    throw Object.assign(new Error('FFScouter fetch failed: ' + e.message), { code: -1, silent: true });
  }
  recordRequest();

  const j = await res.json().catch(() => null);
  if (!j) throw Object.assign(new Error('FFScouter response parse failed'), { code: -1, silent: true });

  if (j.code === 6) {
    unregistered.set(key, Date.now());
    throw Object.assign(new Error('FFScouter API key not registered'), { code: 6, silent: true });
  }
  if (j.error) {
    throw Object.assign(new Error(`FFScouter error ${j.code}: ${j.error}`), { code: j.code, silent: true });
  }

  setCached(rawUrl, j);
  return j;
}

async function findTargets({ key, preset, minLevel, maxLevel, inactiveOnly, minFf, maxFf, factionless, limit }) {
  const j = await request('/get-targets', {
    key,
    preset: preset || null,
    minlevel: minLevel == null ? null : minLevel,
    maxlevel: maxLevel == null ? null : maxLevel,
    inactiveonly: inactiveOnly == null ? null : inactiveOnly,
    minff: minFf == null ? null : minFf,
    maxff: maxFf == null ? null : maxFf,
    factionless: factionless == null ? null : factionless,
    limit: limit == null ? null : limit,
  }, { ttl: CACHE_TTL_MS });
  return Array.isArray(j.targets) ? j.targets : [];
}

async function getStats({ key, targets }) {
  const j = await request('/get-stats', { key, targets: targets.join(',') }, { ttl: CACHE_TTL_MS });
  return Array.isArray(j) ? j : [];
}

module.exports = { findTargets, getStats };