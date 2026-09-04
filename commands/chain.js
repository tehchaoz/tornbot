'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

const DRUG_SPREAD_S = 8 * 60 * 60;             // spacing between doses once the first is known
const FINAL_BUFFER_S = 8 * 60 * 60;            // last dose should land no later than 8h before chain start
const MAX_DOSES = 4;
const CHECK_INTERVAL_MS = 30 * 1000;

let db;

function init(dbPath) {
  if (db) return;
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chain_schedule (
      chain_id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_ts INTEGER NOT NULL,
      scheduled_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      cancelled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chain_joiners (
      chain_id INTEGER NOT NULL,
      discord_user_id TEXT NOT NULL,
      torn_username TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      xanax_plan TEXT,
      PRIMARY KEY (chain_id, discord_user_id)
    );
    CREATE TABLE IF NOT EXISTS chain_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id INTEGER NOT NULL,
      discord_user_id TEXT NOT NULL,
      dose INTEGER NOT NULL,
      due_ts INTEGER NOT NULL,
      fired INTEGER DEFAULT 0,
      fired_at INTEGER,
      message TEXT
    );
  `);
}

// ---- Parsing helpers ----

// Accepts "09/04/26 1900", "09/04/26 19:00", "2026-09-04 1900", or a bare "1900"
// (meaning the next occurrence of that time today). Date is interpreted in
// Torn City Time (UTC). Returns ms timestamp or null.
function parseChainDate(input) {
  const s = String(input || '').trim();
  if (!s) return null;

  // Bare time: "1900" or "19:00" → next occurrence of that time.
  const bareTime = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (bareTime) {
    const hours = parseInt(bareTime[1], 10);
    const minutes = parseInt(bareTime[2], 10);
    if (!/^([01]?\d|2[0-3])$/.test(String(hours))) return null;
    if (!/^[0-5]?\d$/.test(String(minutes))) return null;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0, 0);
    return today <= Date.now() ? today + 24 * 60 * 60 * 1000 : today;
  }

  const match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](?:20)?(\d{2}))?(?:\s+)?(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  let year = match[3] ? parseInt(match[3], 10) : null;
  const hours = parseInt(match[4], 10);
  const minutes = match[5] ? parseInt(match[5], 10) : 0;

  if (year === null) {
    // No year given: default to the current year (or next if already passed this year).
    year = new Date().getUTCFullYear();
  } else if (year < 100) {
    year += 2000;
  }

  if (!/^([01]?\d|2[0-3])$/.test(String(hours))) return null;
  if (!/^[0-5]?\d$/.test(String(minutes))) return null;

  const when = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);

  // If no year was given and this timestamp is already in the past, roll to next year.
  if ((!match[3] || match[3].length === 2) && when < Date.now()) {
    return Date.UTC(year + 1, month - 1, day, hours, minutes, 0, 0);
  }
  return when;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

function fmtDateTime(tsMs) {
  return new Date(tsMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// ---- Xanax scheduling ----

// Build the 4-dose plan for one user given their current drug cooldown (seconds).
// If cooldown is 0/absent, doses run from (chainStart - FINAL_BUFFER_S - 3*DRUG_SPREAD_S)
// back every 8h, ending FINAL_BUFFER_S before chain start.
// If the API reports a live cooldown, dose 1 starts at (now + cooldown) and the
// remaining doses follow every 8h. Doses that would land after chain start drop out.
function buildXanaxPlan(targetMs, nowMs, drugCooldownS) {
  const plan = [];
  const effectiveStart = targetMs - FINAL_BUFFER_S * 1000;
  const cooldown = Number(drugCooldownS) > 0 ? Number(drugCooldownS) : 0;

  if (cooldown > 0) {
    const firstDue = nowMs + cooldown * 1000;
    for (let i = 0; i < MAX_DOSES; i++) {
      const due = firstDue + i * DRUG_SPREAD_S * 1000;
      if (due > targetMs) break;
      plan.push({ dose: i + 1, when: due });
    }
  } else {
    // Fallback: even 8h spread finishing 8h before the chain.
    for (let i = 0; i < MAX_DOSES; i++) {
      const due = effectiveStart - (MAX_DOSES - 1 - i) * DRUG_SPREAD_S * 1000;
      if (due < nowMs) continue; // too late to fit — skip missed doses
      plan.push({ dose: plan.length + 1, when: due });
    }
  }
  return plan;
}

// ---- Command handlers ----

function createChainCommands(ctx) {
  const {
    client,
    channelId = process.env.CHAIN_CHANNEL_ID || '',
    dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'tornbot.db'),
    factionId = process.env.FACTION_ID || '',
    ownerKey = process.env.TORN_API_KEY || '',
  } = ctx || {};

  init(dbPath);

  function latestFutureChain() {
    return db.prepare(
      'SELECT * FROM chain_schedule WHERE cancelled = 0 AND target_ts > ? ORDER BY target_ts ASC LIMIT 1'
    ).get(Date.now());
  }

  async function getMemberCooldown(discordUserId) {
    const apiKey = accountStore.getApiKey(discordUserId);
    if (!apiKey) return { ok: false };
    try {
      const data = await tornGet('user', '', 'cooldowns', 1, apiKey, { cacheTtl: 15, retries: 1 });
      const cd = (data && data.cooldowns) || {};
      return { ok: true, drug: Number(cd.drug) > 0 ? Number(cd.drug) : 0 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function getChannel() {
    if (!channelId) return null;
    try {
      return await client.channels.fetch(channelId);
    } catch (e) {
      return null;
    }
  }

  async function announce(text) {
    const channel = await getChannel();
    if (channel && channel.send) {
      await channel.send(text).catch(() => {});
      return true;
    }
    return false;
  }

  // Transient status replies auto-delete after 5 minutes to keep the channel clean.
  const MARKER_DELETE_MS = 5 * 60 * 1000;
  async function markMessageForDeletion(msg) {
    if (!msg) return;
    setTimeout(() => msg.delete().catch(() => {}), MARKER_DELETE_MS);
  }

  // Create reminders for a joiner, storing rows in chain_reminders.
  async function scheduleJoinerReminders(chain, account, nowMs) {
    const cooldown = await getMemberCooldown(account.discordUserId);
    const plan = buildXanaxPlan(chain.target_ts, nowMs, cooldown.ok ? cooldown.drug : 0);

    const xanaxPlanJson = JSON.stringify(plan);
    db.prepare(
      `INSERT INTO chain_joiners (chain_id, discord_user_id, torn_username, joined_at, xanax_plan)
       VALUES (?, ?, ?, ?, ?)`
    ).run(chain.chain_id, account.discordUserId, account.tornUsername, nowMs, xanaxPlanJson);

    // Remove any stale reminders for this user/chain, then insert the fresh plan.
    db.prepare('DELETE FROM chain_reminders WHERE chain_id = ? AND discord_user_id = ?').run(chain.chain_id, account.discordUserId);
    const ins = db.prepare(
      `INSERT INTO chain_reminders (chain_id, discord_user_id, dose, due_ts, fired, message) VALUES (?, ?, ?, ?, 0, ?)`
    );
    for (const dose of plan) {
      ins.run(chain.chain_id, account.discordUserId, dose.dose, dose.when, `\uD83D\uDC8A <@${account.discordUserId}> take **Xanax #${dose.dose}/4** now.`);
    }

    return { plan, cooldown };
  }

  async function handleChain(message, arg) {
    // !chain schedule
    const targetMs = parseChainDate(arg);
    if (!targetMs) {
      await message.reply(
        'Usage: `!chain <date> <time>` (Torn City Time / UTC)\n' +
        'Examples:\n`!chain 09/04/26 1900`\n`!chain 09/04 1900`\n`!chain 1900` (next time today)\n' +
        'Then members run `!chain join`, officers run `!chain list`.'
      );
      return;
    }

    const nowMs = Date.now();
    const ins = db.prepare(
      `INSERT INTO chain_schedule (target_ts, scheduled_by, created_at, channel_id, cancelled) VALUES (?, ?, ?, ?, 0)`
    );
    const info = ins.run(targetMs, message.author.id, nowMs, channelId || message.channel.id);

    const when = fmtDateTime(targetMs);
    const remaining = fmtDuration(targetMs - nowMs);
    const confirm = await message.reply(
      `\uD83D\uDD14 Chain scheduled!\n\n` +
      `**Start:** ${when}\n**In:** ${remaining}\n\n` +
      `Members: run \`!chain join\` to sign up for Xanax reminders.\n` +
      `Officers: \`!chain list\` to see who's in.`
    );
    markMessageForDeletion(confirm);
    await announce(`\uD83D\uDD14 New chain scheduled by <@${message.author.id}>:\n**${when}** (${remaining} from now)\n\nReply \`!chain join\` to sign up.`);
  }

  async function handleJoin(message) {
    const chain = latestFutureChain();
    if (!chain) {
      markMessageForDeletion(await message.reply('There is no chain scheduled right now. An officer sets one with `!chain <date> <time>`.'));
      return;
    }

    const account = accountStore.getAccount(message.author.id);
    if (!account) {
      markMessageForDeletion(await message.reply('You need to connect your Torn account first.\nRun `!torn setup` to get started.'));
      return;
    }

    const nowMs = Date.now();
    const existing = db.prepare('SELECT * FROM chain_joiners WHERE chain_id = ? AND discord_user_id = ?').get(chain.chain_id, message.author.id);
    if (existing) {
      markMessageForDeletion(await message.reply(`You're already signed up for the ${fmtDateTime(chain.target_ts)} chain. Use \`!chain list\` to check your plan.`));
      return;
    }

    markMessageForDeletion(await message.reply(`Signing you up for the ${fmtDateTime(chain.target_ts)} chain...`));

    const { plan, cooldown } = await scheduleJoinerReminders(chain, account, nowMs);

    const lines = [];
    lines.push(`\uD83D\uDC8A **${account.tornUsername}** — Xanax plan for the ${fmtDateTime(chain.target_ts)} chain:`);
    lines.push('');
    if (cooldown.ok && cooldown.drug > 0) {
      lines.push(`(Current drug cooldown: ${fmtDuration(cooldown.drug * 1000)})`);
    }
    if (plan.length === 0) {
      lines.push('No doses fit before the chain starts — you may already be prepped.');
    } else {
      for (const dose of plan) {
        lines.push(`\u2022 \u274C Take **Xanax #${dose.dose}/4** — ${fmtDateTime(dose.when)} (in ${fmtDuration(dose.when - nowMs)})`);
      }
    }
    lines.push(``);
    lines.push(`You'll be @mentioned here shortly before each dose.`);
    markMessageForDeletion(await message.reply(lines.join('\n')));
  }

  async function handleList(message) {
    const chain = latestFutureChain();
    if (!chain) {
      markMessageForDeletion(await message.reply('No chain scheduled right now.'));
      return;
    }

    const joiners = db.prepare('SELECT * FROM chain_joiners WHERE chain_id = ? ORDER BY joined_at ASC').all(chain.chain_id);

    const lines = [];
    lines.push(`\uD83D\uDCCB **Chain Signups** — ${fmtDateTime(chain.target_ts)}`);
    lines.push(`Start in: ${fmtDuration(chain.target_ts - Date.now())}`);
    lines.push('');
    if (joiners.length === 0) {
      lines.push('Nobody signed up yet.');
    } else {
      for (const j of joiners) {
        let plan = [];
        try { plan = JSON.parse(j.xanax_plan || '[]'); } catch (e) {}
        const dueParts = plan.map((d) => `#${d.dose}@${fmtDuration(d.when - Date.now())}left`).join(' ');
        lines.push(`\u2022 <@${j.discord_user_id}> — ${j.torn_username}${dueParts ? ` (${dueParts})` : ''}`);
      }
    }
    lines.push(``);
    lines.push(`Total: ${joiners.length} signed up.`);
    markMessageForDeletion(await message.reply(lines.join('\n')));
  }

  async function handleLeave(message) {
    const chain = latestFutureChain();
    if (!chain) {
      markMessageForDeletion(await message.reply('No chain scheduled right now.'));
      return;
    }

    const removed = db.prepare('DELETE FROM chain_joiners WHERE chain_id = ? AND discord_user_id = ?').run(chain.chain_id, message.author.id);
    db.prepare('DELETE FROM chain_reminders WHERE chain_id = ? AND discord_user_id = ?').run(chain.chain_id, message.author.id);
    if (removed.changes > 0) {
      markMessageForDeletion(await message.reply(`You've left the chain. No more Xanax reminders for you.`));
    } else {
      markMessageForDeletion(await message.reply(`You weren't signed up.`));
    }
  }

  async function handleCancel(message) {
    const chain = latestFutureChain();
    if (!chain) {
      markMessageForDeletion(await message.reply('No chain scheduled right now.'));
      return;
    }
    db.prepare('UPDATE chain_schedule SET cancelled = 1 WHERE chain_id = ?').run(chain.chain_id);
    db.prepare('DELETE FROM chain_reminders WHERE chain_id = ?').run(chain.chain_id);
    markMessageForDeletion(await message.reply(`\uD83D\uDEAB Chain for ${fmtDateTime(chain.target_ts)} cancelled. All signups cleared.`));
    await announce(`\uD83D\uDEAB Chain for ${fmtDateTime(chain.target_ts)} cancelled by <@${message.author.id}>.`);
  }

  // ---- Background reminder firing ----

  const announcedStartChains = new Set();

  async function fireDueReminders(nowMs) {
    const due = db.prepare(
      'SELECT r.*, c.channel_id, c.target_ts FROM chain_reminders r JOIN chain_schedule c ON c.chain_id = r.chain_id WHERE r.fired = 0 AND r.due_ts <= ?'
    ).all(nowMs);

    for (const row of due) {
      let posted = false;
      if (row.channel_id) {
        try {
          const ch = await client.channels.fetch(row.channel_id);
          if (ch && ch.send) { await ch.send(row.message); posted = true; }
        } catch (e) {}
      }
      if (!posted && channelId) {
        try {
          const ch = await client.channels.fetch(channelId);
          if (ch && ch.send) { await ch.send(row.message); posted = true; }
        } catch (e) {}
      }
      db.prepare('UPDATE chain_reminders SET fired = 1, fired_at = ? WHERE id = ?').run(Math.floor(nowMs / 1000), row.id);
    }

    // Alert ~10 minutes before a scheduled chain start, once.
    const upcoming = db.prepare(
      'SELECT * FROM chain_schedule WHERE cancelled = 0 AND target_ts - ? <= 600000 AND target_ts > ?'
    ).all(nowMs, nowMs);
    for (const chain of upcoming) {
      if (announcedStartChains.has(chain.chain_id)) continue;
      announcedStartChains.add(chain.chain_id);
      const text = `\u26A0\uFE0F **Chain starting in ~10 minutes!** ${fmtDateTime(chain.target_ts)}. If you signed up, this is your final Xanax window.`;
      if (chain.channel_id) {
        try {
          const ch = await client.channels.fetch(chain.channel_id);
          if (ch && ch.send) await ch.send(text);
        } catch (e) {}
      }
    }
  }

  function start() {
    if (!db) return;
    const tick = async () => {
      try { await fireDueReminders(Date.now()); } catch (e) {}
    };
    tick();
    setInterval(tick, CHECK_INTERVAL_MS);
  }

  return {
    handleChain,
    handleJoin,
    handleList,
    handleLeave,
    handleCancel,
    start,
    _parseChainDate: parseChainDate,
    _buildXanaxPlan: buildXanaxPlan,
  };
}

module.exports = { createChainCommands };