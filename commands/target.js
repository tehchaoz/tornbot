const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');
const { findTargets, getStats } = require('../services/ffscouter');

const FACTION_ID = process.env.FACTION_ID || '';
const OWNER_KEY = process.env.TORN_API_KEY || '';

const LEVEL_BAND = 3;
const BALDR_MAX_LEVEL_GAP = 10;
const MAX_SHOW = 5;
const CANDIDATE_CAP = 20;
const BALDR_URL = 'https://raw.githubusercontent.com/OranWeb/tc-baldrs-levelling-list/master/data.json';
const BALDR_CACHE_TTL = 6 * 60 * 60 * 1000;
const BALDR_CAP = 12;
const FFSCOUTER_CAP = 8;

const ATTACKABLE = new Set(['OK', 'Idle', 'Okay']);

let baldrCache = null;
let baldrCacheAt = 0;

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

async function tryFindFfTargets(primaryKey, params) {
  try {
    const targets = await findTargets({ key: primaryKey, ...params });
    return { targets, key: primaryKey };
  } catch (e) {
    if (e.code !== 6) throw e;
  }
  const fallbackKey = process.env.FFSCOUTER_API_KEY || OWNER_KEY;
  if (!fallbackKey || fallbackKey === primaryKey) {
    throw Object.assign(new Error('FFScouter has no registered key on file'), { code: 6 });
  }
  const targets = await findTargets({ key: fallbackKey, ...params });
  return { targets, key: fallbackKey };
}

const FULL_KEY_IDENTIFIERS = ['drfruit', 'dr fruit', 'd.r.fruit'];
let cachedFactionKey = null;

