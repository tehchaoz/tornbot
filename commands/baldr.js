const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

const FACTION_ID = process.env.FACTION_ID || '';
const OWNER_KEY = process.env.TORN_API_KEY || '';
const BALDR_URL = 'https://raw.githubusercontent.com/OranWeb/tc-baldrs-levelling-list/master/data.json';
const BALDR_CACHE_TTL = 6 * 60 * 60 * 1000;
const MAX_SHOW = 8;

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

function atkLink(id) {
  return `https://www.torn.com/page.php?sid=attack&user2ID=${id}`;
}

// "players we know about" = faction roster + faction attack history (attackers/defenders).
const SCRUB_DAYS = 45;
const SCRUB_PAGES = 10;

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
        str: Number(String(e.str || 0).replace(/[,\s]/g, '')) || 0,
        def: Number(String(e.def || 0).replace(/[,\s]/g, '')) || 0,
        spd: Number(String(e.spd || 0).replace(/[,\s]/g, '')) || 0,
        dex: Number(String(e.dex || 0).replace(/[,\s]/g, '')) || 0,
        list: listName,
      };
    }
  }
  baldrCache = targets;
  baldrCacheAt = Date.now();
  console.log(`[baldr] full list loaded: ${Object.keys(targets).length} targets`);
  return targets;
}

function resolveFactionKey() {
  try {
    const accounts = accountStore.getAllAccounts();
    const match = accounts.find((a) => {
      const n = (a.torn_username || '').toLowerCase().replace(/\s+/g, ' ');
      return ['drfruit', 'dr fruit', 'd.r.fruit'].some((id) => n === id || n.startsWith(id));
    });
    if (match) {
      const key = accountStore.getApiKey(match.discord_user_id);
      if (key) return key;
    }
  } catch (e) {}
  return OWNER_KEY;
}

async function fetchFactionMembers() {
  return fetchMemberList();
}

async function fetchWideFactionAttackIds() {
  const history = await fetchAttackHistory();
  const known = flattenKnown(history);
  return { ids: Array.from(known.keys()), seenAttacks: history.length };
}

// Deep-dive a player using data we can actually read with our keys (feeds, not arbitrary
// user/{id} profile lookups). Torn (code 7) blocks reading arbitrary third-party profiles
// with the keys we hold, so "live" info is limited to what the faction feeds expose:
//   - current faction members: name/level/status/last_action from `faction basic`
//   - anyone in faction attack history: name/level from the attack feed
function flattenKnown(history) {
  const known = new Map(); // id -> { name, level, source }
  const add = (id, name, level, source) => {
    if (id == null) return;
    const k = String(id);
    if (!known.has(k)) known.set(k, { id: k, name, level, source });
  };
  for (const a of history) {
    if (a.attacker) add(a.attacker.id, a.attacker.name, a.attacker.level, 'attack history');
    if (a.defender) add(a.defender.id, a.defender.name, a.defender.level, 'attack history');
  }
  return known;
}

async function fetchMemberList() {
  if (!FACTION_ID) return {};
  try {
    const d = await tornGet('faction', FACTION_ID, 'basic', 1, resolveFactionKey(), { cacheTtl: 1800, retries: 1 });
    return d && d.members ? d.members : {};
  } catch (e) {
    return {};
  }
}

async function fetchAttackHistory() {
  if (!FACTION_ID) return [];
  const key = resolveFactionKey();
  const out = [];
  const now = Date.now() / 1000;
  let to = Math.floor(now);
  let from = Math.floor(now - SCRUB_DAYS * 86400);
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
    out.push(...list);
    const oldest = Math.min(...list.map((a) => a.started || a.ended || from));
    if (!isFinite(oldest) || oldest <= from) break;
    to = Math.floor(oldest) - 1;
    from = Math.floor(oldest) - Math.floor(SCRUB_DAYS * 86400 / SCRUB_PAGES);
  }
  return out;
}

