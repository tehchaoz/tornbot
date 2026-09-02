const fetch = globalThis.fetch;

const RATE_LIMIT_PER_MINUTE = 90;
const CACHE_TTL_SHORT = 30;
const CACHE_TTL_MEDIUM = 300;
const CACHE_TTL_LONG = 3600;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const keyState = new Map();
const cache = new Map();

function getKeyState(key) {
  if (!keyState.has(key)) {
    keyState.set(key, {
      requests: [],
      errors: 0,
      lastError: 0,
      cooldownUntil: 0,
    });
  }
  return keyState.get(key);
}

function isRateLimited(key) {
  const state = getKeyState(key);
  const now = Date.now();
  if (state.cooldownUntil > now) return true;
  state.requests = state.requests.filter(t => now - t < 60000);
  return state.requests.length >= RATE_LIMIT_PER_MINUTE;
}

function recordRequest(key) {
  const state = getKeyState(key);
  state.requests.push(Date.now());
}

function recordError(key) {
  const state = getKeyState(key);
  state.errors++;
  state.lastError = Date.now();
  if (state.errors >= 5) {
    state.cooldownUntil = Date.now() + 60000;
    console.error(`[torn-api] key ...${key.slice(-4)} cooling down for 60s after ${state.errors} errors`);
  }
}

function clearErrors(key) {
  const state = getKeyState(key);
  state.errors = 0;
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttlSeconds) {
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function cacheKey(section, id, selections, version, apiKey) {
  return `${apiKey.slice(-8)}:${version || 'v1'}:${section}:${id || ''}:${selections}`;
}

async function tornGet(section, id, selections, version, apiKey, options = {}) {
  const { cacheTtl, skipCache, retries } = options;
  const ttl = cacheTtl || 0;

  if (ttl && !skipCache) {
    const ck = cacheKey(section, id, selections, version, apiKey);
    const cached = getCache(ck);
    if (cached) return cached;
  }

  if (isRateLimited(apiKey)) {
    throw new Error('Rate limit approaching — please try again shortly');
  }

  const sid = id ? `/${encodeURIComponent(id)}` : '';
  const ver = version === 2 ? '/v2' : '';
  const url = `https://api.torn.com${ver}/${section}${sid}?selections=${selections}&key=${encodeURIComponent(apiKey)}`;

  let lastError;
  const maxAttempts = (retries != null ? retries : 2) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      recordRequest(apiKey);
      const res = await fetch(url, { timeout: 10000 });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data && data.error ? data.error.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      if (data && data.error) {
        const code = data.error.code;
        const msg = data.error.error;

        if (code === 5) {
          const state = getKeyState(apiKey);
          state.cooldownUntil = Date.now() + 30000;
          throw new Error('Torn API rate limit hit — retrying in 30s');
        }

        if (code === 1 || code === 2 || code === 10 || code === 13 || code === 18) {
          recordError(apiKey);
          throw new Error(`Torn API: ${msg}`);
        }

        throw new Error(msg);
      }

      clearErrors(apiKey);

      if (ttl) {
        const ck = cacheKey(section, id, selections, version, apiKey);
        setCache(ck, data, ttl);
      }

      return data;
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  throw lastError;
}

function clearCache() {
  cache.clear();
}

function getKeyStats(key) {
  const state = getKeyState(key);
  const now = Date.now();
  return {
    recentRequests: state.requests.filter(t => now - t < 60000).length,
    errors: state.errors,
    cooldown: state.cooldownUntil > now ? Math.ceil((state.cooldownUntil - now) / 1000) : 0,
  };
}

module.exports = { tornGet, clearCache, getKeyStats };
