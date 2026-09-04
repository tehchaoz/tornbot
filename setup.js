#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Tornbot interactive setup wizard.
 *
 * Run with:  node setup.js   (or:  npm run setup)
 *
 * Walks a first-time user through creating a Discord bot, getting a Torn API key,
 * and auto-writing a ready-to-run .env file. No prior experience needed.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const EXAMPLE_PATH = path.join(ROOT, '.env.example');

const BANNER = `
========================================================
   TORNBOT - one-time setup wizard
========================================================
This will take about 5 minutes. It walks you through:
   1. Creating a free Discord bot
   2. Generating a Torn City API key
   3. Connecting your faction
   4. Writing your .env file (your keys stay on YOUR PC)

You need a Torn City account. You do NOT need any coding
experience.
========================================================
`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function askYesNo(q) {
  const a = (await ask(`${q} (y/n) `)).trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

function hr() {
  console.log('\n--------------------------------------------------------');
}

function logStep(n, title) {
  hr();
  console.log(`\n  STEP ${n}: ${title}\n`);
}

function printHeader(lines) {
  console.log('\n' + '  ' + lines.split('\n').join('\n  ') + '\n');
}

// --- Platform detection -------------------------------------------------
function detectPlatform() {
  const p = process.platform;
  if (p === 'win32') return { name: 'Windows', open: 'start', isWin: true };
  if (p === 'darwin') return { name: 'macOS', open: 'open', isWin: false };
  return { name: 'Linux', open: 'xdg-open', isWin: false };
}

function openUrl(url) {
  const { open } = detectPlatform();
  try {
    execSync(`${open} "${url}"`, { stdio: 'ignore' });
  } catch (e) {
    console.log(`   (Could not auto-open your browser. Open this link manually:\n   ${url}\n)`);
  }
}

// --- Tiny HTTP helper (no external deps) -------------------------------
function httpJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Bad JSON from ${url}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// --- Input helpers ------------------------------------------------------
function formatHint(s) { return s ? ` (${s})` : ''; }

async function askNonEmpty(prompt, hint) {
  for (;;) {
    const v = (await ask(`   > ${prompt}${formatHint(hint)} `)).trim();
    if (v) return v;
    console.log('   Please enter something.');
  }
}

function looksLikeToken(t) {
  // Discord tokens are base64.base64.timestamp segments.
  const parts = t.split('.');
  return parts.length === 3 && parts[0].length > 10 && parts[2].length > 5;
}

function looksLikeTornKey(k) {
  // Torn API keys are 16-char alphanumeric.
  return typeof k === 'string' && /^[A-Za-z0-9]{16}$/.test(k.trim());
}

// --- Torn API validation -----------------------------------------------
async function validateTornKey(key) {
  try {
    const me = await httpJson(`https://api.torn.com/user/?selections=default&key=${key}`);
    if (me.error) {
      return { ok: false, msg: `Torn said: ${me.error.error}` };
    }
    return { ok: true, player: me.name, id: me.player_id };
  } catch (e) {
    return { ok: true, msg: `(could not verify online — continuing; your computer may be offline)` };
  }
}

// --- Discord bot creation instructions ----------------------------------
async function guideCreateBot(platform) {
  printHeader(
    'First, create your Discord bot.\n' +
    'Your browser is about to open the Discord Developer Portal.'
  );
  console.log('   When it opens:\n' +
    '     1. Click the blue  "New Application"  button (top right)\n' +
    '     2. Give it any name (e.g. "My Torn Bot") and click Create\n' +
    '     3. On the left menu click  "Bot"\n' +
    '     4. Find  "Token"  and click  "Reset Token", then  "Yes, do it!"\n' +
    '     5. Click the blue  "Copy"  button next to the token\n' +
    '     6. Paste it in the terminal below\n' +
    '\n   IMPORTANT: never share your token with anyone, and never\n' +
    '   upload the .env file that this wizard will create.');
  const portal = 'https://discord.com/developers/applications';
  await ask(`   Press Enter to open the Developer Portal in your browser...`);
  try { openUrl(portal); } catch (e) { console.log(`   Open this: ${portal}`); }
}

async function getDiscordToken() {
  console.log();
  const t = (await askNonEmpty('Paste your Discord bot token', 'starts with e.g. MTA4...')).trim();
  if (!looksLikeToken(t)) {
    console.log('   That token doesn\'t look right (it should be three parts separated by dots).');
    console.log('   Double-check you clicked "Copy" on the token, then paste it again.');
  }
  return t;
}

async function guideEnableIntents() {
  // These two privileged intents are required for the bot to work.
  console.log('\n   In the same "Bot" page, scroll to "Privileged Gateway Intents":\n' +
    '     MESSAGE CONTENT INTENT   - turn ON  (so the bot can read your !commands and DM replies)\n' +
    '     SERVER MEMBERS INTENT     - turn ON  (so it can greet new members joining)\n' +
    '     PRESENCE INTENT         - leave OFF (not used)\n' +
    '   Then click  "Save Changes".');
  await ask('   Press Enter when they\'re turned on');
}

// --- Torn API key instructions ------------------------------------------
async function guideCreateTornKey() {
  printHeader(
    'Next, create your Torn City API key.\n' +
    'You will grant the bot access to read your Torn account.'
  );
  console.log('   Log into torn.com and go to:\n' +
    '     Preferences -> API (top menu)\n' +
    '   Then:\n' +
    '     1. Click  "Create New Key"\n' +
    '     2. Leave  "Full Access"  selected (this unlocks the most features)\n' +
    '     3. Check the box to agree to the API terms\n' +
    '     4. Click  "Create"\n' +
    '     5. Copy the key (16 characters, e.g. abc123def456ghi7) and paste it below');
  const url = 'https://www.torn.com/preferences.php#tab=api';
  try { openUrl(url); } catch (e) {}
}

async function getTornKey() {
  console.log();
  const k = (await askNonEmpty('Paste your Torn API key', '16 characters, e.g. abc123...')).trim();
  if (!looksLikeTornKey(k)) {
    console.log('   That key doesn\'t look right (should be exactly 16 letters/numbers).');
    console.log('   If it has extra spaces, paste it again.');
  }
  return k;
}

// --- Faction ------------------------------------------------------------
async function getFactionInfo() {
  console.log('\n   Your faction is the group your Torn character belongs to.\n' +
    '   Find it: go to your profile on torn.com -> "Faction" -> copy the ID\n' +
    '   from the URL (torn.com/factions.php?ID=NDDD) \u2014 just the number.');
  return (await askNonEmpty('Your faction ID', 'a number like 12345')).trim();
}

function setEnv(base, key, value, comment) {
  let block = comment ? `\n${comment}\n` : '\n';
  block += `${key}=${value}\n`;
  base.push(block);
}

async function writeEnv(values) {
  const encryptionKey = crypto.randomBytes(32).toString('hex'); // 64 chars

  const lines = [];
  const push = (comment, kv) => {
    if (comment) lines.push(comment);
    lines.push(kv);
  };

  lines.push('# ============================================================');
  lines.push('# Tornbot configuration (generated by setup.js)');
  lines.push('# THIS FILE CONTAINS YOUR SECRET KEYS. Do not share or upload.');
  lines.push('# ============================================================');

  push('\n# --- Required ---');
  push('', `DISCORD_TOKEN=${values.token}`);
  push('', `TORN_API_KEY=${values.tornKey}`);

  if (values.factionId) {
    push('', `FACTION_ID=${values.factionId}`);
  }

  push('\n# Owner Discord ID (enables owner/co-owner commands). Your user ID can be', '# OWNER_DISCORD_ID=');
  push('\n# Strong random encryption key for stored member data (auto-generated)', `TORN_ENCRYPTION_KEY=${encryptionKey}`);

  lines.push('');
  lines.push('# Optional — add your Discord channel IDs here after the bot is running to');
  lines.push('# enable the price board, alerts, and welcome messages. Leave blank to start.');
  lines.push('BOARD_CHANNEL_IDS=');
  lines.push('CHAIN_CHANNEL_ID=');
  lines.push('WELCOME_CHANNEL_ID=');

  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
  return encryptionKey;
}

async function runCommand(cmd, { reportFailure = false } = {}) {
  return new Promise((resolve) => {
    try {
      const out = execSync(cmd, { stdio: reportFailure ? 'inherit' : 'pipe', cwd: ROOT });
      resolve(out ? out.toString().trim() : '');
    } catch (e) {
      if (reportFailure) {
        console.error('\n   That command failed. See the error above.');
      }
      resolve('');
    }
  });
}

// --- Main ---------------------------------------------------------------
async function main() {
  console.log(BANNER);
  const platform = detectPlatform();

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await askYesNo('A .env file already exists. Re-run setup and replace it? (This won\'t affect a running bot until restart.)');
    if (!overwrite) { console.log('\nOK, no changes made. Your existing setup stays as is.\n'); rl.close(); return; }
  }

  // STEP 1: Node check
  logStep(1, 'Check Node.js');
  console.log(`   Platform detected: ${platform.name}`);
  try {
    execSync('node --version', { stdio: 'pipe' });
    console.log('   Node.js .................. ok');
  } catch (e) {
    console.log('\n   !! Node.js is NOT installed yet.\n');
    if (platform.isWin) {
      console.log('   Install it from https://nodejs.org (download the "LTS" version,\n' +
        '   run the installer, keep all defaults, then close and reopen this terminal).');
      try { openUrl('https://nodejs.org'); } catch (_) {}
    } else if (platform.name === 'macOS') {
      console.log('   Install from https://nodejs.org (LTS), then reopen this terminal.');
      try { openUrl('https://nodejs.org'); } catch (_) {}
    } else {
      console.log('   Run:  sudo apt update && sudo apt install -y nodejs npm\n' +
        '   then reopen this terminal and run:  node setup.js');
    }
    await ask('   Press Enter after you\'ve installed Node.js');
  }
  try {
    const v = execSync('node --version').toString().trim();
    console.log(`   Running ${v}`);
  } catch (e) {}

  // STEP 2: Discord bot
  logStep(2, 'Create your Discord bot');
  await guideCreateBot(platform);
  let token = await getDiscordToken();
  // allow re-paste
  const redo = await askYesNo('   Is that token correct?');
  if (!redo) token = await getDiscordToken();
  await guideEnableIntents();

  // STEP 3: Torn API key
  logStep(3, 'Get your Torn API key');
  await guideCreateTornKey();
  let tornKey = await getTornKey();
  const v = await validateTornKey(tornKey);
  if (v.ok && v.player) {
    console.log(`   Verified: connected as "${v.player}" (ID ${v.id}).`);
  } else if (v.msg) {
    console.log(`   ${v.msg}`);
  }

  // STEP 4: Faction
  logStep(4, 'Connect your faction (optional)');
  const wantFaction = await askYesNo('Do you want to enable faction features (chains, wars, bank, roster)?');
  const factionId = wantFaction ? await getFactionInfo() : '';

  // STEP 5: Write .env + install
  logStep(5, 'Write config and install dependencies');
  const encryptionKey = await writeEnv({ token, tornKey, factionId });
  console.log('   .env written with a fresh random encryption key.');
  console.log('   Installing dependencies (this downloads a few packages)...\n');
  await runCommand('npm install', { reportFailure: true });

  // Invite link — need client ID (token first segment is base64 of the client ID).
  // INVITE_PERMS = View Channels + Send Messages + Send Messages in Threads + Embed Links
  // + Manage Messages + Read Message History + Attach Files + Use External Emojis
  // + Connect + Speak (voice), enough for every built-in command without granting Admin.
  let invite = '';
  const INVITE_PERMS = 1098247168;
  try {
    const b64 = token.split('.')[0];
    // Discord IDs are 17-20 digit snowflakes. Decode the base64, then extract the
    // first run of 17-20 digits that starts with 1-7 (ignoring trailing pad artifacts).
    const decoded = Buffer.from(b64, 'base64').toString('utf8').replace(/[^\d]/g, '');
    let clientId = '';
    for (const m of decoded.matchAll(/\d{17,20}/g)) {
      const cand = m[0];
      if (/^[1-7]/.test(cand)) { clientId = cand; break; }
    }
    if (clientId) {
      invite = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMS}&scope=bot`;
    }
  } catch (e) {}

  // STEP 6: Next steps
  logStep(6, 'You\'re all set!');
  console.log('   Your bot is configured.\n');

  if (invite) {
    console.log('   >>  Add the bot to your Discord server:\n');
    console.log(`       ${invite}\n`);
    const openInvite = await askYesNo('   Open that invite link in your browser now?');
    if (openInvite) { try { openUrl(invite); } catch (_) {} }
  } else {
    console.log('   To add the bot to your server, open the Developer Portal, go to your\n' +
      '   app -> OAuth2 -> URL Generator, tick "bot" and the "Send Messages",\n' +
      '   "Read Message History", "Embed Links", "Manage Messages" permissions,\n' +
      '   then open the generated URL and pick your server.');
    try { openUrl('https://discord.com/developers/applications'); } catch (_) {}
  }

  console.log('\n   When it\'s in your server, start the bot with:\n       npm start\n');
  console.log('   (Run  npm start  every time you want the bot on.)\n');

  const startNow = await askYesNo('   Start the bot now?');
  rl.close();
  if (startNow) {
    console.log('\n   Starting the bot... (it will run in this window; close the window to stop it)\n');
    await runCommand('npm start'); // will keep running until closed
  } else {
    console.log('\n   Run  npm start  whenever you\'re ready. See you in faction! 🍺\n');
  }
}

main().catch((e) => {
  console.error('\nSetup error:', e.message);
  process.exit(1);
});
