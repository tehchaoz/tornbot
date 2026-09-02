const fs = require('fs');
const accountStore = require('./account-store');
const { tornGet } = require('./torn-api');

const KNOWN_FILE = '/opt/discord-bot/known.json';
const FACTION_ID = process.env.FACTION_ID || '';
const BALDR_URL = 'https://raw.githubusercontent.com/OranWeb/tc-baldrs-levelling-list/master/data.json';
const ATTACK_DAYS = 45;

let known = {};
let loaded = false;

function load() {
  try {
    if (fs.existsSync(KNOWN_FILE)) known = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8'));
  } catch (e) {
    known = {};
  }
  if (!known || typeof known !== 'object') known = {};
  loaded = true;
}

function save() {
  try { fs.writeFileSync(KNOWN_FILE, JSON.stringify(known)); } catch (e) {}
}

function now() { return Math.floor(Date.now() / 1000); }

function register(id, name, level, source) {
  const sid = String(id);
  if (!sid || !/^\d+$/.test(sid)) return false;
  const entry = known[sid];
  if (!entry) {
    known[sid] = { id: sid, name: name || '#' + sid, level: level != null ? Number(level) || null : null, source: source || 'unknown', first: now(), last: now() };
    return true;
  }
  let changed = false;
  if ((!entry.name || entry.name === '#' + sid) && name) { entry.name = name; changed = true; }
  if (level != null) {
    const lv = Number(level);
    if (lv && (entry.level == null || lv > entry.level)) { entry.level = lv; changed = true; }
  }
  if (changed) save();
  entry.last = now();
  return false;
}

function registerMany(rows, source) {
  let added = 0;
  for (const r of rows) {
    if (!r || r.id == null) continue;
    if (register(r.id, r.name, r.level, source)) added++;
  }
  return added;
}

function resolveFactionKey() {
  try {
    const accounts = accountStore.getAllAccounts();
    const match = accounts.find((a) => (a.torn_username || '').toLowerCase().replace(/\s+/g, ' ').startsWith('drfruit'));
    if (match) { const k = accountStore.getApiKey(match.discord_user_id); if (k) return k; }
  } catch (e) {}
  return process.env.TORN_API_KEY || '';
}

async function syncFromAccounts() {
  const accounts = accountStore.getAllAccounts();
  let added = 0;
  for (const a of accounts) {
    if (a.torn_player_id && register(a.torn_player_id, a.torn_username, null, 'linked')) added++;
  }
  return added;
}

async function syncFromFactionMembers() {
  if (!FACTION_ID) return 0;
  try {
    const d = await tornGet('faction', FACTION_ID, 'basic', 1, resolveFactionKey(), { cacheTtl: 300, retries: 1 });
    const members = d && d.members ? d.members : {};
    let added = 0;
    for (const [id, m] of Object.entries(members)) {
      if (register(id, m.name, m.level, 'faction member')) added++;
    }
    return added;
  } catch (e) { return 0; }
}

async function syncFromFactionAttacks() {
  if (!FACTION_ID) return 0;
  const key = resolveFactionKey();
  const nowS = now();
  let to = nowS;
  let from = nowS - ATTACK_DAYS * 86400;
  let added = 0;
  for (let page = 0; page < 10; page++) {
    let d = null;
    try {
      const url = `https://api.torn.com/v2/faction/${FACTION_ID}/?selections=attacks&from=${from}&to=${to}&limit=100&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { timeout: 10000 });
      d = await res.json().catch(() => null);
    } catch (e) { break; }
    if (!d || d.error || !d.attacks) break;
    const list = Array.isArray(d.attacks) ? d.attacks : [];
    if (!list.length) break;
    for (const a of list) {
      if (a.attacker && register(a.attacker.id, a.attacker.name, a.attacker.level, 'faction attack')) added++;
      if (a.defender && register(a.defender.id, a.defender.name, a.defender.level, 'faction attack')) added++;
    }
    const oldest = Math.min(...list.map((a) => a.started || a.ended || from));
    if (!isFinite(oldest) || oldest <= from) break;
    to = Math.floor(oldest) - 1;
    from = Math.floor(oldest) - Math.floor(ATTACK_DAYS * 86400 / 10);
  }
  return added;
}

async function syncFromOwnAttacks() {
  const accounts = accountStore.getAllAccounts();
  let added = 0;
  for (const a of accounts) {
    const key = accountStore.getApiKey(a.discord_user_id);
    if (!key) continue;
    try {
      const d = await tornGet('user', '', 'attacks', 1, key, { cacheTtl: 600, retries: 1 });
      const list = d && d.attacks ? d.attacks : [];
      for (const at of list) {
        if (at.defender_id && register(at.defender_id, at.defender_name, at.defender_level, 'own attack')) added++;
        if (at.attacker_id && register(at.attacker_id, at.attacker_name, at.attacker_level, 'own attack')) added++;
      }
    } catch (e) {}
  }
  return added;
}

async function syncFromBaldr() {
  let added = 0;
  try {
    const res = await fetch(BALDR_URL, { timeout: 15000 });
    const json = await res.json().catch(() => null);
    if (!json) return 0;
    for (const entries of Object.values(json)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (e && e.id && register(e.id, e.name, e.lvl, 'baldr')) added++;
      }
    }
  } catch (e) {}
  return added;
}

async function syncAll() {
  if (!loaded) load();
  const before = Object.keys(known).length;
  const added = {
    accounts: await syncFromAccounts(),
    members: await syncFromFactionMembers(),
    attacks: await syncFromFactionAttacks(),
    own: await syncFromOwnAttacks(),
    baldr: await syncFromBaldr(),
  };
  save();
  const after = Object.keys(known).length;
  return { before, after, totalAdded: after - before, added };
}

function count() { return Object.keys(known).length; }

function sourceBreakdown() {
  const s = {};
  for (const e of Object.values(known)) {
    const k = e.source || 'unknown';
    s[k] = (s[k] || 0) + 1;
  }
  return s;
}

function search(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const e = known[q];
    return e ? [e] : [];
  }
  return Object.values(known).filter((e) => (e.name || '').toLowerCase().includes(q));
}

function all() { return Object.values(known); }

module.exports = { load, save, register, registerMany, syncAll, count, sourceBreakdown, search, all };
