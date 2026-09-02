const { tornGet } = require('../services/torn-api');

const OWNER_KEY = process.env.TORN_API_KEY || '';

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').trim();
}

async function handleCalendar(message) {
  let data;
  try {
    data = await tornGet('torn', '', 'calendar', 2, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load calendar: ${e.message}`);
    return;
  }

  const cal = (data && data.calendar) || {};
  const lines = ['**Upcoming events**'];
  let found = false;

  for (const val of Object.values(cal)) {
    if (!Array.isArray(val) || val.length === 0) continue;
    found = true;
    for (const ev of val) {
      if (!ev || typeof ev !== 'object') continue;
      const title = stripTags(ev.title);
      const description = stripTags(ev.description);
      lines.push(`\u2022 **${title}** \u2014 ${description}`);
    }
  }

  if (!found) lines.push('No upcoming events.');
  await message.reply(lines.join('\n'));
}

async function handleDirtybombs(message) {
  let data;
  try {
    data = await tornGet('torn', '', 'dirtybombs', 1, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load dirty bombs: ${e.message}`);
    return;
  }

  const bombs = (data && data.dirtybombs) || [];
  const lines = ['**Dirty bombs**'];

  if (!Array.isArray(bombs) || bombs.length === 0) {
    lines.push('No recent dirty bombs.');
    await message.reply(lines.join('\n'));
    return;
  }

  for (const b of bombs) {
    const who = [b.faction, b.user].filter(Boolean).join('/') || 'unknown';
    const injured = b.injured != null ? b.injured : 0;
    const respect = b.respect != null ? b.respect : 0;
    const date = b.planted ? new Date(Number(b.planted) * 1000).toLocaleDateString() : 'unknown';
    lines.push(`\u2022 ${who} \u2014 injured ${injured} \u2014 respect ${respect} \u2014 planted ${date}`);
  }

  await message.reply(lines.join('\n'));
}

async function handleBounties(message) {
  let data;
  try {
    data = await tornGet('torn', '', 'bounties', 2, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load bounties: ${e.message}`);
    return;
  }

  const bounties = (data && data.bounties) || [];
  const lines = ['**Bounty board**'];

  if (!Array.isArray(bounties) || bounties.length === 0) {
    lines.push('No open bounties.');
    await message.reply(lines.join('\n'));
    return;
  }

  for (const b of bounties) {
    const name = stripTags(b.target_name);
    let line = `\u2022 **${name}**`;
    if (b.target_id != null) line += ` [${b.target_id}]`;
    if (b.target_level != null) line += ` \u2014 Lv${b.target_level}`;
    if (b.reward != null) line += ` \u2014 reward ${fmtMoney(b.reward)}`;
    if (b.target_id != null) line += ` \u2014 <https://www.torn.com/profiles.php?XID=${b.target_id}>`;
    lines.push(line);
  }

  await message.reply(lines.join('\n'));
}

async function handleOcs(message) {
  let data;
  try {
    data = await tornGet('torn', '', 'organisedcrimes', 1, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load organized crimes: ${e.message}`);
    return;
  }

  const ocs = (data && data.organisedcrimes) || {};
  const list = Object.values(ocs).filter((o) => o && typeof o === 'object');
  list.sort((a, b) => (Number(b.max_respect) || 0) - (Number(a.max_respect) || 0));

  const lines = ['**Organized crimes**'];

  if (list.length === 0) {
    lines.push('No organized crimes returned.');
    await message.reply(lines.join('\n'));
    return;
  }

  for (const o of list) {
    const name = o.name || 'unknown';
    const members = o.members != null ? o.members : 0;
    const time = o.time != null ? o.time : 0;
    const minCash = o.min_cash != null ? o.min_cash : 0;
    const maxCash = o.max_cash != null ? o.max_cash : 0;
    const minRespect = o.min_respect != null ? o.min_respect : 0;
    const maxRespect = o.max_respect != null ? o.max_respect : 0;
    lines.push(`\u2022 **${name}** \u2014 ${members} members \u00B7 ${time}h \u00B7 $${minCash}-${maxCash} cash \u00B7 ${minRespect}-${maxRespect} respect`);
  }

  await message.reply(lines.join('\n'));
}

module.exports = { handleCalendar, handleDirtybombs, handleBounties, handleOcs };
