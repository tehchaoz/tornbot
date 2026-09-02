const fs = require('fs');
const path = require('path');

const ROSTER_FILE = process.env.MEMBER_TIMEZONES_FILE || path.join(__dirname, '..', 'member-timezones.json');

let roster = { byTorn: {}, byDiscord: {} };
let lastError = null;

const TZ_TOKEN = /UT[CS]?\s*[±+\-−]?\s*\d{1,2}(?::\d{2})?|\b(?:GMT|ECT|EET|EEST|CET|CEST|WET|WEST|EST|EDT|AST|ADT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|JST|AEST|AEDT|ACST|ACDT|AWST|IST|SGT)\b/ig;

function detectTimezone(text) {
  const m = String(text || '').match(TZ_TOKEN);
  if (!m) return null;
  return Array.from(new Set(m.map((s) => s.replace(/\s+/g, '').toUpperCase()))).join('/');
}

function parseRosterMessage(content) {
  const out = [];
  const lines = String(content || '').split(/\r?\n/);
  for (const raw of lines) {
    let line = raw.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (/^NOTE:|if a name/i.test(line) || line.includes('<@')) continue;

    const tz = detectTimezone(line);
    if (!tz) continue;

    let discord = null;
    let torn = null;
    const firstComma = line.indexOf(',');
    const colon = line.indexOf(':');
    // Only treat ':' as a discord:name separator if it precedes the first comma
    // (avoids splitting inside times like "UTC -8:00").
    if (colon > 0 && (firstComma === -1 || colon < firstComma)) {
      discord = line.slice(0, colon).trim();
      torn = line.slice(colon + 1).split(',')[0].trim();
      // Handle "Name. Location" where a location is glued after a period.
      const dot = torn.indexOf('.');
      if (dot > 0 && /\.\s*[A-Z]/.test(torn)) torn = torn.slice(0, dot).trim();
    } else {
      torn = firstComma === -1 ? line : line.slice(0, firstComma);
      torn = torn.trim();
      discord = torn;
    }

    torn = torn.replace(/[`_]/g, '').trim();
    discord = (discord || torn).replace(/[`_]/g, '').trim();
    if (!torn) continue;

    const entry = {
      discord: discord.toLowerCase(),
      torn: torn.toLowerCase(),
      tz,
    };
    if (entry.torn) out.push(entry);
  }
  return out;
}

function applyEntries(entries) {
  for (const e of entries) {
    if (e.torn) roster.byTorn[e.torn] = e;
    if (e.discord) roster.byDiscord[e.discord] = e;
  }
}

function loadFromFile() {
  try {
    if (fs.existsSync(ROSTER_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
      roster.byTorn = data.byTorn || {};
      roster.byDiscord = data.byDiscord || {};
    }
  } catch (e) {
    lastError = e.message;
  }
}

function saveToFile() {
  try {
    fs.writeFileSync(ROSTER_FILE, JSON.stringify({ byTorn: roster.byTorn, byDiscord: roster.byDiscord }));
  } catch (e) {
    lastError = e.message;
  }
}

async function refresh(client) {
  const channelId = process.env.MEMBER_INTRO_CHANNEL_ID;
  if (!channelId) {
    lastError = null;
    return { synced: false, reason: 'no channel configured' };
  }
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) {
      lastError = 'configured channel is not a text channel';
      return { synced: false, reason: lastError };
    }
    const messages = await ch.messages.fetch({ limit: 100 });
    const entries = [];
    for (const m of messages.values()) {
      entries.push(...parseRosterMessage(m.content));
    }
    roster.byTorn = {};
    roster.byDiscord = {};
    applyEntries(entries);
    saveToFile();
    lastError = null;
    return { synced: true, count: entries.length };
  } catch (e) {
    lastError = e.message;
    return { synced: false, reason: e.message };
  }
}

function timezoneForTornName(tornName) {
  const e = roster.byTorn[String(tornName || '').trim().toLowerCase()];
  return e ? (e.tz || null) : null;
}

function timezoneForDiscord(discordName) {
  const e = roster.byDiscord[String(discordName || '').trim().toLowerCase()];
  return e ? (e.tz || null) : null;
}

function getLastError() {
  return lastError;
}

loadFromFile();

module.exports = {
  refresh,
  parseRosterMessage,
  timezoneForTornName,
  timezoneForDiscord,
  getLastError,
};
