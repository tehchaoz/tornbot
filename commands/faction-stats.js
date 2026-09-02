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

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function fmtDate(ts) {
  const t = Number(ts) || 0;
  if (!t) return '?';
  const d = new Date(t * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function getFactionName() {
  try {
    const d = await tornGet('faction', FACTION_ID, 'basic', 1, resolveFactionKey(), { cacheTtl: 300, retries: 1 });
    return (d && d.faction && d.faction.name) || (d && d.name) || '';
  } catch (e) {
    return '';
  }
}

async function handleFinances(message) {
  const key = resolveFactionKey();
  let data;
  try {
    data = await tornGet('faction', FACTION_ID, 'balance', 2, key, { cacheTtl: 30, retries: 1 });
  } catch (e) {
    try {
      const c = await tornGet('faction', FACTION_ID, 'currency', 1, key, { cacheTtl: 30, retries: 1 });
      await message.reply(`**Faction finances**\nMoney: ${fmtMoney(c.money)}\nPoints: ${Number(c.points || 0).toLocaleString('en-US')}`);
    } catch (e2) {
      await message.reply(`Couldn't fetch finances: ${e2.message}`);
    }
    return;
  }

  const bal = (data && data.balance) || {};
  const faction = bal.faction || {};
  let name = faction.name || '';
  if (!name) name = await getFactionName();

  const lines = [`**Faction finances${name ? ' — ' + name : ''}**`];
  lines.push(`Money: ${fmtMoney(faction.money)}`);
  lines.push(`Points: ${Number(faction.points || 0).toLocaleString('en-US')}`);

  // Only the requesting player's own balance, not the whole member list.
  const members = Array.isArray(bal.members) ? bal.members : [];
  const account = accountStore.getAccount(message.author.id);
  let own = null;
  if (account) {
    const pid = String(account.tornPlayerId || '').trim();
    const uname = (account.tornUsername || '').trim().toLowerCase();
    own = members.find((m) => {
      if (pid && String(m.id) === pid) return true;
      if (uname && String(m.username || '').trim().toLowerCase() === uname) return true;
      return false;
    });
  }
  if (own) {
    lines.push(`Your balance: ${fmtMoney(own.money)}${own.points != null ? ` · ${Number(own.points).toLocaleString('en-US')} points` : ''}`);
  } else {
    lines.push('Couldn\u2019t match your Discord account to a faction member. Run `!torn setup` to link your Torn account.');
  }

  await message.reply(lines.join('\n'));
}

async function handleChainReport(message) {
  const key = resolveFactionKey();
  let cr;
  try {
    cr = await tornGet('faction', FACTION_ID, 'chainreport', 1, key, { cacheTtl: 30, retries: 1 });
  } catch (e) {
    await message.reply(`Couldn't fetch chain report: ${e.message}`);
    return;
  }

  const report = (cr && cr.chainreport) || cr || {};
  const lines = [];

  if (Number(report.chain || 0) === 0) {
    lines.push('No active chain.');
  } else {
    lines.push(`**Current chain** — ${report.chain} hits`);
    lines.push(`Respect: ${Number(report.respect || 0).toLocaleString('en-US')}`);
    lines.push(`Leave: ${report.leave || 0} · Mug: ${report.mug || 0} · Hospitalize: ${report.hospitalize || 0} · Assists: ${report.assists || 0}`);
  }

  let chains;
  try {
    chains = await tornGet('faction', FACTION_ID, 'chains', 1, key, { cacheTtl: 30, retries: 1 });
  } catch (e) { chains = null; }

  if (chains && chains.chains) {
    const list = Object.entries(chains.chains)
      .sort((a, b) => (b[1].chain || 0) - (a[1].chain || 0))
      .slice(0, 5);
    if (list.length) {
      lines.push('');
      lines.push('**Last 5 chains:**');
      for (const [, c] of list) {
        lines.push(`• Chain ${c.chain} — ${Number(c.respect || 0).toLocaleString('en-US')} respect — ${fmtDate(c.start)}→${fmtDate(c.end)}`);
      }
    }
  }

  await message.reply(lines.join('\n'));
}

async function handleArmory(message) {
  const key = resolveFactionKey();
  const sections = ['weapons', 'armor', 'drugs', 'boosters', 'temporary'];
  const labels = { weapons: 'Weapons', armor: 'Armor', drugs: 'Drugs', boosters: 'Boosters', temporary: 'Temporary' };

  const lines = ['**Faction armory**'];

  for (const sec of sections) {
    let data;
    try {
      data = await tornGet('faction', FACTION_ID, sec, 1, key, { cacheTtl: 30, retries: 1 });
    } catch (e) {
      continue;
    }
    const items = Array.isArray(data && data[sec]) ? data[sec] : [];
    if (!items.length) continue;

    lines.push('');
    lines.push(`__${labels[sec]}__`);
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      const available = it.available != null ? Number(it.available) : null;
      const loaned = it.loaned != null ? Number(it.loaned) : null;
      const hasAvail = available != null;
      const hasLoan = loaned != null;
      const flag = (hasAvail && available === 0 && qty > 0) ? ' ⚠️' : '';
      const parts = [`qty ${qty}`];
      if (hasAvail) parts.push(`${available} available`);
      if (hasLoan) parts.push(`${loaned} loaned${it.loaned_to ? ' to ' + it.loaned_to : ''}`);
      lines.push(`• **${it.name || it.ID || '?'}** — ${parts.join(' · ')}${flag}`);
    }
  }

  if (lines.length === 1) lines.push('No armory data available.');
  await message.reply(lines.join('\n'));
}

async function handleWars(message) {
  const key = resolveFactionKey();
  let data;
  try {
    data = await tornGet('faction', FACTION_ID, 'wars', 2, key, { cacheTtl: 30, retries: 1 });
  } catch (e) {
    await message.reply(`Couldn't fetch wars: ${e.message}`);
    return;
  }

  const wars = (data && data.wars) || {};
  const ranked = wars.ranked || null;
  const raids = Array.isArray(wars.raids) ? wars.raids : [];
  const territory = Array.isArray(wars.territory) ? wars.territory : [];

  const lines = [];

  if (ranked && typeof ranked === 'object' && Object.keys(ranked).length) {
    lines.push('**Ranked war:**');
    if (ranked.factions && typeof ranked.factions === 'object') {
      const fs = Object.values(ranked.factions)
        .map((f) => `${f && f.name ? f.name : '?'}${f && f.score != null ? ' (' + f.score + ')' : ''}`)
        .join(' vs ');
      lines.push(`• Factions: ${fs}`);
    }
    if (ranked.score != null) lines.push(`• Score: ${ranked.score}`);
    if (ranked.start != null) lines.push(`• Start: ${fmtDate(ranked.start)}`);
    if (ranked.end != null) lines.push(`• End: ${fmtDate(ranked.end)}`);
  } else {
    lines.push('**Ranked war:** none');
  }

  lines.push(`Raids: ${raids.length}`);
  lines.push(`Territory wars: ${territory.length}`);

  await message.reply(lines.join('\n'));
}

module.exports = { handleFinances, handleChainReport, handleArmory, handleWars };
