const fs = require('fs');
const path = require('path');
const accountStore = require('./account-store');

const CONFIG_PATH = process.env.PERMISSIONS_PATH || path.join(__dirname, '..', 'permissions.json');
const OWNER_ID = process.env.OWNER_DISCORD_ID || '';

const TIER_ORDER = { public: 0, member: 1, officer: 2, co_owner: 3, owner: 4 };
const TIER_LABELS = { public: 'Public', member: 'Member', officer: 'Officer', co_owner: 'Co-Owner', owner: 'Owner' };

let config = { co_owner: '', roles: {}, users: {} };

function load() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    config = { co_owner: '', roles: {}, users: {} };
  }
}

function save() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getUserTier(guildMember, authorId) {
  if (!authorId) return 'public';
  if (OWNER_ID && authorId === OWNER_ID) return 'owner';
  if (config.co_owner && authorId === config.co_owner) return 'co_owner';
  if (config.users && config.users[authorId] && config.users[authorId] !== 'public') return config.users[authorId];
  if (guildMember) {
    for (const [roleId, tier] of Object.entries(config.roles || {})) {
      if (guildMember.roles.cache.has(roleId)) return tier;
    }
  }
  // Anyone who has linked a Torn account via !torn setup is a "member" (no
  // explicit tier assignment needed). This matches the requireAccess() hint
  // "Run !torn setup to connect your Torn account first."
  try {
    if (accountStore.getAccount(authorId)) return 'member';
  } catch (e) {}
  return 'public';
}

function hasAccess(message, authorId, requiredTier) {
  const guildMember = message?.guild?.members?.cache?.get(authorId);
  return TIER_ORDER[getUserTier(guildMember, authorId)] >= TIER_ORDER[requiredTier];
}

function requireAccess(message, authorId, requiredTier) {
  const guildMember = message?.guild?.members?.cache?.get(authorId);
  const userTier = getUserTier(guildMember, authorId);
  if (TIER_ORDER[userTier] < TIER_ORDER[requiredTier]) {
    const label = TIER_LABELS[requiredTier] || requiredTier;
    message.reply(
      `You need **${label}** tier or higher to use this command. ` +
      (requiredTier === 'member' ? 'Run `!torn setup` to connect your Torn account first.' : '')
    ).catch(() => {});
    return false;
  }
  return true;
}

function isManager(guildMember, authorId) {
  const tier = getUserTier(guildMember, authorId);
  return tier === 'owner' || tier === 'co_owner';
}

function getHighestTierInHierarchy() {
  if (config.co_owner) return 'co_owner';
  const officerUsers = Object.values(config.users || {}).filter(t => t === 'officer');
  if (officerUsers.length > 0) return 'officer';
  return 'member';
}