function resolveFactionKey() {
  if (cachedFactionKey) return cachedFactionKey;
  try {
    const accounts = accountStore.getAllAccounts();
    const match = accounts.find((a) => {
      const n = (a.torn_username || '').toLowerCase().replace(/\s+/g, ' ');
      return FULL_KEY_IDENTIFIERS.some((id) => n === id || n.startsWith(id));
    });
    if (match) {
      const key = accountStore.getApiKey(match.discord_user_id);
      if (key) { cachedFactionKey = key; return key; }
    }
  } catch (e) {}
  return OWNER_KEY;
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

async function fetchFactionAttackIds() {
  if (!FACTION_ID) return [];
  const d = await tornGet('faction', FACTION_ID, 'attacks', 1, resolveFactionKey(), { cacheTtl: 120, retries: 1 });
  const list = d && d.attacks ? d.attacks : [];
  const ids = new Set();
  if (Array.isArray(list)) {
    for (const a of list) {
      if (a.defender_id) ids.add(String(a.defender_id));
      if (a.attacker_id) ids.add(String(a.attacker_id));
    }
  }
  return Array.from(ids);
}

// Scrub the faction's recent attack history (v2 supports time windows) for opponents
// near any given level band. The biggest pool of real players the API lets us enumerate.
// v2 needs from/to/limit as separate query params (not inside selections), so this uses
// a direct fetch rather than tornGet.
const SCRUB_DAYS = 45;
const SCRUB_PAGES = 10;

async function fetchWideFactionAttackIds() {
  if (!FACTION_ID) return { ids: [], seenAttacks: 0 };
  const key = resolveFactionKey();
  const ids = new Set();
  const now = Date.now() / 1000;
  let to = Math.floor(now);
  let from = Math.floor(now - SCRUB_DAYS * 86400);
  let seen = 0;
  for (let page = 0; page < SCRUB_PAGES; page++) {
    let d = null;
    try {
      const url = `https://api.torn.com/v2/faction/${FACTION_ID}/?selections=attacks&from=${from}&to=${to}&limit=100&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { timeout: 10000 });
      d = await res.json().catch(() => null);
    } catch (e) { break; }
    if (!d || d.error || !d.attacks) break;
    const list = Array.isArray(d.attacks) ? d.attacks : [];
    if (!list.length) break;
    seen += list.length;
    for (const a of list) {
      if (a.attacker && a.attacker.id) ids.add(String(a.attacker.id));
      if (a.defender && a.defender.id) ids.add(String(a.defender.id));
    }
    const oldest = Math.min(...list.map((a) => a.started || a.ended || from));
    if (!isFinite(oldest) || oldest <= from) break;
    to = Math.floor(oldest) - 1; // walk back further into history
    from = Math.floor(oldest) - Math.floor(SCRUB_DAYS * 86400 / SCRUB_PAGES);
  }
  return { ids: Array.from(ids), seenAttacks: seen };
}

async function fetchOwnAttackIds(apiKey) {
  try {
    const d = await tornGet('user', '', 'attacks', 1, apiKey, { cacheTtl: 120, retries: 1 });
    const list = d && d.attacks ? d.attacks : [];
    const ids = new Set();
    if (Array.isArray(list)) {
      for (const a of list) {
        if (a.defender_id) ids.add(String(a.defender_id));
        if (a.attacker_id) ids.add(String(a.attacker_id));
      }
    }
    return Array.from(ids);
  } catch (e) {
    return [];
  }
}

async function fetchFactionMemberIds() {
  if (!FACTION_ID) return new Set();
  try {
    const d = await tornGet('faction', FACTION_ID, 'basic', 1, resolveFactionKey(), { cacheTtl: 3600, retries: 1 });
    const members = d && d.members ? d.members : {};
    return new Set(Object.keys(members).map(String));
  } catch (e) {
    return new Set();
  }
}

async function fetchBaldrList() {
  if (baldrCache && Date.now() - baldrCacheAt < BALDR_CACHE_TTL) return baldrCache;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  let res;
  try {
    res = await fetch(BALDR_URL, { signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Baldr list HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json) throw new Error('Baldr list parse failed');
  const targets = {};
  for (const [listName, entries] of Object.entries(json)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const id = String(e.id || '');
      if (!/^\d+$/.test(id)) continue;
      targets[id] = {
        id,
        name: e.name || String(id),
        level: parseInt(e.lvl, 10) || 0,
        total: Number(String(e.total || 0).replace(/[,\s]/g, '')) || 0,
        list: listName,
      };
    }
  }
  baldrCache = targets;
  baldrCacheAt = Date.now();
  console.log(`[target] baldr list loaded: ${Object.keys(targets).length} targets`);
  return targets;
}

function pickBaldrCandidates(baldr, self, limit) {
  const rows = Object.values(baldr).filter((t) => t.total != null && t.total > 0);
  rows.sort((a, b) => a.total - b.total);
  return rows.slice(0, limit);
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
async function enrichWithFf(ids) {
  const missing = Array.from(new Set(ids.map(String))).filter((id) => !ffEnrichCache.has(id));
  const key = process.env.FFSCOUTER_API_KEY || OWNER_KEY;
  if (missing.length && key) {
    try {
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const rows = await getStats({ key, targets: chunk });
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

async function buildCandidates(userId, apiKey, self, extraIds) {
  const seen = new Set();
  const sources = [];

  const addFrom = (ids, label, opts) => {
    for (const id of ids) {
      let itemId = id;
      if (id && typeof id === 'object') itemId = id.id;
      const strId = String(itemId);
      if (!seen.has(strId) && strId !== String(userId)) {
        seen.add(strId);
        sources.push({ id: strId, label, baldr: !!(opts && opts.baldr), ffScouter: !!(opts && opts.ffScouter) });
      }
    }
  };

  const pool = getTargetList(userId);
  pool.include.forEach((id) => addFrom([id], 'whitelist'));
  if (extraIds && extraIds.length) addFrom(extraIds, 'you supplied');

  let factionIds = [];
  try { factionIds = await fetchFactionAttackIds(); } catch (e) {}
  addFrom(factionIds, 'faction attacks');

  let ownIds = [];
  try { ownIds = await fetchOwnAttackIds(apiKey); } catch (e) {}
  addFrom(ownIds, 'your attacks');

  let baldrCount = 0;
  if (self) {
    try {
      const baldr = await fetchBaldrList();
      const picked = pickBaldrCandidates(baldr, self, BALDR_CAP);
      addFrom(picked, 'baldr', { baldr: true });
      baldrCount = picked.length;
    } catch (e) {
      console.log('[target] baldr list unavailable:', e.message);
    }
  }

  let ffCount = 0;
  try {
    const { targets: ff } = await tryFindFfTargets(apiKey, {
      minLevel: Math.max(1, self.level - 3),
      maxLevel: Math.min(100, self.level + 25),
      minFf: 1.25,
      maxFf: 2.95,
      inactiveOnly: 0,
      limit: FFSCOUTER_CAP,
    });
    const clean = ff.filter((t) => !t.hospital_until || t.hospital_until < Date.now() / 1000);
    addFrom(clean, 'ffscouter', { ffScouter: true });
    ffCount = clean.length;
  } catch (e) {
    if (!e.silent) console.log('[target] ffscouter unavailable:', e.message);
  }

  return { candidates: sources, factionCount: factionIds.length, ownCount: ownIds.length, baldrCount, ffCount };
}

const BORDERLINE_FF = 1.5;

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
    if (!c.baldr && !c.ffScouter && Math.abs(c.level - self.level) > LEVEL_BAND) { skipped.band.push(c); continue; }
    if ((c.baldr || c.ffScouter) && Math.abs(c.level - self.level) > BALDR_MAX_LEVEL_GAP) { skipped.band.push(c); continue; }

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
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'add' || cmd === 'rm' || cmd === 'remove' || cmd === 'list' || cmd === 'skip' || cmd === 'scan' || cmd === 'closest' || cmd === 'ff' || cmd === 'scrub' || cmd === 'help') {
    const rest = args.slice(1).join(' ');
    const ids = parseIdList(rest);
    const list = getTargetList(userId);

    if (cmd === 'add' || cmd === 'skip') {
      if (!ids.length) {
        await message.reply(`Usage: \`!target ${cmd} <torn-id> [more ids...]\``);
        return;
      }
      let count = 0;
      for (const id of ids) {
        if (cmd === 'skip' && !list.skip.includes(id)) { list.skip.push(id); count++; }
        else if (cmd === 'add' && !list.include.includes(id) && !list.skip.includes(id)) { list.include.push(id); count++; }
      }
      saveTargetList(userId, list);
      await message.reply(`Saved ${count} id${count === 1 ? '' : 's'}. Run \`!target\` to scan.`);
      return;
    }

    if (cmd === 'rm' || cmd === 'remove') {
      if (!ids.length) {
        await message.reply('Usage: `!target rm <torn-id>`');
        return;
      }
      let count = 0;
      for (const id of ids) {
        const before = list.include.length + list.skip.length;
        list.include = list.include.filter((x) => x !== id);
        list.skip = list.skip.filter((x) => x !== id);
        if (before !== list.include.length + list.skip.length) count++;
      }
      saveTargetList(userId, list);
      await message.reply(`Removed ${count} id${count === 1 ? '' : 's'}.`);
      return;
    }

    if (cmd === 'list') {
      const lines = [];
      lines.push(`**Your target lists** (${userId})`);
      lines.push(`In pool: ${list.include.length ? list.include.join(', ') : '— none —'}`);
      lines.push(`Never suggest: ${list.skip.length ? list.skip.join(', ') : '— none —'}`);
      await message.reply(lines.join('\n'));
      return;
    }

    if (cmd === 'scan') {
      if (!ids.length) {
        await message.reply('Usage: `!target scan <torn-id> [more ids...]`');
        return;
      }
      const reply = await message.reply('Scanning\u2026');
      const { account, apiKey } = await resolveApiKey(userId);
      const self = await fetchSelf(userId, apiKey);
      const inspected = [];
      for (const id of ids.slice(0, 12)) {
        const c = await inspectCandidate(id, apiKey);
        if (c) inspected.push(c);
      }
      const ffMap = await enrichWithFf(inspected.map((c) => c.id));
      for (const c of inspected) { const r = ffMap[c.id]; c.ff = r ? r.fair_fight : null; c.ffEst = r ? r.bs_estimate_human : null; }
const { good, skipped } = rankCandidates(inspected, self, getTargetList(userId).skip);
      const lines = [`**Target scan** — you: Lv${self.level}, ${fmt(self.total)} total`];
      if (good.length) {
        good.slice(0, MAX_SHOW).forEach((c, i) => {
          lines.push(`${i + 1}. **${c.name}** [${c.id}] \u00B7 Lv${c.level} \u00B7 ${fmt(c.total)} \u00B7 ${c.status.state}`);
          lines.push(`   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`);
        });
      } else {
        const closest = findClosest(inspected, self, getTargetList(userId).skip, MAX_SHOW);
        if (closest.length) {
          lines.push(`No confirmed easy targets in this batch \u2014 closest by level:`);
          closest.forEach((c, i) => {
            lines.push(`${i + 1}. **${c.name}** [${c.id}] \u00B7 Lv${c.level} \u00B7 ${fmt(c.total)} \u00B7 ${c.status.state} \u00B7 ${c.closestNote}`);
            lines.push(`   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`);
          });
        } else {
          lines.push('No easy targets found in this batch.');
        }
      }
      lines.push('Tip: `!target add <id>` puts players in your pool; `!target skip <id>` hides them.');
      await reply.edit(lines.join('\n'));
      return;
    }

    if (cmd === 'help') {
      await message.reply(
        '**!target** — find easy kills near your level.\n' +
        '`!target` — scan faction/your recent attack logs + whitelist + Baldr\'s list + FFScouter.\n' +
        '`!target ff [n]` — pull beatable targets from FFScouter (FF 1.25-3, live-checked like the browser finder).\n' +
        '`!target closest` — show nearest-by-level candidates even if they are stronger.\n' +
        '`!target add <id...>` — add players to your pool.\n' +
        '`!target skip <id...>` — never suggest these.\n' +
        '`!target rm <id...>` — remove from both lists.\n' +
        '`!target list` — show your lists.\n' +
        '`!target scan <id...>` — evaluate specific players.\n' +
        '`!target scrub [level-gap]` — scrub faction attack history for near-level players.\n' +
        'Suggests alive, non-hospital players with lower battle stats. Faction/attack sources are kept to your level (\u00B13); Baldr list is used for level-beating XP (higher level, lower stats).'
      );
      return;
    }
  }

  if (cmd === 'ff') {
    const count = Math.min(parseInt(args[1], 10) || MAX_SHOW, 10);
    const reply = await message.reply('Scouting FFScouter\u2026');
    const { account, apiKey } = await resolveApiKey(userId);
    const self = await fetchSelf(userId, apiKey);
    let ff = [];
    let usedKey = apiKey;
    const ffParams = (limit, inactive) => ({
      minLevel: Math.max(1, self.level - 3),
      maxLevel: Math.min(100, self.level + 25),
      minFf: 1.25,
      maxFf: 2.95,
      inactiveOnly: inactive ? 1 : 0,
      limit,
    });
    try {
      const first = await tryFindFfTargets(apiKey, ffParams(50, false));
      ff = first.targets;
      usedKey = first.key;
      if (ff.length < 6) {
        const second = await tryFindFfTargets(apiKey, ffParams(50, true));
        const seenIds = new Set(ff.map((t) => String(t.player_id)));
        for (const t of second.targets) {
          if (!seenIds.has(String(t.player_id))) { ff.push(t); seenIds.add(String(t.player_id)); }
        }
      }
    } catch (e) {
      const lines = ['\u{1F527} **FFScouter** \u2014 lookup failed'];
      lines.push(e.code === 6
        ? 'No registered FFScouter key available. Register one at https://ffscouter.com \u2192 API Keys, or set `FFSCOUTER_API_KEY` in .env.'
        : `Error: ${e.message}`);
      lines.push('Meanwhile `!target`, `!target scan` and `!target scrub` still work.');
      await reply.edit(lines.join('\n'));
      return;
    }
    const skip = new Set(getTargetList(userId).skip);
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
      if (skip.has(c.id)) continue;
      if (c.faction && String(c.faction) === String(FACTION_ID)) continue;
      if (!ATTACKABLE.has(c.status.state)) continue;
      rows.push({ t, c });
      if (rows.length >= count) break;
    }
    rows.sort((a, b) => (a.t.fair_fight ?? 99) - (b.t.fair_fight ?? 99));
    const lines = [`\u{1F527} **FFScouter targets for ${self.name}** (Lv${self.level}, ${fmt(self.total)} total)`];
    lines.push('FF ~1.0\u20132.95 around your level (\u00B125, active + inactive) \u2014 live-checked against Torn like the extension\u2019s finder, weakest FF first:');
    if (usedKey !== apiKey) lines.push('(fallback key used \u2014 fair fight relative to its owner)');
    rows.slice(0, count).forEach(({ t, c }, i) => {
      const details = [
        `Lv${c.level}`,
        c.total != null ? `${fmt(c.total)} total` : (t.bs_estimate_human ? `est ${t.bs_estimate_human}` : 'est \u2014'),
        `${c.status.state}`,
        `${c.life ? fmt(c.life) + ' life' : ''}`.trim(),
        `FF ${t.fair_fight}`,
      ].filter(Boolean).join(' \u00B7 ');
      lines.push(
        `${i + 1}. **${c.name}** [${c.id}] \u00B7 ${details}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
      );
    });
    if (!rows.length) {
      lines.push(`No live attackable targets in ${checked} FFScouter candidates \u2014 nobody \u201cOkay\u201d right now. Try again shortly or \`!target scan <id>\`.`);
    }
    if (ff.length > checked) lines.push(`(${ff.length - checked} more candidates not checked \u2014 run \`!target ff ${count + 5}\` next time)`);
    lines.push('`!target add <id>` keeps keepers; `!target` folds FFScouter in with your other sources.');
    await reply.edit(lines.join('\n'));
    return;
  }

  if (cmd === 'closest') {
    const count = Math.min(parseInt(args[1], 10) || MAX_SHOW, 10);
    const reply = await message.reply('Hunting\u2026');
    const { account, apiKey } = await resolveApiKey(userId);
    const self = await fetchSelf(userId, apiKey);
    const { candidates } = await buildCandidates(userId, apiKey, self, []);
    const baldrSet = new Set(candidates.filter((c) => c.baldr).map((c) => c.id));
    const ffSet = new Set(candidates.filter((c) => c.ffScouter).map((c) => c.id));
    const unique = Array.from(new Set(candidates.map((c) => c.id)));
    const toInspect = unique.slice(0, CANDIDATE_CAP);
    const inspected = [];
    for (const id of toInspect) {
      const c = await inspectCandidate(id, apiKey);
      if (c) { c.baldr = baldrSet.has(c.id); c.ffScouter = ffSet.has(c.id); inspected.push(c); }
    }
    const ffMap = await enrichWithFf(inspected.map((c) => c.id));
    for (const c of inspected) { const r = ffMap[c.id]; c.ff = r ? r.fair_fight : null; c.ffEst = r ? r.bs_estimate_human : null; }
    const closest = findClosest(inspected, self, getTargetList(userId).skip, count);
    const lines = [`\u{1F3AF} **Closest targets for ${self.name}** (Lv${self.level}, ${fmt(self.total)} total)`];
    if (closest.length) {
      lines.push('Nearest by level in your pool (NOT confirmed easy):');
      closest.forEach((c, i) => {
        lines.push(
          `${i + 1}. **${c.name}** [${c.id}] \u00B7 Lv${c.level} \u00B7 ${fmt(c.total)} total \u00B7 ${c.status.state} \u00B7 ${c.closestNote}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
        );
      });
    } else {
      lines.push('No alive, non-faction candidates in your pool to show.');
    }
    lines.push('`!target add <id>` adds players so they appear here / `!target scan <id>` checks them live.');
    await reply.edit(lines.join('\n'));
    return;
  }

  if (cmd === 'scrub') {
    const gap = Math.max(1, Math.min(parseInt(args[1], 10) || 10, 30));
    const reply = await message.reply('Scrubbing faction attack history for near-level opponents\u2026');
    const { account, apiKey } = await resolveApiKey(userId);
    const self = await fetchSelf(userId, apiKey);
    let wide;
    try {
      wide = await fetchWideFactionAttackIds();
    } catch (e) {
      wide = { ids: [], seenAttacks: 0 };
    }
    const unique = Array.from(new Set(wide.ids)).filter((id) => id !== String(self.id));
    const lines = [`\u{1F50D} **Scrub for targets around Lv${self.level}** (${self.name}, ${fmt(self.total)} total)`];
    lines.push(`Scrubbed ${wide.seenAttacks} faction attacks \u2192 ${unique.length} unique players (window: ${SCRUB_DAYS}d)`);
    if (!unique.length) {
      lines.push('No faction attack history to scrub (or it is empty).');
      lines.push('Tip: `!target add <id>` to pool targets you find manually.');
      await reply.edit(lines.join('\n'));
      return;
    }
    const inRange = [];
    const capped = unique.slice(0, CANDIDATE_CAP);
    const others = unique.length - capped.length;
    const inspected = [];
    for (const id of capped) {
      try { const c = await inspectCandidate(id, apiKey); if (c) inspected.push(c); } catch (e) {}
    }
    const ffMap = await enrichWithFf(inspected.map((c) => c.id));
    for (const c of inspected) { const r = ffMap[c.id]; c.ff = r ? r.fair_fight : null; c.ffEst = r ? r.bs_estimate_human : null; }
    for (const c of inspected) {
      const dist = Math.abs(c.level - self.level);
      const distOk = c.level <= self.level + gap;
      if (!distOk) continue;
      if (c.faction && String(c.faction) === String(FACTION_ID)) continue;
      if (!ATTACKABLE.has(c.status.state)) continue;
      const stronger = c.total != null && self.total != null && c.total >= self.total;
      inRange.push({ c, dist, stronger });
    }
    inRange.sort((a, b) => a.dist - b.dist);
    if (!inRange.length) {
      lines.push(`No alive non-faction opponents within +${gap} levels of you in the faction history.`);
      lines.push('The faction rarely fights players near your level. Use `!target add <id>` for manual targets.');
    } else {
      lines.push(`**${inRange.length}** alive opponent(s) within +${gap} levels of you, nearest first:`);
      inRange.slice(0, MAX_SHOW).forEach(({ c, dist, stronger }, i) => {
        lines.push(
          `${i + 1}. **${c.name}** [${c.id}] \u00B7 Lv${c.level} (${dist} off) \u00B7 ${fmt(c.total)} total \u00B7 ${c.status.state} \u00B7 ${stronger ? '**stronger** than you' : 'maybe winnable'}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
        );
      });
      if (others) lines.push(`+${others} more players in history not scanned (run again to re-scan).`);
    }
    lines.push('`!target scrub [gap]` sets the level window; `!target scan <id>` live-checks any one.');
    await reply.edit(lines.join('\n'));
    return;
  }

  const count = Math.min(parseInt(args[0], 10) || MAX_SHOW, 10);

  const reply = await message.reply('Hunting\u2026');
  const { account, apiKey } = await resolveApiKey(userId);
  const self = await fetchSelf(userId, apiKey);

  const { candidates, factionCount, ownCount, baldrCount, ffCount } = await buildCandidates(userId, apiKey, self, []);
  const baldrSet = new Set(candidates.filter((c) => c.baldr).map((c) => c.id));
  const ffSet = new Set(candidates.filter((c) => c.ffScouter).map((c) => c.id));
  const unique = Array.from(new Set(candidates.map((c) => c.id)));
  const toInspect = unique.slice(0, CANDIDATE_CAP);
  const others = Math.max(0, unique.length - toInspect.length);

  const inspected = [];
  for (const id of toInspect) {
    const c = await inspectCandidate(id, apiKey);
    if (c) { c.baldr = baldrSet.has(c.id); c.ffScouter = ffSet.has(c.id); inspected.push(c); }
  }
  const ffMap = await enrichWithFf(inspected.map((c) => c.id));
  for (const c of inspected) { const r = ffMap[c.id]; c.ff = r ? r.fair_fight : null; c.ffEst = r ? r.bs_estimate_human : null; }

  const { good, skipped } = rankCandidates(inspected, self, getTargetList(userId).skip);

  const lines = [];
  lines.push(`\u{1F3AF} **Easy targets for ${self.name}** (Lv${self.level}, ${fmt(self.total)} total)`);
  lines.push(`Pool: ${unique.length} unique (faction ${factionCount}, your attacks ${ownCount}, whitelist ${getTargetList(userId).include.length}, baldr ${baldrCount}, ffscouter ${ffCount})${others ? `, ${others} more not scanned` : ''}`);
  if (good.length) {
    lines.push(`Found **${good.length}** attackable with lower stats:`);
    good.slice(0, count).forEach((c, i) => {
      lines.push(
        `${i + 1}. **${c.name}** [${c.id}] \u00B7 Lv${c.level} \u00B7 ${fmt(c.total)} total${c.life ? ' \u00B7 ' + fmt(c.life) + ' life' : ''}${c.ff != null ? ' \u00B7 FF ' + c.ff : ''}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
      );
    });
  } else {
    const closest = findClosest(inspected, self, getTargetList(userId).skip, count);
    if (closest.length) {
      lines.push(`No confirmed easy targets — here are the **closest by level** in your pool (${closest.length <= count ? '' : '\u2014 all still checkable with \`!target scan\`'}):`);
      closest.forEach((c, i) => {
        lines.push(
          `${i + 1}. **${c.name}** [${c.id}] \u00B7 Lv${c.level} \u00B7 ${fmt(c.total)} total \u00B7 ${c.status.state} \u00B7 ${c.closestNote}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
        );
      });
      lines.push('These are *not* confirmed easy \u2014 you gain XP by attacking while **Leave**ing. Re-run `!target` as you level.');
      if (skipped.hospital.length || skipped.higher.length || skipped.band.length) {
lines.push(`Skipped: ${skipped.hospital.length} in hospital, ${skipped.higher.length} with higher stats, ${skipped.band.length} out of level band, ${skipped.faction.length} faction mates, ${skipped.skippedList.length} on your skip list, ${skipped.unknown.length} with stats unknown.`);
      }
      await reply.edit(lines.join('\n'));
      return;
    }
    lines.push('No easy targets found \u2014 everyone in your pool is stronger, hospitalized, or out of your level band.');
  }
  if (skipped.hospital.length) lines.push(`Skipped: ${skipped.hospital.length} in hospital, ${skipped.higher.length} with higher stats, ${skipped.band.length} out of level band, ${skipped.faction.length} faction mates, ${skipped.skippedList.length} on your skip list, ${skipped.unknown.length} with stats unknown.`);
  lines.push('`!target add <id>` / `!target skip <id>` / `!target help`');
  await reply.edit(lines.join('\n'));
}

module.exports = { handleTarget, tryFindFfTargets };