async function handleBaldr(message, args) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const ownKey = accountStore.getApiKey(userId);
  if (!ownKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }

  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'list') {
    const level = parseInt(args[1], 10);
    if (!level) {
      await message.reply('Usage: `!baldr list <level>`');
      return;
    }
    const list = await fetchBaldrList();
    const rows = Object.values(list).filter((t) => t.level === level).sort((a, b) => a.total - b.total);
    if (!rows.length) {
      await message.reply(`No Baldr entries at level ${level}.`);
      return;
    }
    let out = `**Baldr targets at Lv${level}** (${rows.length}):\n`;
    rows.slice(0, 15).forEach((t) => { out += `\u2022 **${t.name}** [${t.id}] \u00B7 ${fmt(t.total)} total \u00B7 ${t.list}\n   <${atkLink(t.id)}>\n`; });
    if (rows.length > 15) out += `...and ${rows.length - 15} more.\n`;
    out += '`!baldr <name>` gets full details; `!baldr scan <id>` deep-dives with live faction-feed data.';
    await message.reply(out);
    return;
  }

  if (cmd === 'top') {
    const n = Math.min(Math.max(parseInt(args[1], 10) || 5, 1), 15);
    const list = await fetchBaldrList();
    const rows = Object.values(list).filter((t) => t.total > 0).sort((a, b) => a.total - b.total).slice(0, n);
    let out = `**${n} easiest by total stats in the full Baldr list:**\n`;
    rows.forEach((t) => { out += `\u2022 **${t.name}** [${t.id}] \u00B7 Lv${t.level} \u00B7 ${fmt(t.total)} total \u00B7 ${t.list}\n   <${atkLink(t.id)}>\n`; });
    await message.reply(out);
    return;
  }

  if (cmd === 'merged') {
    const reply = await message.reply('Building merged index\u2026');
    const baldr = await fetchBaldrList().catch(() => []);
    let members = {};
    let attacks = { ids: [], seenAttacks: 0 };
    try { members = await fetchFactionMembers(); } catch (e) {}
    try { attacks = await fetchWideFactionAttackIds(); } catch (e) {}
    const seen = new Set(Object.keys(members));
    let histCount = 0;
    for (const id of attacks.ids) {
      if (!seen.has(id)) { seen.add(id); histCount++; }
    }
    let merged = 0;
    for (const id of Object.keys(members)) merged++;
    const out = [
      `**Merged target index:**`,
      `\u2022 Baldr\'s list: ${Object.keys(baldr).length} targets (all 5 categories)`,
      `\u2022 Faction members: ${Object.keys(members).length}`,
      `\u2022 Faction attack history (${attacks.seenAttacks} attacks, ${SCRUB_DAYS}d window): ${attacks.ids.length} players (${histCount} not in faction)`,
      ``,
      'Search any of it with `!baldr <name-or-id>`. `!baldr scan <id>` deep-dives with live faction-feed data.',
    ];
    await reply.edit(out.join('\n'));
    return;
  }

  if (cmd === 'scan') {
    const target = (args[1] || '').trim();
    if (!target) {
      await message.reply('Usage: `!baldr scan <name-or-id>` — deep-dives a target using live faction-feed data.');
      return;
    }
    const reply = await message.reply('Gathering faction feeds\u2026');
    const list = await fetchBaldrList();
    const isId = /^\d+$/.test(target);
    let row = isId ? list[target] : null;
    if (!row) {
      const q = target.toLowerCase();
      row = Object.values(list).find((t) => t.name.toLowerCase().includes(q)) || null;
    }
    const members = await fetchMemberList();
    const history = await fetchAttackHistory();
    const known = flattenKnown(history);
    // Even for non-Baldr IDs (faction members / attack history), if no Baldr row matches
    // we still let the merged-index cross-reference below work.
    const lines = [];
    const liveKnown = known.get(String(isId ? target : (row ? row.id : '0')));
    const isMember = row && members[row.id] ? members[row.id] : (isId ? members[target] : null);

    if (row) {
      lines.push(`**${row.name}** [${row.id}] \u00B7 Lv${row.level} \u00B7 ${fmt(row.total)} total \u00B7 ${row.list}`);
    }

    // Our key scope can't read arbitrary third-party profiles (Torn code 7). Only surface
    // live data we genuinely get from faction feeds (members + attack history).
    if (isMember) {
      lines.push(`\u2705 **Current faction member** \u00B7 ${isMember.position} \u00B7 Lv${isMember.level} \u00B7 ${isMember.status && isMember.status.state}${isMember.last_action ? ' \u00B7 last ' + isMember.last_action.relative : ''}`);
    }
    if (liveKnown) {
      lines.push(`\uD83D\uDD0D In your faction\u2019s recent attack history (${liveKnown.source}) \u00B7 Lv${liveKnown.level || '?'}`);
    }
    if (!row && !isMember && !liveKnown) {
      await reply.edit(`No target found matching \u201C${target}\u201D in Baldr's list, our faction, or recent attack history.`);
      return;
    }
    if (!isMember && !liveKnown) {
      lines.push(`_Live status unavailable: the API keys we hold are not permitted to read arbitrary third-party profiles (Torn \u201CIncorrect ID-entity relation\u201D). oran.pw only shows this because a browser key reads it directly._`);
    }
    if (row) lines.push(`https://www.torn.com/page.php?sid=attack&user2ID=${row.id}`);
    await reply.edit(lines.join('\n'));
    return;
  }

  if (cmd === 'near') {
    // Show Baldr targets in the requested level range of a caller-provided level,
    // defaulting to the caller's own level (read with their own key).
    let level = parseInt(args[1], 10);
    if (!level) {
      try {
        const self = await tornGet('user', '', 'profile', 1, ownKey);
        level = self && self.level ? Number(self.level) : 0;
      } catch (e) { level = 0; }
    }
    if (!level) {
      await message.reply('Usage: `!baldr near [level]` — show Baldr targets within \u00B13 levels (defaults to your level).');
      return;
    }
    const list = await fetchBaldrList();
    const rows = Object.values(list)
      .filter((t) => Math.abs(t.level - level) <= 3)
      .sort((a, b) => a.total - b.total);
    if (!rows.length) {
      await message.reply(`No Baldr targets near Lv${level}.`);
      return;
    }
    let out = `**Baldr targets near Lv${level}** (${rows.length}):\n`;
    rows.slice(0, 15).forEach((t) => { out += `\u2022 **${t.name}** [${t.id}] \u00B7 Lv${t.level} \u00B7 ${fmt(t.total)} total \u00B7 ${t.list}\n   <${atkLink(t.id)}>\n`; });
    if (rows.length > 15) out += `...and ${rows.length - 15} more.\n`;
    await message.reply(out);
    return;
  }

  if (cmd === 'farm' || cmd === 'best') {
    // Find higher-level Baldr targets you can actually beat. Uses your own battlestats
    // (read with your own key) vs each target's listed str/def/spd/dex/total.
    let minLevel = 0;
    let maxLevel = 0;
    const rangeArg = (args[1] || '').toLowerCase();
    if (rangeArg.includes('-')) {
      const parts = rangeArg.split('-').map((n) => parseInt(n, 10));
      minLevel = parts[0] || 0;
      maxLevel = parts[1] || 0;
    } else if (/^\d+$/.test(rangeArg)) {
      minLevel = parseInt(rangeArg, 10);
      maxLevel = minLevel;
    }

    let self = null;
    try {
      const d = await tornGet('user', '', 'profile,battlestats', 1, ownKey);
      if (d && d.player_id) {
        const total = d.total != null ? d.total : ((d.strength || 0) + (d.defense || 0) + (d.speed || 0) + (d.dexterity || 0));
        self = {
          name: d.name,
          level: Number(d.level) || 0,
          total: Number(total) || 0,
          str: Number(d.strength) || 0,
          def: Number(d.defense) || 0,
          spd: Number(d.speed) || 0,
          dex: Number(d.dexterity) || 0,
        };
      }
    } catch (e) {}

    const base = self && self.level ? self.level : 0;
    if (!maxLevel) maxLevel = base + 15;
    if (!minLevel) minLevel = base + 1;
    if (minLevel > maxLevel) [minLevel, maxLevel] = [maxLevel, minLevel];

    const list = await fetchBaldrList();
    const rows = Object.values(list).filter((t) => t.level >= minLevel && t.level <= maxLevel);
    if (!rows.length) {
      await message.reply(`No Baldr targets between Lv${minLevel}\u2013${maxLevel}. Try a wider range, e.g. \`!baldr farm ${minLevel}-${maxLevel + 10}\`.`);
      return;
    }

    const scored = rows.map((t) => {
      let odds = null;
      let label = '';
      if (self && self.total && t.total) {
        const ratio = self.total / t.total;
        const perStat = [
          (self.str + 1) / (t.str + 1),
          (self.def + 1) / (t.def + 1),
          (self.spd + 1) / (t.spd + 1),
          (self.dex + 1) / (t.dex + 1),
        ];
        const worst = Math.min(...perStat);
        odds = ratio * 0.7 + worst * 0.3;
        if (odds >= 1.3) label = '\u2705 easy win';
        else if (odds >= 1.0) label = '\u2705 likely win';
        else if (odds >= 0.75) label = '\u26A0\uFE0F coin flip';
        else label = '\u274C risky';
      } else {
        label = 'win odds n/a';
      }
      return { t, odds, label };
    });

    // Best farming = highest level (max XP) you can still beat. Sort by win odds desc,
    // then level desc, so the top rows are high-level AND winnable.
    scored.sort((a, b) => {
      const ao = a.odds != null ? a.odds : -1;
      const bo = b.odds != null ? b.odds : -1;
      if (bo !== ao) return bo - ao;
      return b.t.level - a.t.level;
    });

    const header = self
      ? `**Farming targets for ${self.name}** (Lv${self.level} \u00B7 ${fmt(self.total)} total: S${self.str}/D${self.def}/Sp${self.spd}/Dx${self.dex})`
      : '**Farming targets**';
    let out = `${header}\nRange Lv${minLevel}\u2013${maxLevel}, best winnable XP first:\n`;
    scored.slice(0, 12).forEach(({ t, label }, i) => {
      out += `${i + 1}. **${t.name}** [${t.id}] \u00B7 Lv${t.level} \u00B7 ${fmt(t.total)} total \u00B7 S${t.str}/D${t.def}/Sp${t.spd}/Dx${t.dex} \u00B7 ${label}\n   <${atkLink(t.id)}>\n`;
    });
    if (scored.length > 12) out += `...and ${scored.length - 12} more.\n`;
    out += 'Win odds are a rough estimate from your total + per-stat stats vs theirs. Attack and **Leave** for max XP.';
    await message.reply(out);
    return;
  }

  // default: search by name/id across the FULL Baldr list (all categories)
  const query = args.join(' ').trim();
  if (!query) {
    await message.reply(
      '**!baldr** — search Baldr\'s levelling list (all 385 targets, 7 lists).\n' +
      '`!baldr <name>` — search the full list by name.\n' +
      '`!baldr <id>` — lookup a specific ID.\n' +
      '`!baldr list <level>` — show all targets at a level.\n' +
      '`!baldr near [level]` — show targets within \u00B13 of a level (defaults to yours).\n' +
      '`!baldr farm [min-max]` — higher-level low-stat targets you can beat (uses your stats).\n' +
      '`!baldr top <n>` — n easiest by total.\n' +
      '`!baldr scan <name-or-id>` — deep-dive using live faction-feed data.\n' +
      '`!baldr merged` — how the merged index (Baldr + faction + attack history) is built.\n' +
      'Note: our API keys cannot read arbitrary third-party live status (Torn blocks it); live data comes from faction feeds where available.'
    );
    return;
  }

  const isId = /^\d+$/.test(query);
  const list = await fetchBaldrList();
  let rows;
  if (isId) {
    const row = list[query];
    rows = row ? [row] : [];
  } else {
    const q = query.toLowerCase();
    rows = Object.values(list).filter((t) => t.name.toLowerCase().includes(q));
    rows.sort((a, b) => a.total - b.total);
  }

  if (!rows.length) {
    await message.reply(`No Baldr targets match \u201C${query}\u201D. Try another name, an exact ID, or \`!baldr merged\` / \`!baldr list <level>\`.`);
    return;
  }

  const shown = rows.slice(0, MAX_SHOW);
  let out = `**Baldr matches: ${rows.length}**${rows.length > shown.length ? ` (showing ${shown.length})` : ''}\n`;
  shown.forEach((t) => {
    out += `\u2022 **${t.name}** [${t.id}] \u00B7 Lv${t.level} \u00B7 ${fmt(t.total)} total \u00B7 ${t.list}\n   <${atkLink(t.id)}>\n`;
  });
  out += '\n`!baldr scan <name-or-id>` deep-dives; `!baldr list <level>` / `!baldr near <level>` browse.';
  await message.reply(out);
}

module.exports = { handleBaldr };
