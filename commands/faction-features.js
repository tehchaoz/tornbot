const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');

// Factory so bot.js can inject the discord client + runtime config without circular requires.
function createFactionFeatures(ctx) {
  const {
    client,
    factionId = process.env.FACTION_ID || '',
    ownerKey = process.env.TORN_API_KEY || '',
    vaultKey = process.env.FACTION_VAULT_KEY || '',
    channelIds = {},
    links = {},
    getLinks = () => links,
  } = ctx || {};

  const channels = {
    retaliation: channelIds.retaliation || channelIds.war || '',
    oc: channelIds.oc || channelIds.faction || '',
    bank: channelIds.bank || channelIds.faction || '',
    verify: channelIds.verify || channelIds.faction || '',
  };

  // DrFruit's Torn identity is the reliable source of the full-faction key.
  const FULL_KEY_IDENTIFIERS = ['drfruit', 'dr fruit', 'd.r.fruit'];

  function resolveFullKey() {
    try {
      const accounts = accountStore.getAllAccounts();
      const match = accounts.find((a) => {
        const n = (a.torn_username || '').toLowerCase().replace(/\s+/g, ' ');
        return FULL_KEY_IDENTIFIERS.some((id) => n === id || n.startsWith(id));
      });
      if (match) {
        const key = accountStore.getApiKey(match.discord_user_id);
        if (key) return key;
      }
    } catch (e) { /* fall through */ }
    return ownerKey;
  }

  async function factionGet(selections, version) {
    const key = resolveFullKey();
    return tornGet('faction', factionId, Object.prototype.toString.call(selections) === '[object Array]' ? selections.join(',') : selections, version, key, { cacheTtl: 30, retries: 1 });
  }

  async function sendTo(channelKey, text) {
    const id = channels[channelKey];
    if (!id) return false;
    try {
      const channel = await client.channels.fetch(id);
      if (channel && channel.send) { await channel.send(text); return true; }
    } catch (e) {}
    return false;
  }

  // ---- Verification ----

  async function handleVerify(message, arg) {
    const uid = message.author.id;
    const tornIds = [links[uid]];

    let factionMember = null;
    let detail = null;
    try {
      const f = await factionGet('basic');
      factionMember = f && f.members ? f.members : null;
    } catch (e) {
      await message.reply(`Couldn't reach the Torn faction API: ${e.message}`);
      return;
    }

    let id = tornIds[0];
    if (arg && /^\d+$/.test(arg.trim())) id = arg.trim();

    if (!id) {
      await message.reply('No Torn ID found for your linked account. Run `!link <your Torn player ID>` first, then `!verify`.');
      return;
    }

    const member = factionMember && factionMember[id];
    if (member) {
      detail = `${member.name} (Lv${member.level}) \u00B7 ${member.status && member.status.state ? member.status.state : ''} \u00B7 last seen ${member.last_action ? member.last_action.relative : '?'}`;
      await message.reply(`\u2714 Verified as a member of the faction.\n**${detail}**`);
    } else {
      await message.reply(`\u274C Torn player **#${id}** is not in faction **${factionId}**. Verification incomplete.`);
    }
  }

  // ---- Banking ----

  async function handleBank(message, arg) {
    const args = (arg || '').trim().split(/\s+/);
    const cmd = (args[0] || '').toLowerCase();

    if (cmd === 'balance') {
      try {
        const d = await factionGet('balance', 2);
        const faction = d && d.balance && d.balance.faction;
        const money = faction ? faction.money : null;
        const points = faction ? faction.points : 0;
        if (money == null) {
          await message.reply('Vault balance unavailable \u2014 couldn\'t read the faction balance.');
          return;
        }
        await message.reply(`\u{1F4B0} **Faction vault**: \$${fmtMoney(money)}${points ? ` \u00B7 ${points} points` : ''}`);
      } catch (e) {
        await message.reply(`Bank error: ${e.message}`);
      }
      return;
    }

    if (cmd === 'req' || cmd === 'request') {
      const amount = parseInt((args[1] || '').replace(/[^\d]/g, ''), 10);
      const reason = args.slice(2).join(' ') || 'no reason given';
      if (!amount || amount <= 0) {
        await message.reply('Usage: `!bank req <amount> [reason]`');
        return;
      }
      await sendTo('bank', `\u{1F4B0} **Vault request** from <@${message.author.id}>\nAmount: **\$${fmtMoney(amount)}**\nReason: ${reason}`);
      await message.reply(`Vault request posted (\$${fmtMoney(amount)}). A faction banker can fulfill it.`);
      return;
    }

    await message.reply('**!bank**\n`!bank balance` — current faction vault\n`!bank req <amount> [reason]` — request money from the vault');
  }

  // ---- Retaliation monitor ----

  let retalInit = false;
  let seenAttacks = new Set();

  async function pollRetaliation() {
    try {
      const d = await factionGet('attacks');
      const list = d.attacks ? Object.values(d.attacks) : [];
      const memberNames = {};
      try {
        const f = await factionGet('basic');
        if (f.members) { for (const [id, m] of Object.entries(f.members)) memberNames[id] = m.name; }
      } catch (e) {}

      const now = Math.floor(Date.now() / 1000);
      for (const a of list) {
        if (!a || a.code == null) continue;
        if (seenAttacks.has(a.code)) continue;
        seenAttacks.add(a.code);
        if (seenAttacks.size > 500) seenAttacks.clear();

        const attackerId = String(a.attacker_id || '');
        const defenderId = String(a.defender_id || '');
        const defenderInFaction = !!memberNames[defenderId];
        const attackerInFaction = !!memberNames[attackerId];
        const isHospitalize = a.result === 'Hospitalized';
        const isAttackingUs = defenderInFaction && !attackerInFaction;

        // Only surface recent attacks (last 10 min) and faction-member losses
        const recent = a.timestamp_ended && now - a.timestamp_ended < 600;
        if (!isAttackingUs || !recent) continue;

        const attName = a.attacker_name || attackerId || 'Unknown';
        const defName = a.defender_name || memberNames[defenderId] || defenderId || 'Unknown';
        const lines = [
          `\u26A0\uFE0F **Member attacked${isHospitalize ? ' (Hospitalized)' : ''}**`,
          `\uD83D\uDC51 ${defName} was attacked by **${attName}**${attackerId ? ` [${attackerId}]` : ''}`,
        ];
        if (attackerId) lines.push(`\uD83C\uDFAF Retaliate: https://www.torn.com/page.php?sid=attack&user2ID=${attackerId}`);
        lines.push(`\u23F3 ${timeAgo(a.timestamp_ended)}`);
        await sendTo('retaliation', lines.join('\n'));
      }
    } catch (e) { /* transient */ }
  }

  function startRetaliationMonitor() {
    if (!factionId || !channels.retaliation) {
      console.log('[faction-features] retaliation monitor disabled (missing faction or target channel)');
      return;
    }
    console.log(`[faction-features] retaliation monitor enabled (faction ${factionId})`);
    pollRetaliation();
    setInterval(pollRetaliation, 60000);
  }

  // ---- OC notifications ----

  let ocInit = false;
  let ocState = {};

  async function pollOC() {
    try {
      const d = await factionGet('crimes');
      const crimes = d.crimes && Array.isArray(d.crimes) ? d.crimes : [];
      const now = Math.floor(Date.now() / 1000);
      for (const c of crimes) {
        const id = String(c.id != null ? c.id : c.crime_id || c.time_started || '');
        const target = c.time_ready || c.time_ready_time || null;
        const name = c.crime_name || c.name || 'OC';
        const prev = ocState[id];
        const ready = target && now >= target;
        if (!prev) {
          ocState[id] = { readyed: ready };
          if (ready) {
            await sendTo('oc', `\u2705 **OC ready** — ${name} (${id}). Go time.`);
          }
          continue;
        }
        if (!prev.readyed && ready) {
          prev.readyed = true;
          await sendTo('oc', `\u2705 **OC ready** — ${name} (${id}).`);
        }
      }
    } catch (e) { /* transient */ }
  }

  function startOCMonitor() {
    if (!factionId || !channels.oc) {
      console.log('[faction-features] OC monitor disabled (missing faction or target channel)');
      return;
    }
    console.log(`[faction-features] OC monitor enabled (faction ${factionId})`);
    pollOC();
    setInterval(pollOC, 30000);
  }

  // ---- Notifications hook ----

  async function handleNotify(message, arg) {
    const target = (arg || '').trim().toLowerCase();
    if (!target) {
      await message.reply('**!notify** — faction alert routing.\n`!notify status` — show active monitors.');
      return;
    }
    if (target === 'status') {
      const lines = [
        '**Faction feature monitors**',
        `Retaliation: ${channels.retaliation ? 'ON (channel ' + channels.retaliation + ')' : 'OFF'}`,
        `OC notifications: ${channels.oc ? 'ON (channel ' + channels.oc + ')' : 'OFF'}`,
        `Bank requests: ${channels.bank ? 'ON (channel ' + channels.bank + ')' : 'OFF'}`,
      ];
      await message.reply(lines.join('\n'));
      return;
    }
    await message.reply('Usage: `!notify status`');
  }

  function timeAgo(ts) {
    const s = Number(ts) || 0;
    if (!s) return '';
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - s);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function fmtMoney(n) {
    const num = Number(n) || 0;
    if (num >= 1e9) return (num / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(num);
  }

  return {
    handleVerify,
    handleBank,
    handleNotify,
    startRetaliationMonitor,
    startOCMonitor,
    resolveFullKey,
    channels,
  };
}

module.exports = { createFactionFeatures };
