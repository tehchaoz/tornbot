const { EmbedBuilder } = require('discord.js');
const { tornGet } = require('../services/torn-api');
const accountStore = require('../services/account-store');
const { analyzeState, generateRecommendations, formatCoachResponse } = require('../services/recommendation');

async function handleCoach(message) {
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

  await message.reply('Analyzing your current state...');

  try {
    const [profileData, barsData, statsData] = await Promise.all([
      tornGet('user', '', 'profile,battlestats,money', 1, apiKey, { cacheTtl: 30 }),
      tornGet('user', '', 'bars,cooldowns', 1, apiKey, { cacheTtl: 15 }),
      tornGet('user', '', 'battlestats', 1, apiKey, { cacheTtl: 30 }),
    ]);

    const profile = profileData.profile || profileData;
    const bars = barsData.bars || barsData;
    const battlestats = statsData.battlestats || {};

    const state = analyzeState(profile, bars, battlestats);
    const recs = generateRecommendations(state);
    const response = formatCoachResponse(state, recs);

    await message.reply(response);
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleBars(message) {
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

  try {
    const data = await tornGet('user', '', 'bars,cooldowns', 1, apiKey, { cacheTtl: 15 });
    const bars = data.bars || {};
    const cooldowns = data.cooldowns || {};

    const lines = [];
    lines.push(`**${account.tornUsername}** — Current State`);
    lines.push('');
    lines.push(`Energy: ${bars.energy?.current || 0}/${bars.energy?.maximum || 100}`);
    lines.push(`Nerve: ${bars.nerve?.current || 0}/${bars.nerve?.maximum || 15}`);
    lines.push(`Happy: ${bars.happy?.current || 0}/${bars.happy?.maximum || 100}`);
    lines.push(`Life: ${bars.life?.current || 0}/${bars.life?.maximum || 150}`);

    if (cooldowns) {
      lines.push('');
      if (cooldowns.drug) lines.push(`Drug: ${cooldowns.drug}`);
      if (cooldowns.medical) lines.push(`Medical: ${cooldowns.medical}`);
      if (cooldowns.booster) lines.push(`Booster: ${cooldowns.booster}`);
      if (cooldowns.candy) lines.push(`Candy: ${cooldowns.candy}`);
    }

    const energy = bars.energy?.current || 0;
    const nerve = bars.nerve?.current || 0;
    const life = bars.life?.current || 0;
    const lifeMax = bars.life?.maximum || 150;

    lines.push('');
    lines.push('**RECOMMENDATIONS:**');

    if (life < lifeMax * 0.5) {
      lines.push('❤️ Heal before combat.');
    }
    if (nerve > 0) {
      lines.push('🥷 Use available nerve for crimes.');
    }
    if (energy > 0) {
      lines.push('🏋️ Train when energy is available.');
    }
    lines.push('🎓 Keep education running.');

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleGain(message) {
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

  try {
    const data = await tornGet('user', '', 'bars,cooldowns,battlestats', 1, apiKey, { cacheTtl: 30 });
    const bars = data.bars || {};
    const cooldowns = data.cooldowns || {};
    const stats = data.battlestats || {};

    const lines = [];
    lines.push(`**${account.tornUsername}** — Training & Gains`);
    lines.push('');
    lines.push(`Energy: ${bars.energy?.current || 0}/${bars.energy?.maximum || 100}`);
    lines.push(`Happy: ${bars.happy?.current || 0}/${bars.happy?.maximum || 100}`);
    lines.push('');
    lines.push('**Battle Stats:**');
    lines.push(`Strength: ${(stats.strength || 0).toLocaleString()}`);
    lines.push(`Defense: ${(stats.defense || 0).toLocaleString()}`);
    lines.push(`Speed: ${(stats.speed || 0).toLocaleString()}`);
    lines.push(`Dexterity: ${(stats.dexterity || 0).toLocaleString()}`);

    const total = (stats.strength || 0) + (stats.defense || 0) + (stats.speed || 0) + (stats.dexterity || 0);
    lines.push(`Total: ${total.toLocaleString()}`);

    lines.push('');
    lines.push('**WHY TRAIN?**');
    lines.push('Training builds stats that determine combat success.');
    lines.push('Higher stats = ability to defeat higher-level targets = more XP.');
    lines.push('Current goal: reach Level 15 for travel income.');

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleLevelPacer(message) {
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

  try {
    const data = await tornGet('user', '', 'profile,battlestats,bars', 1, apiKey, { cacheTtl: 30 });
    const profile = data.profile || data;
    const stats = data.battlestats || {};
    const bars = data.bars || {};

    const level = profile.level || 0;
    const energy = bars.energy?.current || 0;
    const total = (stats.strength || 0) + (stats.defense || 0) + (stats.speed || 0) + (stats.dexterity || 0);

    const lines = [];
    lines.push(`**${account.tornUsername}** — Level Pacer`);
    lines.push('');
    lines.push(`Level: ${level} / 15`);
    lines.push(`Energy: ${energy}`);
    lines.push(`Total Stats: ${total.toLocaleString()}`);
    lines.push('');

    if (level >= 15) {
      lines.push('**STATUS:** You\'ve reached Level 15!');
      lines.push('Focus on travel income: plushies/flowers → Museum → Points.');
    } else {
      lines.push('**STRATEGY:** Attack-and-leave');
      lines.push('');
      lines.push('1. Find targets on oran.pw/baldrstargets');
      lines.push('2. Attack until target is defeated');
      lines.push('3. LEAVE (do not mug or hospitalize)');
      lines.push('4. Repeat with next target');
      lines.push('');
      lines.push(`Progress: ${level} / 15`);
      lines.push(`${15 - level} levels to go`);

      if (energy > 0) {
        lines.push('');
        lines.push('You have energy available — consider training before attacking.');
      }
    }

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleCrimeRoute(message) {
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

  try {
    const data = await tornGet('user', '', 'profile,battlestats,bars', 1, apiKey, { cacheTtl: 30 });
    const profile = data.profile || data;
    const bars = data.bars || {};
    const nerve = bars.nerve?.current || 0;

    const lines = [];
    lines.push(`**${account.tornUsername}** — Crime Assistant`);
    lines.push('');
    lines.push(`Nerve: ${nerve}`);
    lines.push('');
    lines.push('**RECOMMENDED CRIMES:**');

    if (nerve >= 4) {
      lines.push('• Search for Cash (2 nerve) — reliable progression');
      lines.push('• Shoplifting (4 nerve) — good for skill building');
    }
    if (nerve >= 2) {
      lines.push('• Bootlegging (1+ nerve) — consistent with low nerve');
      lines.push('• Search for Cash (2 nerve)');
    }
    if (nerve > 0) {
      lines.push('• Steal Jacket (~4 nerve)');
    }

    lines.push('');
    lines.push('**GOAL:** Build toward 60 Natural Nerve Bar.');
    lines.push('Choose reliable crimes over high-payout ones.');

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleJobApply(message) {
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

  try {
    const data = await tornGet('user', '', 'profile,bars', 1, apiKey, { cacheTtl: 30 });
    const profile = data.profile || data;

    const lines = [];
    lines.push(`**${account.tornUsername}** — Job Info`);
    lines.push('');
    lines.push(`Level: ${profile.level || '?'}`);
    lines.push(`Job: ${profile.job?.title || 'Unemployed'}`);
    lines.push(`Job Points: ${profile.job?.jobpoints || 0}`);

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleEducation(message) {
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

  try {
    const data = await tornGet('user', '', 'education', 1, apiKey, { cacheTtl: 300 });
    const education = data.education || {};

    const lines = [];
    lines.push(`**${account.tornUsername}** — Education`);
    lines.push('');

    if (education.current) {
      lines.push(`**Current Course:** ${education.current.name || 'Unknown'}`);
      lines.push(`**Time Remaining:** ${education.current.time_left || 'Unknown'}`);
    } else {
      lines.push('**No course active!**');
      lines.push('Start a course immediately — never let the education slot sit empty.');
    }

    if (education.completed && education.completed.length > 0) {
      lines.push('');
      lines.push('**Completed:**');
      for (const course of education.completed.slice(-5)) {
        lines.push(`• ${course.name || 'Unknown'}`);
      }
    }

    lines.push('');
    lines.push('**RECOMMENDATION:**');
    lines.push('1. Education Length (increases course speed)');
    lines.push('2. Bank Interest (passive income)');
    lines.push('3. Sports Science (gym gains)');

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleMerits(message) {
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

  try {
    const data = await tornGet('user', '', 'merits', 1, apiKey, { cacheTtl: 300 });
    const merits = data.merits || {};

    const lines = [];
    lines.push(`**${account.tornUsername}** — Merits`);
    lines.push('');
    lines.push(`**Available Merits:** ${merits.available || 0}`);
    lines.push('');

    if (merits.merits) {
      lines.push('**Current Allocation:**');
      for (const [key, value] of Object.entries(merits.merits)) {
        lines.push(`• ${key}: ${value}`);
      }
    }

    lines.push('');
    lines.push('**PRIORITY:**');
    lines.push('1. Education Length (1-10) — faster courses');
    lines.push('2. Bank Interest (1-10) — passive income');

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleMoney(message) {
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

  try {
    const data = await tornGet('user', '', 'profile,money', 1, apiKey, { cacheTtl: 30 });
    const profile = data.profile || data;

    const lines = [];
    lines.push(`**${account.tornUsername}** — Money`);
    lines.push('');
    lines.push(`Cash: $${(profile.money_onhand || 0).toLocaleString()}`);
    lines.push(`Bank: $${(profile.bank || 0).toLocaleString()}`);
    lines.push(`Points: ${(profile.points || 0).toLocaleString()}`);
    lines.push('');
    lines.push('**GUIDE:**');
    lines.push('• Cash: spending money, travel capital');
    lines.push('• Bank: long-term savings');
    lines.push('• Points: tradeable at market');

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

async function handleTravel(message) {
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

  try {
    const data = await tornGet('user', '', 'profile,bars,travel', 1, apiKey, { cacheTtl: 30 });
    const profile = data.profile || data;

    const lines = [];
    lines.push(`**${account.tornUsername}** — Travel`);
    lines.push('');
    lines.push(`Level: ${profile.level || '?'}`);

    if ((profile.level || 0) < 15) {
      lines.push('');
      lines.push('**STATUS:** Not yet Level 15.');
      lines.push('Travel unlocks at Level 15. Focus on leveling first.');
      lines.push('');
      lines.push('**STRATEGY:** Attack-and-leave targets to reach 15.');
    } else {
      lines.push('');
      lines.push('**STATUS:** Travel available!');
      lines.push('');
      lines.push('**TRAVEL INCOME:**');
      lines.push('• Buy plushies/flowers abroad');
      lines.push('• Sell at Museum for Points');
      lines.push('• Trade Points for cash');
      lines.push('');
      lines.push('**NEXT STEPS:**');
      lines.push('1. Check market prices with `!item`');
      lines.push('2. Travel to country with best profit');
      lines.push('3. Buy items and return to sell');
    }

    await message.reply(lines.join('\n'));
  } catch (e) {
    await message.reply(`I couldn't retrieve your Torn data right now.\n**Reason:** ${e.message}\nTry again shortly.`);
  }
}

module.exports = {
  handleCoach,
  handleBars,
  handleGain,
  handleLevelPacer,
  handleCrimeRoute,
  handleJobApply,
  handleEducation,
  handleMerits,
  handleMoney,
  handleTravel,
};
