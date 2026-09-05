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

const HELP_TEXT =
  '**!target** — find easy kills near your level. Targets come from **FFScouter** using your own registered key (no fallback).\n' +
  '`!target ff [n]` — pull live-checked beatable targets from FFScouter (weakest FF first).\n' +
  '`!target` — scan your FFScouter pool + personal whitelist.\n' +
  '`!target closest` — show nearest-by-level candidates even if they are stronger.\n' +
  '`!target add <id...>` — add players to your pool.\n' +
  '`!target skip <id...>` — never suggest these.\n' +
  '`!target rm <id...>` — remove from both lists.\n' +
  '`!target list` — show your lists.\n' +
  '`!target scan <id...>` — evaluate specific players.\n' +
  'Requires `!torn setup` and registering that key at https://ffscouter.com (see the Setup section of the README).';

async function handleTarget(message, args) {
  const userId = message.author.id;
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'add' || cmd === 'rm' || cmd === 'remove' || cmd === 'list' || cmd === 'skip' || cmd === 'scan' || cmd === 'closest' || cmd === 'ff' || cmd === 'help') {
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
      const ffMap = await enrichWithFf(inspected.map((c) => c.id), apiKey);
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
      await message.reply(HELP_TEXT);
      return;
    }
  }

  if (cmd === 'ff') {
    const count = Math.min(parseInt(args[1], 10) || MAX_SHOW, 10);
    const reply = await message.reply('Scouting FFScouter\u2026');
    const { account, apiKey } = await resolveApiKey(userId);
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
        ? 'Your Torn key isn\u2019t registered on FFScouter. Run `!torn setup` with your key, then register that same key at https://ffscouter.com (Setup: ffscouter section in the README). There is no fallback key.'
        : `Error: ${e.message}`);
      lines.push('Meanwhile `!target scan <id>` and `!target add <id>` still work.');
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
    if (ff.length > checked) lines.push(`(${ff.length - checked} more candidates not checked — run \`!target ff ${count + 5}\` next time)`);
    lines.push('`!target add <id>` keeps keepers; `!target help` for the rest.');
    await reply.edit(lines.join('\n'));
    return;
  }

  if (cmd === 'closest') {
    const count = Math.min(parseInt(args[1], 10) || MAX_SHOW, 10);
    const reply = await message.reply('Hunting\u2026');
    const { account, apiKey } = await resolveApiKey(userId);
    const self = await fetchSelf(userId, apiKey);
    const { candidates } = await buildCandidates(userId, apiKey, self, []);
    const unique = Array.from(new Set(candidates.map((c) => c.id)));
    const toInspect = unique.slice(0, CANDIDATE_CAP);
    const inspected = [];
    for (const id of toInspect) {
      const c = await inspectCandidate(id, apiKey);
      if (c) inspected.push(c);
    }
    const ffMap = await enrichWithFf(inspected.map((c) => c.id), apiKey);
    for (const c of inspected) { const r = ffMap[c.id]; c.ff = r ? r.fair_fight : null; c.ffEst = r ? r.bs_estimate_human : null; }
    const closest = findClosest(inspected, self, getTargetList(userId).skip, count);
    const lines = [`🎯 **Closest targets for ${self.name}** (Lv${self.level}, ${fmt(self.total)} total)`];
    if (closest.length) {
      lines.push('Nearest by level in your pool (NOT confirmed easy):');
      closest.forEach((c, i) => {
        lines.push(
          `${i + 1}. **${c.name}** [${c.id}] · Lv${c.level} · ${fmt(c.total)} total · ${c.status.state} · ${c.closestNote}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
        );
      });
    } else {
      lines.push('No alive, non-faction candidates in your pool to show.');
    }
    lines.push('`!target add <id>` adds players so they appear here / `!target scan <id>` checks them live.');
    await reply.edit(lines.join('\n'));
    return;
  }

  const count = Math.min(parseInt(args[0], 10) || MAX_SHOW, 10);

  const reply = await message.reply('Hunting\u2026');
  const { account, apiKey } = await resolveApiKey(userId);
  const self = await fetchSelf(userId, apiKey);

  const { candidates, ffCount, ffRegistered } = await buildCandidates(userId, apiKey, self, []);
  const unique = Array.from(new Set(candidates.map((c) => c.id)));
  const toInspect = unique.slice(0, CANDIDATE_CAP);
  const others = Math.max(0, unique.length - toInspect.length);

  const inspected = [];
  for (const id of toInspect) {
    const c = await inspectCandidate(id, apiKey);
    if (c) inspected.push(c);
  }
  const ffMap = await enrichWithFf(inspected.map((c) => c.id), apiKey);
  for (const c of inspected) { const r = ffMap[c.id]; c.ff = r ? r.fair_fight : null; c.ffEst = r ? r.bs_estimate_human : null; }

  const { good, skipped } = rankCandidates(inspected, self, getTargetList(userId).skip);

  const lines = [];
  lines.push(`🎯 **Easy targets for ${self.name}** (Lv${self.level}, ${fmt(self.total)} total)`);
  lines.push(`Pool: ${unique.length} unique (ffscouter ${ffCount}, whitelist ${getTargetList(userId).include.length})${others ? `, ${others} more not scanned` : ''}`);
  if (good.length) {
    lines.push(`Found **${good.length}** attackable with lower stats:`);
    good.slice(0, count).forEach((c, i) => {
      lines.push(
        `${i + 1}. **${c.name}** [${c.id}] · Lv${c.level} · ${fmt(c.total)} total${c.life ? ' · ' + fmt(c.life) + ' life' : ''}${c.ff != null ? ' · FF ' + c.ff : ''}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
      );
    });
  } else {
    if (!ffRegistered && !getTargetList(userId).include.length) {
      lines.push('No FFScouter pool — your Torn key isn\u2019t registered on FFScouter. Run `!torn setup`, then register that key at https://ffscouter.com (Setup in the README).');
      await reply.edit(lines.join('\n'));
      return;
    }
    const closest = findClosest(inspected, self, getTargetList(userId).skip, count);
    if (closest.length) {
      lines.push(`No confirmed easy targets — here are the **closest by level** in your pool (${closest.length <= count ? '' : '\u2014 all still checkable with \`!target scan\`'}):`);
      closest.forEach((c, i) => {
        lines.push(
          `${i + 1}. **${c.name}** [${c.id}] · Lv${c.level} · ${fmt(c.total)} total · ${c.status.state} · ${c.closestNote}\n   https://www.torn.com/page.php?sid=attack&user2ID=${c.id}`
        );
      });
      lines.push('These are *not* confirmed easy — you gain XP by attacking while **Leave**ing. Re-run `!target` as you level.');
      if (skipped.hospital.length || skipped.higher.length || skipped.band.length) {
        lines.push(`Skipped: ${skipped.hospital.length} in hospital, ${skipped.higher.length} with higher stats, ${skipped.band.length} out of level band, ${skipped.faction.length} faction mates, ${skipped.skippedList.length} on your skip list, ${skipped.unknown.length} with stats unknown.`);
      }
      await reply.edit(lines.join('\n'));
      return;
    }
    lines.push('No easy targets found — everyone in your pool is stronger, hospitalized, or out of your level band.');
  }
  if (skipped.hospital.length) lines.push(`Skipped: ${skipped.hospital.length} in hospital, ${skipped.higher.length} with higher stats, ${skipped.band.length} out of level band, ${skipped.faction.length} faction mates, ${skipped.skippedList.length} on your skip list, ${skipped.unknown.length} with stats unknown.`);
  lines.push('`!target add <id>` / `!target skip <id>` / `!target help`');
  await reply.edit(lines.join('\n'));
}

module.exports = { handleTarget, tryFindFfTargets };