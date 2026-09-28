const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');
const { findTargets, getStats } = require('../services/ffscouter');

const FACTION_ID = process.env.FACTION_ID || '';
const OWNER_KEY = process.env.TORN_API_KEY || '';

const LEVEL_BAND = 3;
const FF_MAX_LEVEL_GAP = 10;
const MAX_SHOW = 5;
const CANDIDATE_CAP = 20;
const FFSCOUTER_CAP = 8;

const ATTACKABLE = new Set(['OK', 'Idle', 'Okay']);
const BORDERLINE_FF = 1.5;

function fmt(n) {
  if (n == null) return '?';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1e9) return (num / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.?0$/, '') + 'k';
  return String(num);
}

function totalStats(bs) {
  if (!bs) return null;
  if (bs.total != null) return bs.total;
  return (bs.strength || 0) + (bs.defense || 0) + (bs.speed || 0) + (bs.dexterity || 0);
}

function parseIdList(rest) {
  const tokens = String(rest || '').split(/[\s,;]+/).filter(Boolean);
  const ids = [];
  for (const t of tokens) {
    const n = t.replace(/[^\d]/g, '');
    if (n && /^\d{1,9}$/.test(n)) ids.push(n);
  }
  return ids;
}

function getTargetList(discordUserId) {
  const prefs = accountStore.getPreferences(discordUserId);
  const raw = prefs.targetWhitelist || {};
  if (Array.isArray(raw)) return { include: raw, skip: [] };
  return {
    include: Array.isArray(raw.include) ? raw.include : [],
    skip: Array.isArray(raw.skip) ? raw.skip : [],
  };
}

function saveTargetList(discordUserId, list) {
  accountStore.updatePreferences(discordUserId, { targetWhitelist: list });
}

async function resolveApiKey(discordUserId) {
  const account = accountStore.getAccount(discordUserId);
  const key = account ? accountStore.getApiKey(discordUserId) : null;
  return { account, apiKey: key || OWNER_KEY };
}

// No fallback key: the member's own linked key must be registered on FFScouter.
async function tryFindFfTargets(primaryKey, params) {
  const targets = await findTargets({ key: primaryKey, ...params });
  return { targets, key: primaryKey };
}

async function fetchSelf(userId, apiKey) {
  const d = await tornGet('user', '', 'profile,battlestats,bars', 1, apiKey, { cacheTtl: 60, retries: 1 });
  return {
    id: String(d.player_id),
    name: d.name || 'You',
    level: d.level || 0,
    total: totalStats(d),
    status: d.status || {},
    life: (d.life && d.life.current) || 0,
  };
}

async function inspectCandidate(id, apiKey) {
  try {
    const d = await tornGet('user', id, 'profile', 1, apiKey, { cacheTtl: 120, retries: 1 });
    if (!d || !d.player_id) return null;
    return {
      id: String(d.player_id),
      name: d.name || String(id),
      level: d.level || 0,
      total: d.total != null ? d.total : null,
      status: d.status || {},
      life: (d.life && d.life.current) || 0,
      faction: (d.faction && d.faction.faction_id) || null,
      attackable: ATTACKABLE.has((d.status && d.status.state) ? d.status.state : ''),
    };
  } catch (e) {
    return null;
  }
}

const ffEnrichCache = new Map();
async function enrichWithFf(ids, apiKey) {
  const missing = Array.from(new Set(ids.map(String))).filter((id) => !ffEnrichCache.has(id));
  if (missing.length && apiKey) {
    try {
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const rows = await getStats({ key: apiKey, targets: chunk });
        if (Array.isArray(rows)) {
          for (const r of rows) {
            if (r && r.player_id) ffEnrichCache.set(String(r.player_id), r);
          }
        }
      }
    } catch (e) {
      console.log('[target] ff enrichment unavailable:', e.message);
    }
  }
  const out = {};
  for (const id of new Set(ids.map(String))) out[id] = ffEnrichCache.get(id) || null;
  return out;
}

async function ffParamsFor(self, limit, inactive) {
  return {
    minLevel: Math.max(1, self.level - 3),
    maxLevel: Math.min(100, self.level + 25),
    minFf: 1.25,
    maxFf: 2.95,
    inactiveOnly: inactive ? 1 : 0,
    limit,
  };
}

async function buildCandidates(userId, apiKey, self, extraIds) {
  const seen = new Set();
  const sources = [];

  const addFrom = (ids, label, opts) => {
    for (const id of ids) {
      let itemId = id;
      if (id && typeof id === 'object') itemId = id.id;
      const strId = String(itemId);
      if (!seen.has(strId) && strId !== String(self.id)) {
        seen.add(strId);
        sources.push({ id: strId, label, ffScouter: !!(opts && opts.ffScouter) });
      }
    }
  };

  const pool = getTargetList(userId);
  pool.include.forEach((id) => addFrom([id], 'whitelist'));
  if (extraIds && extraIds.length) addFrom(extraIds, 'you supplied');

  let ffCount = 0;
  let ffRegistered = true;
  try {
    const { targets: ff } = await tryFindFfTargets(apiKey, await ffParamsFor(self, FFSCOUTER_CAP, false));
    const clean = ff.filter((t) => !t.hospital_until || t.hospital_until < Date.now() / 1000);
    addFrom(clean, 'ffscouter', { ffScouter: true });
    ffCount = clean.length;
  } catch (e) {
    if (e.code === 6) ffRegistered = false;
    else console.log('[target] ffscouter unavailable:', e.message);
  }

  return { candidates: sources, ffCount, ffRegistered };
}

