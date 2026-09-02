const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');
const fs = require('fs');

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

async function getHonorDefs(apiKey) {
  const d = await tornGet('torn', '', 'honors', 2, apiKey, { cacheTtl: 86400, retries: 1 });
  const honors = [];
  for (const v of Object.values(d.honors || {})) {
    if (v && typeof v === 'object' && v.id) honors.push(v);
  }
  return honors;
}

async function getEarnedSet(apiKey) {
  try {
    const d = await tornGet('user', '', 'honors', 1, apiKey, { cacheTtl: 60, retries: 1 });
    return new Set((d.honors_awarded || []).map(String));
  } catch (e) {
    return new Set();
  }
}

async function getMeritAllocations(apiKey) {
  try {
    const d = await tornGet('user', '', 'merits', 1, apiKey, { cacheTtl: 300, retries: 1 });
    return d.merits || {};
  } catch (e) {
    return {};
  }
}

const line = (h, mark) => `${mark} **${h.name}** \u2014 ${h.description || ''}${h.rarity ? ` _(${h.rarity})_` : ''}`;

const WATCH_FILE = '/opt/discord-bot/merits-watch.json';
const WATCH_INTERVAL = 5 * 60 * 1000;

let client = null;
let watchSubs = {}; // uid -> { earned: [ids], msg: {channelId, messageId} }

