const fs = require('fs');
const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

const HJ_FILE = '/opt/discord-bot/happyjump.json';
const TARGET_ENERGY = 1000;          // 4x Xanax (250 each)
const TARGET_BOOSTER_CD = 24 * 3600; // candy stacked to full 24h booster cooldown
const POLL_MS = 60000;
const RENUDGE_MS = 30 * 60 * 1000;

let client = null;
let hjSubs = {}; // uid -> { lastPhase, lastDmAt, armed }

function fmtTime(s) {
  const v = Math.max(0, Math.round(Number(s) || 0));
  if (v <= 0) return 'Ready';
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function loadSubs() {
  try {
    if (fs.existsSync(HJ_FILE)) hjSubs = JSON.parse(fs.readFileSync(HJ_FILE, 'utf8'));
  } catch (e) {
    hjSubs = {};
  }
}

function saveSubs() {
  try { fs.writeFileSync(HJ_FILE, JSON.stringify(hjSubs)); } catch (e) {}
}

// Returns an actionable phase (or 'waiting'). Only actionable phases get a DM.
function hjPhase(bars, cd) {
  const energy = (bars && bars.energy) ? bars.energy.current : 0;
  const dcd = (cd && cd.drug != null) ? cd.drug : 0;
  const bcd = (cd && cd.booster != null) ? cd.booster : 0;
  const energyReady = energy >= TARGET_ENERGY;
  const candyDone = bcd >= TARGET_BOOSTER_CD;

  if (energyReady && candyDone) {
    return { phase: 'ecstasy', text: `\u{1F9E0} **Happy Jump: take Ecstasy now, then train** \u2014 gym \u2192 pick ONE stat \u2192 type 999 \u2192 Train. Energy ${energy}.` };
  }
  if (energyReady) {
    return { phase: 'candy', text: `\u{1F36C} **Happy Jump: stack candy** \u2014 energy is full (${energy}). Eat candy until booster cooldown = 24h (candy resets :00/:15/:30/:45; take at :01/:16/:31/:46).` };
  }
  if (dcd <= 0) {
    return { phase: 'xanax', text: `\u{1F48A} **Happy Jump: take Xanax now** (energy ${energy}/${TARGET_ENERGY}). Repeat on each drug cooldown.` };
  }
  return { phase: 'waiting', text: null };
}

async function pollHappyJumps() {
  const uids = Object.keys(hjSubs);
  for (const uid of uids) {
    const entry = hjSubs[uid];
    if (!entry || entry.armed === false) continue;
    if (!client) return;
    const account = accountStore.getAccount(uid);
    const apiKey = account ? accountStore.getApiKey(uid) : null;
    if (!apiKey) continue;

    let d;
    try {
      d = await tornGet('user', '', 'bars,cooldowns', 1, apiKey);
    } catch (e) { continue; }
    const bars = { energy: d.energy || {}, happy: d.happy || {} };
    const p = hjPhase(bars, d.cooldowns || {});

    if (p.phase === 'waiting') {
      if (entry.lastPhase !== 'waiting') {
        entry.lastPhase = 'waiting';
        saveSubs();
      }
      continue;
    }

    const now = Date.now();
    const changed = entry.lastPhase !== p.phase;
    const stale = entry.lastPhase === p.phase && (now - (entry.lastDmAt || 0)) > RENUDGE_MS;
    if (!changed && !stale) continue;

    try {
      const user = await client.users.fetch(uid);
      if (user) await user.send(p.text);
      entry.lastPhase = p.phase;
      entry.lastDmAt = now;
      if (p.phase === 'ecstasy') {
        entry.armed = false; // jump complete — disarm until next !hj on
      }
      saveSubs();
    } catch (e) {
      console.error(`[happyjump] DM failed for ${uid}:`, e.message);
    }
  }
}

function startHappyJumpMonitor(c) {
  client = c;
  loadSubs();
  const active = Object.keys(hjSubs).filter((u) => hjSubs[u] && hjSubs[u].armed !== false).length;
  console.log(`[happyjump] monitor enabled (${active} active subscriber(s))`);
  setInterval(pollHappyJumps, POLL_MS);
}

function nextStep(bars, cd) {
  const p = hjPhase(bars, cd);
  const energy = (bars && bars.energy) ? bars.energy.current : 0;
  if (p.phase === 'waiting') {
    const dcd = (cd && cd.drug != null) ? cd.drug : 0;
    return `\u23F3 Wait ${fmtTime(dcd)} for drug cooldown, then take Xanax (energy ${energy}/${TARGET_ENERGY}).`;
  }
  return p.text;
}

async function handleHappyJump(message, args) {
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

  if (cmd === 'on') {
    loadSubs();
    hjSubs[userId] = { lastPhase: null, lastDmAt: 0, armed: true };
    saveSubs();
    await message.reply('\u{1F4EC} **Happy Jump reminders: ON** \u2014 I\u2019ll DM you at each step (Xanax ready, candy, then Ecstasy+train). I\u2019ll stop after the final step \u2014 run `!hj on` again for your next jump. `!hj off` to cancel.');
    return;
  }
  if (cmd === 'off') {
    loadSubs();
    if (hjSubs[userId]) { delete hjSubs[userId]; saveSubs(); }
    await message.reply('Happy Jump reminders are OFF.');
    return;
  }
  if (cmd === 'status') {
    loadSubs();
    const sub = hjSubs[userId];
    if (!sub || sub.armed === false) {
      await message.reply('Happy Jump reminders are **not armed**. Use `!hj on` to start.');
      return;
    }
    const phase = sub.lastPhase ? sub.lastPhase : 'starting';
    await message.reply(`Happy Jump reminders are **ON** \u2014 current phase: \`${phase}\`.`);
    return;
  }
  if (cmd === 'guide' || cmd === 'help') {
    await message.reply(
      '**Happy Jump \u2014 step by step**\n' +
      '1. Train all energy to **0**.\n' +
      '2. **Xanax** \u2192 wait drug cooldown \u2192 repeat 4x (to ~1000 energy).\n' +
      '3. Eat **candy** until booster cooldown = 24h (candy resets :00/:15/:30/:45; take at :01/:16/:31/:46).\n' +
      '4. Take **Ecstasy**.\n' +
      '5. Gym \u2192 pick ONE stat \u2192 type 999 \u2192 Train.\n\n' +
      '`!hj` = current status \u00B7 `!hj on` = DM me each step \u00B7 `!hj off` = stop.'
    );
    return;
  }

  const reply = await message.reply('Reading bars\u2026');
  try {
    const d = await tornGet('user', '', 'bars,cooldowns', 1, apiKey);
    const bars = {
      energy: d.energy || { current: 0, maximum: 0 },
      happy: d.happy || { current: 0, maximum: 0 },
    };
    const cd = d.cooldowns || {};
    const lines = [];
    lines.push(`\u{1F36C} **Happy Jump \u2014 ${account.tornUsername}**`);
    lines.push(`Energy: **${bars.energy.current}/${TARGET_ENERGY}** (need ${Math.max(0, TARGET_ENERGY - bars.energy.current)})`);
    if (bars.happy.maximum) lines.push(`Happy: **${bars.happy.current}/${bars.happy.maximum}** (${Math.round(bars.happy.current / bars.happy.maximum * 100)}%)`);
    const cds = [];
    if (cd.drug != null) cds.push(`drug ${fmtTime(cd.drug)}`);
    if (cd.booster != null) cds.push(`booster ${fmtTime(cd.booster)} (24h = candy done)`);
    if (cds.length) lines.push(`Cooldowns \u2014 ${cds.join('  \u2022  ')}`);
    lines.push('');
    lines.push(nextStep(bars, cd));
    lines.push('`!hj guide` steps \u00B7 `!hj on` to get DMed each step.');
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Torn error: ${e.message}`);
  }
}

module.exports = { handleHappyJump, startHappyJumpMonitor };
