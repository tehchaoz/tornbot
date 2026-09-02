const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

const RARITY_RANK = {
  'very common': 0,
  'common': 1,
  'uncommon': 2,
  'rare': 3,
  'very rare': 4,
  'ultra rare': 5,
  'epic': 6,
  'legendary': 7,
  'unique': 8,
};

function rarityRank(r) {
  const k = (r || '').toLowerCase();
  return RARITY_RANK[k] != null ? RARITY_RANK[k] : 4;
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').trim();
}

function titleCase(s) {
  return String(s || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function requireAuth(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return null;
  }
  const apiKey = accountStore.getApiKey(userId);
  if (!apiKey) {
    await message.reply('Your API key could not be retrieved. Use `!torn setup` to reconnect.');
    return null;
  }
  return { account, apiKey };
}

async function handleNetworth(message) {
  const auth = await requireAuth(message);
  if (!auth) return;
  const { account, apiKey } = auth;

  let d;
  try {
    d = await tornGet('user', '', 'networth', 1, apiKey, { cacheTtl: 300, retries: 1 });
  } catch (e) {
    await message.reply(`Couldn't load networth: ${e.message}`);
    return;
  }

  const nw = d.networth || {};
  const MONEY_FIELDS = ['pending', 'wallet', 'bank', 'points', 'cayman', 'vault', 'piggybank', 'items', 'displaycase', 'bazaar', 'properties', 'stockmarket', 'auctionhouse', 'company', 'itemmarket'];
  const lines = [`**Networth \u2014 ${account.tornUsername}**`];
  for (const key of MONEY_FIELDS) {
    const val = nw[key];
    if (Number(val)) lines.push(`${titleCase(key)}: ${fmtMoney(val)}`);
  }
  lines.push(`**Total: ${fmtMoney(nw.total)}**`);
  await message.reply(lines.join('\n'));
}

async function handleMedals(message, args = []) {
  const auth = await requireAuth(message);
  if (!auth) return;
  const { account, apiKey } = auth;

  const cmd = (args[0] || '').toLowerCase();

  let defs;
  let earnedSet;
  try {
    const [defsData, earnedData] = await Promise.all([
      tornGet('torn', '', 'medals', 1, apiKey, { cacheTtl: 86400, retries: 1 }),
      tornGet('user', '', 'medals', 1, apiKey, { cacheTtl: 60, retries: 1 }),
    ]);
    defs = Object.values(defsData.medals || {}).filter((m) => m && m.name);
    earnedSet = new Set((earnedData.medals_awarded || []).map(String));
  } catch (e) {
    await message.reply(`Couldn't load medals: ${e.message}`);
    return;
  }

  const earnedArr = defs.filter((m) => earnedSet.has(String(m.id)));
  const unearned = defs.filter((m) => !earnedSet.has(String(m.id)));

  const typeOf = (m) => (m.type && m.type.title ? m.type.title : (m.type || 'General'));

  if (cmd === 'next') {
    const sorted = unearned.slice().sort((a, b) => {
      const ra = rarityRank(a.rarity);
      const rb = rarityRank(b.rarity);
      if (ra !== rb) return ra - rb;
      return (b.circulation || 0) - (a.circulation || 0);
    });
    const lines = [`**Medals \u2014 ${account.tornUsername}**`, '**Next medals to earn:**'];
    if (!sorted.length) {
      lines.push('\u{1F389} You\'ve earned every medal!');
    } else {
      for (const m of sorted.slice(0, 10)) {
        lines.push(`\u2B1C **${m.name}** \u2014 ${m.description || ''}${m.rarity ? ` _(${m.rarity})_` : ''}`);
      }
      if (sorted.length > 10) lines.push(`\u2026and ${sorted.length - 10} more.`);
    }
    await message.reply(lines.join('\n'));
    return;
  }

  if (cmd === 'list') {
    const byType = {};
    for (const m of defs) {
      const t = typeOf(m);
      (byType[t] = byType[t] || []).push(m);
    }
    const lines = [`**All medals** \u2014 ${earnedArr.length}/${defs.length} earned`];
    for (const t of Object.keys(byType).sort()) {
      lines.push(`\n**${t}** (${byType[t].filter((m) => earnedSet.has(String(m.id))).length}/${byType[t].length})`);
      for (const m of byType[t]) {
        lines.push(`${earnedSet.has(String(m.id)) ? '\u2705' : '\u2B1C'} **${m.name}** \u2014 ${m.description || ''}`);
      }
    }
    await message.reply(lines.join('\n'));
    return;
  }

  const lines = [`**Medals \u2014 ${account.tornUsername}**`, `Earned **${earnedArr.length}** medals`];
  for (const m of earnedArr) {
    lines.push(`\u2705 **${m.name}** \u2014 ${m.description || ''}`);
  }
  await message.reply(lines.join('\n'));
}

async function handleJob(message) {
  const auth = await requireAuth(message);
  if (!auth) return;
  const { account, apiKey } = auth;

  let job;
  let jobranks;
  let jobpoints;
  try {
    const [jobData, ranksData, pointsData] = await Promise.all([
      tornGet('user', '', 'job', 2, apiKey, { cacheTtl: 60, retries: 1 }),
      tornGet('user', '', 'jobranks', 2, apiKey, { cacheTtl: 300, retries: 1 }),
      tornGet('user', '', 'jobpoints', 1, apiKey, { cacheTtl: 60, retries: 1 }),
    ]);
    job = jobData.job || {};
    jobranks = (ranksData.jobranks || {});
    jobpoints = ((pointsData.jobpoints || {}).jobs || {});
  } catch (e) {
    await message.reply(`Couldn't load job info: ${e.message}`);
    return;
  }

  const lines = [`**Job \u2014 ${account.tornUsername}**`];
  if (job.name) {
    lines.push(`Current job: **${job.name}**${job.position ? ` \u2014 ${job.position}` : ''}`);
  } else {
    lines.push('Current job: **Unemployed**');
  }
  lines.push('\n**Job points:**');
  for (const [k, v] of Object.entries(jobpoints)) {
    lines.push(`${titleCase(k)}: ${v}`);
  }
  lines.push('\n**Job ranks:**');
  for (const [k, v] of Object.entries(jobranks)) {
    lines.push(`${titleCase(k)}: ${v}`);
  }
  await message.reply(lines.join('\n'));
}

async function handleEvents(message) {
  const auth = await requireAuth(message);
  if (!auth) return;
  const { apiKey } = auth;

  let notifications;
  let events;
  try {
    const [notifData, eventsData] = await Promise.all([
      tornGet('user', '', 'notifications', 1, apiKey, { cacheTtl: 30, retries: 1 }),
      tornGet('user', '', 'newevents', 1, apiKey, { cacheTtl: 30, retries: 1 }),
    ]);
    notifications = notifData.notifications || {};
    events = eventsData.events || {};
  } catch (e) {
    await message.reply(`Couldn't load events: ${e.message}`);
    return;
  }

  const lines = [
    `Notifications \u2014 messages: ${notifications.messages || 0}, events: ${notifications.events || 0}, awards: ${notifications.awards || 0}`,
  ];

  const arr = Object.values(events)
    .filter((e) => e && e.event)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (!arr.length) {
    lines.push('No recent events.');
  } else {
    for (const e of arr.slice(0, 5)) {
      const ts = e.timestamp ? new Date(Number(e.timestamp) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';
      lines.push(`\u2022 ${ts} \u2014 ${stripTags(e.event)}`);
    }
  }
  await message.reply(lines.join('\n'));
}

module.exports = { handleNetworth, handleMedals, handleJob, handleEvents };
