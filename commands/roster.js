const { tornGet } = require('../services/torn-api');
const accountStore = require('../services/account-store');

const FACTION_ID = process.env.FACTION_ID || '';

function resolveFactionKey() {
  try {
    const accounts = accountStore.getAllAccounts();
    const match = accounts.find((a) => (a.torn_username || '').toLowerCase().replace(/\s+/g, ' ').startsWith('drfruit'));
    if (match) { const k = accountStore.getApiKey(match.discord_user_id); if (k) return k; }
  } catch (e) {}
  return process.env.TORN_API_KEY || '';
}

async function fetchMembers() {
  const d = await tornGet('faction', FACTION_ID, 'basic', 1, resolveFactionKey(), { cacheTtl: 60, retries: 1 });
  return d.members || {};
}

function memberEntries(members, filter) {
  const f = (filter || '').toLowerCase();
  return Object.entries(members)
    .map(([id, m]) => ({ id, ...m }))
    .filter((m) => !f || (m.name || '').toLowerCase().includes(f));
}

async function handleActivity(message, args) {
  const filter = (args || []).join(' ');
  let members;
  try {
    members = await fetchMembers();
  } catch (e) {
    await message.reply(`Couldn't fetch faction activity: ${e.message}`);
    return;
  }

  const entries = memberEntries(members, filter).sort(
    (a, b) => ((b.last_action && b.last_action.timestamp) || 0) - ((a.last_action && a.last_action.timestamp) || 0)
  );

  if (!entries.length) {
    await message.reply(filter ? `No faction members match "${filter}".` : 'No faction members found.');
    return;
  }

  const lines = [`**Faction activity** — ${entries.length} member${entries.length === 1 ? '' : 's'}`];
  for (const m of entries) {
    const la = m.last_action || {};
    const state = (m.status && m.status.state) || '';
    lines.push(`• **${m.name || '?'}** [${m.id}] — Lv${m.level != null ? m.level : '?'} — ${la.relative || '?'} — ${state || '?'}`);
  }
  lines.push('');
  lines.push('_Sorted most-recently-active first. Torn\'s API doesn\'t expose member timezones — "last active" is the closest proxy._');

  await message.reply(lines.join('\n'));
}

async function handleRoster(message, args) {
  const filter = (args || []).join(' ');
  let members;
  try {
    members = await fetchMembers();
  } catch (e) {
    await message.reply(`Couldn't fetch roster: ${e.message}`);
    return;
  }

  const entries = memberEntries(members, filter).sort(
    (a, b) => ((b.last_action && b.last_action.timestamp) || 0) - ((a.last_action && a.last_action.timestamp) || 0)
  );

  if (!entries.length) {
    await message.reply(filter ? `No faction members match "${filter}".` : 'No faction members found.');
    return;
  }

  const lines = [`**Member roster** — ${entries.length} member${entries.length === 1 ? '' : 's'}`];
  for (const m of entries) {
    const la = m.last_action || {};
    const status = m.status || {};
    const location = status.description || status.state || '';
    const days = m.days_in_faction != null ? `${m.days_in_faction}d` : '?';
    lines.push(`• **${m.name || '?'}** [${m.id}] — Lv${m.level != null ? m.level : '?'} — ${m.position || '?'} — ${location || '?'} — last ${la.relative || '?'} — ${days}`);
  }

  await message.reply(lines.join('\n'));
}

module.exports = { handleActivity, handleRoster };
