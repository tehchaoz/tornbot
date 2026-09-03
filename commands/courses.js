const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

const OWNER_KEY = process.env.TORN_API_KEY || '';

const STAT_LABELS = {
  strength: 'Strength',
  defense: 'Defense',
  speed: 'Speed',
  dexterity: 'Dexterity',
  intelligence: 'Intelligence',
  endurance: 'Endurance',
  manual_labor: 'Manual Labor',
  working_stats: 'Working Stats',
  crime: 'Crime XP',
  battle_stats: 'Battle Stats',
  max_energy: 'Max Energy',
  max_happy: 'Max Happy',
  max_nerve: 'Max Nerve',
};

function statLabel(key) {
  if (STAT_LABELS[key]) return STAT_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function trimValue(v) {
  return String(v == null ? '' : v).trim();
}

function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remainder = s % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (parts.length === 0 || remainder > 0) parts.push(`${Math.round(remainder)}s`);
  return s <= 0 ? '0s' : `${parts.join(' ')}`;
}

function formatResults(results) {
  if (!results || typeof results !== 'object') return '';
  const parts = [];
  for (const [key, val] of Object.entries(results)) {
    const arr = Array.isArray(val) ? val : [val];
    const text = arr.map(trimValue).filter(Boolean).join(', ').replace(/\s+/g, ' ');
    if (!text) continue;
    if (key === 'perk') {
      parts.push(`perk: ${text}`);
    } else {
      parts.push(`+${text} ${statLabel(key)}`);
    }
  }
  return parts.join(', ');
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0';
  return `$${v.toLocaleString('en-US')}`;
}

function tierSortKey(t) {
  const n = Number(t);
  return Number.isFinite(n) && String(t).trim() !== '' ? [0, n] : [1, String(t)];
}

async function getEducation() {
  const d = await tornGet('torn', '', 'education', 1, OWNER_KEY, { cacheTtl: 86400, retries: 1 });
  return d.education || {};
}

function courseLine(c, mark) {
  const dur = formatDuration(c.duration);
  const res = formatResults(c.results);
  return `${mark} **${c.name}** [${c.code}] \u2014 ~${dur} \u2014 ${res}`;
}

function formatPrereqs(prereqs, byId) {
  if (!prereqs) return 'None';
  const arr = Array.isArray(prereqs) ? prereqs : [prereqs];
  if (!arr.length) return 'None';
  return arr
    .map((p) => {
      if (p && typeof p === 'object' && p.name) return p.name;
      const c = byId[String(p)];
      if (c && c.name) return `${c.name} (${c.code})`;
      return `#${p}`;
    })
    .join(', ');
}

async function handleCourses(message, args) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return;
  }

  let education;
  try {
    education = await getEducation();
  } catch (e) {
    await message.reply(`Couldn't load education list: ${e.message}`);
    return;
  }

  let completedSet = new Set();
  let currentId = null;
  try {
    const ued = await tornGet('user', '', 'education', 1, apiKey, { cacheTtl: 60, retries: 1 });
    completedSet = new Set((ued.education_completed || []).map(String));
    currentId = ued.education_current != null ? String(ued.education_current) : null;
  } catch (e) {}

  const markFor = (id) => {
    const sid = String(id);
    if (currentId === sid) return '\u23F3';
    if (completedSet.has(sid)) return '\u2705';
    return '\u2B1C';
  };

  const byId = {};
  const all = [];
  for (const [id, c] of Object.entries(education)) {
    if (!c || typeof c !== 'object') continue;
    c.id = String(id);
    byId[String(id)] = c;
    all.push(c);
  }
  if (!all.length) {
    await message.reply('No education courses returned by the Torn API.');
    return;
  }

  const query = (args || []).join(' ').trim().toLowerCase();

  if (!query) {
    const byTier = {};
    for (const c of all) {
      const t = c.tier != null && String(c.tier).trim() !== '' ? c.tier : 'Unknown';
      (byTier[t] = byTier[t] || []).push(c);
    }
    const lines = [`\u{1F393} **Torn Education Courses \u2014 ${account.tornUsername}**`];
    lines.push(`Completed **${completedSet.size}**${currentId ? ' \u00B7 \u23F3 one in progress' : ''}`);
    const tiers = Object.keys(byTier).sort((a, b) => {
      const [ka, va] = tierSortKey(a);
      const [kb, vb] = tierSortKey(b);
      if (ka !== kb) return ka - kb;
      return typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    });
    for (const t of tiers) {
      const list = byTier[t].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      lines.push(`\n**Tier ${t}** (${list.length})`);
      for (const c of list) lines.push(courseLine(c, markFor(c.id)));
    }
    lines.push('\n\u2705 done \u00B7 \u23F3 in progress \u00B7 \u2B1C not started \u00B7 `!courses <name>` for details.');
    await message.reply(lines.join('\n'));
    return;
  }

  const matches = all.filter((c) => {
    const name = (c.name || '').toLowerCase();
    const code = (c.code || '').toLowerCase();
    return name.includes(query) || code === query;
  });

  if (!matches.length) {
    await message.reply(`No courses matched \u201c${(args || []).join(' ')}\u201d. Try \`!courses\` for the full list.`);
    return;
  }

  const max = 8;
  const shown = matches.slice(0, max);
  const blocks = shown.map((c) => {
    const rows = [];
    rows.push(`${markFor(c.id)} **${c.name}** [${c.code}]`);
    rows.push(`Tier: ${c.tier != null ? c.tier : '?'} \u00B7 Cost: ${formatMoney(c.money_cost)} \u00B7 Duration: ~${formatDuration(c.duration)}`);
    const res = formatResults(c.results);
    rows.push(`Results: ${res || '\u2014'}`);
    rows.push(`Prerequisites: ${formatPrereqs(c.prerequisites, byId)}`);
    return rows.join('\n');
  });

  const lines = [`\u{1F393} **Education search: \u201c${(args || []).join(' ')}\u201d**`];
  lines.push(blocks.join('\n\n'));
  if (matches.length > max) lines.push(`\n\u2026and ${matches.length - max} more match(es). Narrow your search or run \`!courses\` for the full list.`);
  await message.reply(lines.join('\n'));
}

module.exports = { handleCourses };