function rankCandidates(inspected, self, skipIds) {
  const skipSet = new Set(skipIds || []);
  const good = [];
  const skipped = { hospital: [], higher: [], band: [], faction: [], skippedList: [], dead: [], unknown: [] };

  for (const c of inspected) {
    const state = c.status.state || '';

    if (skipSet.has(c.id)) { skipped.skippedList.push(c); continue; }
    if (c.faction && String(c.faction) === String(FACTION_ID)) { skipped.faction.push(c); continue; }
    if (!ATTACKABLE.has(state)) {
      const bucket = state === 'Hospital' ? 'hospital' : 'dead';
      skipped[bucket] && skipped[bucket].push(c);
      continue;
    }
    const gap = c.ffScouter ? FF_MAX_LEVEL_GAP : LEVEL_BAND;
    if (Math.abs(c.level - self.level) > gap) { skipped.band.push(c); continue; }

    const ff = c.ff != null ? Number(c.ff) : null;
    const ffEasy = ff != null && ff < BORDERLINE_FF;
    const totalEasy = self.total != null && c.total != null && c.total < self.total;
    const knownStronger = ff != null && ff >= BORDERLINE_FF;

    if (!ffEasy && !totalEasy) {
      if (knownStronger || c.total != null) { skipped.higher.push(c); continue; }
      skipped.unknown.push(c);
      continue;
    }

    c.score = ff != null ? 1 / (ff + 0.05) : (self.total / Math.max(1, c.total) + (self.level - c.level) * 0.1);
    good.push(c);
  }

  good.sort((a, b) => b.score - a.score);
  return { good, skipped };
}

function findClosest(inspected, self, skipIds, limit) {
  const skipSet = new Set(skipIds || []);
  const pool = inspected.filter(
    (c) => !skipSet.has(c.id)
      && !(c.faction && String(c.faction) === String(FACTION_ID))
      && ATTACKABLE.has(c.status.state)
  );
  pool.sort((a, b) => Math.abs(a.level - self.level) - Math.abs(b.level - self.level));
  return pool.slice(0, limit).map((c) => {
    const stronger = c.total != null && self.total != null && c.total >= self.total;
    c.closestNote = stronger ? `stronger than you (${fmt(c.total)} total)` : 'maybe easy';
    return c;
  });
}

async function handleTarget(message, args) {
  const userId = message.author.id;
  const count = Math.min(parseInt(args[0], 10) || MAX_SHOW, 10);
  const reply = await message.reply('Scouting FFScouter\u2026');
  const { apiKey } = await resolveApiKey(userId);
  const self = await fetchSelf(userId, apiKey);
  let ff = [];
  try {
    const first = await tryFindFfTargets(apiKey, await ffParamsFor(self, 50, false));
    ff = first.targets;
    if (ff.length < 6) {
      const second = await tryFindFfTargets(apiKey, await ffParamsFor(self, 50, true));
      const seenIds = new Set(ff.map((t) => String(t.player_id)));
      for (const t of second.targets) {
        if (!seenIds.has(String(t.player_id))) { ff.push(t); seenIds.add(String(t.player_id)); }
      }
    }
  } catch (e) {
    const lines = ['🔧 **FFScouter** — lookup failed'];
    lines.push(e.code === 6
      ? 'Your Torn key isn\u2019t registered on FFScouter. Run `!torn setup` with your key, then register that same key at https://ffscouter.com. There is no fallback key.'
      : `Error: ${e.message}`);
    await reply.edit(lines.join('\n'));
    return;
  }
  const rows = [];
  const seen = new Set();
  let checked = 0;
  const MAX_FF_INSPECT = 30;
  for (const t of ff) {
    if (checked >= MAX_FF_INSPECT) break;
    if (t.hospital_until && t.hospital_until > Date.now() / 1000) continue;
    if (seen.has(t.player_id)) continue;
    seen.add(t.player_id);
    const c = await inspectCandidate(t.player_id, apiKey);
    checked++;
    if (!c) continue;
    if (c.faction && String(c.faction) === String(FACTION_ID)) continue;
    if (!ATTACKABLE.has(c.status.state)) continue;
    rows.push({ t, c });
    if (rows.length >= count) break;
  }
  rows.sort((a, b) => (a.t.fair_fight ?? 99) - (b.t.fair_fight ?? 99));
  const lines = [`🔧 **FFScouter targets for ${self.name}** (Lv${self.level}, ${fmt(self.total)} total)`];
  lines.push('FF ~1.0–2.95 around your level (±25, active + inactive) — live-checked against Torn, weakest FF first:');
  rows.slice(0, count).forEach(({ t, c }, i) => {
    const details = [
      `Lv${c.level}`,
      c.total != null ? `${fmt(c.total)} total` : (t.bs_estimate_human ? `est ${t.bs_estimate_human}` : 'est —'),
      `${c.status.state}`,
      `${c.life ? fmt(c.life) + ' life' : ''}`.trim(),
      `FF ${t.fair_fight}`,
    ].filter(Boolean).join(' · ');
    lines.push(
      `${i + 1}. **${c.name}** [${c.id}] · ${details}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
    );
  });
  if (!rows.length) {
    lines.push(`No live attackable targets in ${checked} FFScouter candidates — nobody “Okay” right now. Try again shortly.`);
  }
  if (ff.length > checked) lines.push(`(${ff.length - checked} more candidates not checked — run \`!target ${count + 5}\` next time)`);
  await reply.edit(lines.join('\n'));
}

module.exports = { handleTarget, tryFindFfTargets };