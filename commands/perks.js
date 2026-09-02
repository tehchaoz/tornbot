const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

const FACTION_ID = process.env.FACTION_ID || '';

function resolveFactionKey() {
  try {
    const accounts = accountStore.getAllAccounts();
    const match = accounts.find((a) => (a.torn_username || '').toLowerCase().replace(/\s+/g, ' ').startsWith('drfruit'));
    if (match) { const k = accountStore.getApiKey(match.discord_user_id); if (k) return k; }
  } catch (e) {}
  return process.env.TORN_API_KEY || '';
}

function fmt(n) {
  if (n == null) return '?';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString('en-US');
}

async function handlePerks(message, args) {
  const showAll = (args[0] || '').toLowerCase() === 'all';

  let upgradesData;
  try {
    upgradesData = await tornGet('faction', FACTION_ID, 'upgrades', 1, resolveFactionKey(), { cacheTtl: 300, retries: 1 });
  } catch (e) {
    await message.reply(`Couldn't load faction perks: ${e.message}`);
    return;
  }

  const upgrades = Object.values(upgradesData.upgrades || {});
  if (!upgrades.length) {
    await message.reply('No perk data available for this faction.');
    return;
  }

  let factionName = FACTION_ID;
  let respect = null;
  try {
    const basic = await tornGet('faction', FACTION_ID, 'basic', 1, resolveFactionKey(), { cacheTtl: 300 });
    if (basic.name) factionName = basic.name;
    if (basic.respect !== undefined && basic.respect !== null) respect = basic.respect;
  } catch (e) {}

  const byBranch = {};
  const branchOrder = {};
  for (const up of upgrades) {
    const branch = up.branch || 'Other';
    (byBranch[branch] = byBranch[branch] || []).push(up);
    if (branchOrder[branch] == null && up.branchorder != null) branchOrder[branch] = up.branchorder;
  }

  const branchNames = Object.keys(byBranch).sort((a, b) => {
    const ao = branchOrder[a] != null ? branchOrder[a] : Infinity;
    const bo = branchOrder[b] != null ? branchOrder[b] : Infinity;
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b);
  });

  const lines = [];
  lines.push(`**Faction perks — ${factionName}**`);
  if (respect != null) lines.push(`Respect: ${fmt(respect)}`);
  lines.push('');

  for (const branch of branchNames) {
    const list = byBranch[branch].slice().sort((a, b) => {
      const ao = a.branchorder != null ? a.branchorder : Infinity;
      const bo = b.branchorder != null ? b.branchorder : Infinity;
      if (ao !== bo) return ao - bo;
      return (a.name || '').localeCompare(b.name || '');
    });
    const shown = list.filter((u) => showAll || (Number(u.level) || 0) > 0);
    if (!shown.length) continue;
    lines.push(`**${branch}**`);
    for (const u of shown) {
      const level = Number(u.level) || 0;
      const lockedMark = level === 0 ? ' (locked)' : '';
      lines.push(`\u2022 **${u.name}** — Lv ${level} — ${fmt(u.basecost)} respect — ${u.ability || ''}${lockedMark}`);
    }
    lines.push('');
  }

  await message.reply(lines.join('\n').replace(/\n\s*$/, ''));
}

module.exports = { handlePerks };