function promoteTier(currentTier) {
  const order = ['public', 'member', 'officer', 'co_owner'];
  const idx = order.indexOf(currentTier);
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

function demoteTier(currentTier) {
  const order = ['public', 'member', 'officer', 'co_owner'];
  const idx = order.indexOf(currentTier);
  if (idx <= 0) return null;
  return order[idx - 1];
}

// --- Promote ---
async function handlePromoteCommand(message, rest) {
  if (!isManager(message?.guild?.members?.cache?.get(message.author.id), message.author.id)) {
    await message.reply('Only the owner or co-owner can promote.');
    return;
  }

  const parts = rest.trim().split(/\s+/);
  if (!parts[0]) {
    await message.reply('**Usage:** `!promote @user` — promote one tier.');
    return;
  }

  let targetId = null;
  if (message.mentions.users.size > 0) {
    targetId = message.mentions.users.first().id;
  } else if (/^\d{17,20}$/.test(parts[0])) {
    targetId = parts[0];
  } else {
    await message.reply('Mention a user or provide a user ID.');
    return;
  }

  const guildMember = message.guild?.members?.cache?.get(message.author.id);
  const currentTier = getUserTier(message.guild?.members?.cache?.get(targetId), targetId);
  const nextTier = promoteTier(currentTier);

  if (!nextTier) {
    await message.reply('That user is already at the highest tier.');
    return;
  }

  // Can't promote above your own tier
  if (TIER_ORDER[nextTier] >= TIER_ORDER[getUserTier(guildMember, message.author.id)]) {
    await message.reply("You can't promote someone to your own tier or above.");
    return;
  }

  // Co-owner limit: only 1 allowed
  if (nextTier === 'co_owner') {
    if (config.co_owner && config.co_owner !== targetId) {
      // Demote current co-owner to officer
      const oldCoOwner = config.co_owner;
      config.users = config.users || {};
      config.users[oldCoOwner] = 'officer';
    }
    config.co_owner = targetId;
    // Remove from users dict if they were there
    if (config.users) delete config.users[targetId];
  } else {
    config.users = config.users || {};
    config.users[targetId] = nextTier;
    // If they were co_owner, clear that
    if (config.co_owner === targetId) config.co_owner = '';
  }

  save();

  const target = message.guild?.members?.cache?.get(targetId);
  const name = target ? target.displayName : targetId;
  const lines = [`✅ **${name}** promoted: ${TIER_LABELS[currentTier]} → **${TIER_LABELS[nextTier]}**`];
  if (nextTier === 'co_owner') {
    // Find who was demoted
    for (const [userId, tier] of Object.entries(config.users || {})) {
      if (tier === 'officer' && userId !== targetId) {
        const oldName = message.guild?.members?.cache?.get(userId)?.displayName || userId;
        // Only show if they were just demoted from co_owner (they're now officer)
        // Check if this is the person who was just replaced
      }
    }
  }
  await message.reply(lines.join('\n'));
}

// --- Demote ---
async function handleDemoteCommand(message, rest) {
  if (!isManager(message?.guild?.members?.cache?.get(message.author.id), message.author.id)) {
    await message.reply('Only the owner or co-owner can demote.');
    return;
  }

  const parts = rest.trim().split(/\s+/);
  if (!parts[0]) {
    await message.reply('**Usage:** `!demote @user` or `!demote @user member`');
    return;
  }

  let targetId = null;
  if (message.mentions.users.size > 0) {
    targetId = message.mentions.users.first().id;
  } else if (/^\d{17,20}$/.test(parts[0])) {
    targetId = parts[0];
  } else {
    await message.reply('Mention a user or provide a user ID.');
    return;
  }

  // Can't demote the owner
  if (targetId === OWNER_ID) {
    await message.reply("You can't demote the owner.");
    return;
  }

  const guildMember = message.guild?.members?.cache?.get(message.author.id);
  const currentTier = getUserTier(message.guild?.members?.cache?.get(targetId), targetId);

  // Can't demote someone above your own tier
  if (TIER_ORDER[currentTier] >= TIER_ORDER[getUserTier(guildMember, message.author.id)]) {
    await message.reply("You can't demote someone at your tier or above.");
    return;
  }

  let targetTier = null;
  if (parts[1]) {
    targetTier = parts[1].toLowerCase();
    if (!TIER_ORDER[targetTier] || targetTier === 'owner' || targetTier === 'co_owner') {
      await message.reply('Invalid tier. Use `member` or `officer`.');
      return;
    }
    if (TIER_ORDER[targetTier] >= TIER_ORDER[currentTier]) {
      await message.reply("Can't demote to the same or higher tier.");
      return;
    }
  } else {
    targetTier = demoteTier(currentTier);
    if (!targetTier) {
      await message.reply('That user is already at the lowest tier.');
      return;
    }
  }

  // Lowest demote is member
  if (TIER_ORDER[targetTier] < TIER_ORDER.member) {
    targetTier = 'member';
  }

  // If demoting away from co_owner
  if (config.co_owner === targetId) {
    config.co_owner = '';
  }

  config.users = config.users || {};
  config.users[targetId] = targetTier;
  save();

  const target = message.guild?.members?.cache?.get(targetId);
  const name = target ? target.displayName : targetId;
  await message.reply(`✅ **${name}** demoted: ${TIER_LABELS[currentTier]} → **${TIER_LABELS[targetTier]}**`);
}

// --- Remove (member self-remove) ---
async function handleRemoveCommand(message) {
  const guildMember = message?.guild?.members?.cache?.get(message.author.id);
  if (!requireAccess(message, message.author.id, 'member')) return;

  try {
    accountStore.removeAccount(message.author.id);
    await message.reply('✅ Your Torn account has been disconnected. You can reconnect anytime with `!torn setup`.');
  } catch (e) {
    await message.reply(`Failed to remove your account: ${e.message}`);
  }
}

// --- Permissions roster ---
async function handlePermissionsCommand(message) {
  const lines = ['**Permissions — Full Roster**\n'];

  // Owner
  let ownerName = OWNER_ID;
  if (message.guild && OWNER_ID) {
    const owner = message.guild.members.cache.get(OWNER_ID);
    if (owner) ownerName = owner.displayName;
  }
  lines.push(`**Owner:** ${ownerName}`);

  // Co-owner
  if (config.co_owner) {
    let coName = config.co_owner;
    if (message.guild) {
      const co = message.guild.members.cache.get(config.co_owner);
      if (co) coName = co.displayName;
    }
    lines.push(`**Co-Owner:** ${coName}`);
  } else {
    lines.push('**Co-Owner:** _(none)_');
  }

  // Get all connected accounts
  let accounts = [];
  try { accounts = accountStore.getAllAccounts(); } catch (e) {}

  // Build sets for each tier
  const officerUserIds = new Set();
  for (const [userId, tier] of Object.entries(config.users || {})) {
    if (tier === 'officer') officerUserIds.add(userId);
  }
  for (const [roleId, tier] of Object.entries(config.roles || {})) {
    if (tier === 'officer' && message.guild) {
      const role = message.guild.roles.cache.get(roleId);
      if (role) role.members.forEach(m => officerUserIds.add(m.id));
    }
  }

  // Officers
  const officers = accounts.filter(a => officerUserIds.has(a.discord_user_id));
  const officerRoleNames = [];
  for (const [roleId, tier] of Object.entries(config.roles || {})) {
    if (tier === 'officer') {
      let name = roleId;
      if (message.guild) {
        const role = message.guild.roles.cache.get(roleId);
        if (role) name = role.name;
      }
      officerRoleNames.push(name);
    }
  }

  if (officerRoleNames.length > 0) {
    lines.push(`\n**Officers (roles):** ${officerRoleNames.map(n => '`@' + n + '`').join(', ')}`);
  }

  lines.push(`**Officers (connected):** ${officers.length || 'none'}`);
  for (const acct of officers) {
    let name = acct.discord_user_id;
    if (message.guild) {
      const member = message.guild.members.cache.get(acct.discord_user_id);
      if (member) name = member.displayName;
    }
    lines.push(`• **${name}** — ${acct.torn_username || '?'}`);
  }

  // Members
  const members = accounts.filter(a =>
    !officerUserIds.has(a.discord_user_id) && a.discord_user_id !== config.co_owner
  );
  lines.push('');
  lines.push(`**Members:** ${members.length || 'none'}`);
  for (const acct of members) {
    let name = acct.discord_user_id;
    if (message.guild) {
      const member = message.guild.members.cache.get(acct.discord_user_id);
      if (member) name = member.displayName;
    }
    lines.push(`• **${name}** — ${acct.torn_username || '?'}`);
  }

  lines.push('');
  lines.push('Only **owner/co-owner** can assign tiers (`!promote`/`!demote`).');
  await message.reply(lines.join('\n'));
}

// --- Tier command (owner only, direct assignment) ---
async function handleTierCommand(message, rest) {
  const parts = rest.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    await message.reply(
      '**Usage:**\n`!tier @user` — show tier\n`!tier @user <tier>` — assign tier\n`!tier @role <tier>` — assign role\n' +
      'Tiers: `member`, `officer`\n(Use `!promote`/`!demote` for quick tier changes)'
    );
    return;
  }

  const first = parts[0];
  const tierArg = (parts[1] || '').toLowerCase();
  const hasTierArg = tierArg && TIER_ORDER[tierArg] && tierArg !== 'owner' && tierArg !== 'co_owner';

  // !tier @role <tier>
  if (first.startsWith('<@&')) {
    let roleId = first.replace(/^<@&|>$/g, '');
    if (message.guild) {
      const role = message.guild.roles.cache.get(roleId);
      if (!role) { await message.reply("I couldn't find that role."); return; }
      roleId = role.id;
    }
    if (!hasTierArg) {
      const currentTier = config.roles?.[roleId] || 'public';
      let roleName = roleId;
      if (message.guild) { const role = message.guild.roles.cache.get(roleId); if (role) roleName = role.name; }
      await message.reply(`\`@${roleName}\` — **${TIER_LABELS[currentTier]}** tier.`);
      return;
    }
    if (!config.roles) config.roles = {};
    config.roles[roleId] = tierArg;
    save();
    let roleName = roleId;
    if (message.guild) { const role = message.guild.roles.cache.get(roleId); if (role) roleName = role.name; }
    await message.reply(`✅ \`@${roleName}\` is now **${TIER_LABELS[tierArg]}** tier.`);
    return;
  }

  // !tier @user [tier]
  let targetId = null;
  if (message.mentions.users.size > 0) {
    targetId = message.mentions.users.first().id;
  } else if (/^\d{17,20}$/.test(first)) {
    targetId = first;
  } else {
    await message.reply('Mention a user or role, or provide an ID.');
    return;
  }

  // Check if it's a role
  if (message.guild) {
    const role = message.guild.roles.cache.get(targetId);
    if (role) {
      if (!hasTierArg) {
        const currentTier = config.roles?.[targetId] || 'public';
        await message.reply(`\`@${role.name}\` — **${TIER_LABELS[currentTier]}** tier.`);
        return;
      }
      if (!config.roles) config.roles = {};
      config.roles[targetId] = tierArg;
      save();
      await message.reply(`✅ \`@${role.name}\` is now **${TIER_LABELS[tierArg]}** tier.`);
      return;
    }
  }

  // User
  if (hasTierArg) {
    if (!config.users) config.users = {};
    config.users[targetId] = tierArg;
    if (tierArg === 'co_owner') {
      // Handle co-owner assignment
      if (config.co_owner && config.co_owner !== targetId) {
        config.users[config.co_owner] = 'officer';
      }
      config.co_owner = targetId;
      delete config.users[targetId];
    }
    if (config.co_owner === targetId && tierArg !== 'co_owner') {
      config.co_owner = '';
    }
    save();
    const target = message.guild?.members?.cache?.get(targetId);
    const name = target ? target.displayName : targetId;
    await message.reply(`✅ **${name}** is now **${TIER_LABELS[tierArg]}** tier.`);
    return;
  }

  // Show tier
  const guildMember = message.guild?.members?.cache?.get(targetId);
  const userTier = getUserTier(guildMember, targetId);
  const target = message.guild?.members?.cache?.get(targetId);
  const name = target ? target.displayName : targetId;
  const roleNames = target
    ? target.roles.cache.filter(r => r.id !== message.guild?.id).map(r => r.name).join(', ') || 'None'
    : 'Unknown';
  await message.reply(`**${name}** (${targetId})\nTier: **${TIER_LABELS[userTier]}**\nRoles: ${roleNames}`);
}

load();

module.exports = {
  getUserTier, hasAccess, requireAccess, isManager,
  handlePermissionsCommand, handleTierCommand, handlePromoteCommand, handleDemoteCommand, handleRemoveCommand,
  load, save, TIER_ORDER, TIER_LABELS, config
};