function loadWatch() {
  try { if (fs.existsSync(WATCH_FILE)) watchSubs = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')); } catch (e) { watchSubs = {}; }
}
function saveWatch() {
  try { fs.writeFileSync(WATCH_FILE, JSON.stringify(watchSubs)); } catch (e) {}
}

function watchBody(username, current, byId, newIds) {
  const lines = [`\u{1F3C5} **Merits watch \u2014 ${username}**`];
  lines.push(`Earned **${current.length}** honor${current.length === 1 ? '' : 's'} \u2014 updates automatically.`);
  if (newIds && newIds.length) {
    lines.push('');
    lines.push(`\u{1F389} **Newly earned:**`);
    for (const id of newIds) {
      const h = byId[id];
      lines.push(h ? `\u{1F389} **${h.name}** \u2014 ${h.description || ''}${h.rarity ? ` _(${h.rarity})_` : ''}` : `\u{1F389} #${id}`);
    }
  }
  if (current.length) {
    lines.push('');
    lines.push('**Earned:**');
    let kept = 0;
    for (const id of current) {
      const h = byId[id];
      const ln = h ? `\u2705 ${h.name}` : `\u2705 #${id}`;
      lines.push(ln);
      kept++;
      if (lines.join('\n').length > 1700) {
        lines.pop();
        lines.push(`\u2026and ${current.length - kept + 1} more (run \`!merits earned\`)`);
        break;
      }
    }
  }
  return lines.join('\n');
}

function startMeritsMonitor(c) {
  client = c;
  loadWatch();
  console.log(`[merits] watch monitor enabled (${Object.keys(watchSubs).length} subscriber(s))`);
  setInterval(pollWatch, WATCH_INTERVAL);
}

async function pollWatch() {
  if (!client) return;
  const uids = Object.keys(watchSubs);
  if (!uids.length) return;

  let honorDefs = null;
  for (const uid of uids) {
    const account = accountStore.getAccount(uid);
    const apiKey = account ? accountStore.getApiKey(uid) : null;
    if (!apiKey) continue;

    let d;
    try {
      d = await tornGet('user', '', 'honors', 1, apiKey, { cacheTtl: 0, retries: 1, skipCache: true });
    } catch (e) { continue; }
    const current = (d.honors_awarded || []).map(String);
    const entry = watchSubs[uid] || {};
    const prev = Array.isArray(entry.earned) ? entry.earned : [];
    const prevSet = new Set(prev);
    const newIds = current.filter((id) => !prevSet.has(id));
    const changed = newIds.length > 0 || current.length !== prev.length;

    if (!changed && entry.msg) continue;

    if (!honorDefs) {
      try { honorDefs = await getHonorDefs(apiKey); } catch (e) { honorDefs = []; }
    }
    const byId = {};
    for (const h of honorDefs) byId[String(h.id)] = h;

    const body = watchBody(account.tornUsername, current, byId, newIds);
    try {
      const user = await client.users.fetch(uid);
      if (!user) continue;
      if (entry.msg) {
        let ok = false;
        try {
          const ch = await client.channels.fetch(entry.msg.channelId);
          const m = await ch.messages.fetch(entry.msg.messageId);
          await m.edit(body);
          ok = true;
        } catch (e) { entry.msg = null; }
        if (ok) {
          entry.earned = current;
          saveWatch();
          continue;
        }
      }
      const dm = await user.send(body);
      entry.msg = { channelId: dm.channelId, messageId: dm.id };
      if (newIds.length) {
        const nl = newIds.map((id) => byId[id] ? `\u{1F3C5} **${byId[id].name}** \u2014 ${byId[id].description || ''}` : `\u{1F3C5} #${id}`);
        await user.send(`\u{1F389} **New merit earned!**\n${nl.join('\n')}`);
      }
      entry.earned = current;
      saveWatch();
    } catch (e) {
      console.error(`[merits] watch DM failed for ${uid}:`, e.message);
    }
  }
}

async function handleMerits(message, args) {
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

  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'watch' || cmd === 'on') {
    loadWatch();
    const cur = await getEarnedSet(apiKey);
    watchSubs[userId] = { earned: Array.from(cur), msg: (watchSubs[userId] && watchSubs[userId].msg) || null };
    saveWatch();
    // send the initial pinned DM now
    try {
      const honors = await getHonorDefs(apiKey);
      const byId = {};
      for (const h of honors) byId[String(h.id)] = h;
      const dm = await message.author.send(watchBody(account.tornUsername, Array.from(cur), byId, []));
      watchSubs[userId].msg = { channelId: dm.channelId, messageId: dm.id };
      saveWatch();
      await message.reply('\u{1F4CC} **Merit watch ON** \u2014 I DMed you a live list that updates automatically as you earn honors. Pin it! `!merits unwatch` to stop.');
    } catch (e) {
      await message.reply('Merit watch is ON, but I couldn\'t DM you \u2014 open your DMs and run `!merits watch` again.');
    }
    return;
  }
  if (cmd === 'unwatch' || cmd === 'off') {
    loadWatch();
    if (watchSubs[userId]) { delete watchSubs[userId]; saveWatch(); }
    await message.reply('Merit watch is OFF.');
    return;
  }
  if (cmd === 'status') {
    loadWatch();
    const sub = watchSubs[userId];
    if (sub) await message.reply(`Merit watch is **ON** \u2014 tracking ${(sub.earned || []).length} earned honor(s). Your pinned DM updates automatically.`);
    else await message.reply('Merit watch is OFF. Use `!merits watch` to start.');
    return;
  }

  const reply = await message.reply('Fetching merits\u2026');

  let honors;
  try {
    honors = await getHonorDefs(apiKey);
  } catch (e) {
    await reply.edit(`Couldn't load honor list: ${e.message}`);
    return;
  }
  const earned = await getEarnedSet(apiKey);
  const earnedArr = honors.filter((h) => earned.has(String(h.id)));
  const unearned = honors.filter((h) => !earned.has(String(h.id)));

  if (cmd === 'earned') {
    if (!earnedArr.length) {
      await reply.edit(`No honors earned yet for ${account.tornUsername}.`);
      return;
    }
    const lines = [`\u{1F3C5} **${account.tornUsername} \u2014 ${earnedArr.length} honors earned**`];
    const byType = {};
    for (const h of earnedArr) {
      const t = h.type && h.type.title ? h.type.title : 'General';
      (byType[t] = byType[t] || []).push(h);
    }
    for (const t of Object.keys(byType).sort()) {
      lines.push(`\n**${t}**`);
      for (const h of byType[t]) lines.push(line(h, '\u2705'));
    }
    await reply.edit(lines.join('\n'));
    return;
  }

  if (cmd === 'list') {
    const byType = {};
    for (const h of honors) {
      const t = h.type && h.type.title ? h.type.title : 'General';
      (byType[t] = byType[t] || []).push(h);
    }
    const lines = [`\u{1F3C5} **All honors** \u2014 ${earnedArr.length}/${honors.length} earned`];
    for (const t of Object.keys(byType).sort()) {
      lines.push(`\n**${t}** (${byType[t].filter((h) => earned.has(String(h.id))).length}/${byType[t].length})`);
      for (const h of byType[t]) lines.push(line(h, earned.has(String(h.id)) ? '\u2705' : '\u2B1C'));
    }
    await reply.edit(lines.join('\n'));
    return;
  }

  // default + 'next': available merit points + spend priority + next easiest to earn
  const allocations = await getMeritAllocations(apiKey);
  const spent = Object.values(allocations).reduce((a, b) => a + (Number(b) || 0), 0);
  const available = Math.max(0, earned.size - spent);
  const n = Math.min(Math.max(parseInt(args[1], 10) || 5, 1), 20);

  const sorted = unearned.slice().sort((a, b) => {
    const ra = rarityRank(a.rarity);
    const rb = rarityRank(b.rarity);
    if (ra !== rb) return ra - rb;
    return (b.circulation || 0) - (a.circulation || 0);
  });

  const lines = [];
  lines.push(`\u{1F3C5} **Merits \u2014 ${account.tornUsername}**`);
  lines.push(`Available merit points: **${available}** (earned ${earned.size}, spent ${spent})`);
  const alloc = Object.entries(allocations).filter(([, v]) => Number(v) > 0);
  if (alloc.length) lines.push(`Allocated: ${alloc.map(([k, v]) => `${k} ${v}`).join(' \u00B7 ')}`);
  lines.push('**Spend priority:** Education Length (1\u201310) \u2192 Bank Interest (1\u201310)');
  lines.push('');
  lines.push(`**Next easiest honors to earn:**`);
  if (!sorted.length) {
    lines.push('\u{1F389} You\'ve earned every honor!');
  } else {
    sorted.slice(0, n).forEach((h, i) => lines.push(`${i + 1}. ${line(h, '\u2B1C')}`));
    if (sorted.length > n) lines.push(`...and ${sorted.length - n} more.`);
  }
  lines.push('\n`!merits next <n>` \u00B7 `!merits earned` \u00B7 `!merits list`');
  await reply.edit(lines.join('\n'));
}

module.exports = { handleMerits, startMeritsMonitor };
