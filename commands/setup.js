const { EmbedBuilder } = require('discord.js');
const { tornGet } = require('../services/torn-api');
const accountStore = require('../services/account-store');

const PENDING_SETUP = new Map();

async function handleTornSetup(message) {
  const userId = message.author.id;
  
  const existing = accountStore.getAccount(userId);
  if (existing) {
    await message.reply(
      `You already have a connected Torn account: **${existing.tornUsername}** (#${existing.tornPlayerId}).\n` +
      `Use \`!torn disconnect\` first if you want to change it.`
    );
    return;
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Torn Account Setup')
    .setDescription(
      'To connect your Torn account, I need your **Full Access** API key.\n\n' +
      '**Step 1:** Go to https://www.torn.com/preferences.php#api\n' +
      '**Step 2:** Generate or copy your Full Access API key\n' +
      '**Step 3:** Send it to me in this **DM** (reply to this message)\n\n' +
      'Your key will be encrypted and stored securely. It will never be displayed or logged.'
    )
    .setColor(0x00ff00)
    .setFooter({ text: 'Your API key is encrypted at rest and never exposed in Discord.' });

  try {
    // Send the setup instructions as a DM
    const dm = await message.author.send({ embeds: [embed] });
    
    // Let them know in the channel that we've sent the DM
    await message.reply('I\'ve sent you a DM to set up your Torn account! Please check your DMs and reply there with your API key.');
    
    // Set up pending state
    PENDING_SETUP.set(userId, { step: 'awaiting_key', startedAt: Date.now() });

    setTimeout(() => {
      if (PENDING_SETUP.has(userId) && PENDING_SETUP.get(userId).step === 'awaiting_key') {
        PENDING_SETUP.delete(userId);
      }
    }, 300000);
  } catch (dmError) {
    // If we can't send a DM (user has DMs disabled), fall back to channel message
    await message.reply(
      `I couldn't send you a DM. Please check your Discord privacy settings:\n` +
      `User Settings → Privacy & Safety → Enable "Allow direct messages from server members"\n\n` +
      `Once enabled, run \`!torn setup\` again and I'll send you the setup instructions via DM.\n\n` +
      `Your API key will be encrypted and stored securely. It will never be displayed or logged.`
    );
    console.error(`[torn-setup] failed to send setup DM to user ${userId}:`, dmError.message);
  }
}

async function handleDM(message) {
  const userId = message.author.id;
  const pending = PENDING_SETUP.get(userId);
  if (!pending || pending.step !== 'awaiting_key') return false;

  const key = message.content.trim();
  if (!key || key.length < 10 || key.length > 50) {
    await message.reply('That doesn\'t look like a valid Torn API key. Please send your Full Access API key, or type `cancel` to abort.');
    return true;
  }

  if (key.toLowerCase() === 'cancel') {
    PENDING_SETUP.delete(userId);
    await message.reply('Setup cancelled.');
    return true;
  }

try {
      await message.reply('Validating your API key...');
    } catch (validatingError) {
      console.error(`[torn-setup] failed to send validating message to user ${userId}:`, validatingError.message);
    }
  try {
    const data = await tornGet('user', '', 'profile,battlestats', 1, key);

    if (data.error) {
      await message.reply(
        `Torn rejected that key: **${data.error.error}**\n` +
        'Please check that you copied the full key correctly, or generate a new one.'
      );
      return true;
    }

    if (!data.player_id) {
      await message.reply('Could not verify that key. Please try again or generate a new key.');
      return true;
    }

    accountStore.saveAccount(userId, String(data.player_id), data.name || 'Unknown', key);
    PENDING_SETUP.delete(userId);

    const embed = new EmbedBuilder()
      .setTitle('Account Connected')
      .setDescription(
        `**Torn Account:** ${data.name} (#${data.player_id})\n` +
        `**Level:** ${data.level || '?'}\n` +
        `**Rank:** ${data.rank || '?'}\n\n` +
        'Your API key is encrypted and stored securely.\n' +
        'You can now use commands like `!bars`, `!coach`, `!guide`.'
      )
      .setColor(0x00ff00);

    try {
      await message.reply({ embeds: [embed] });
    } catch (replyError) {
      console.error(`[torn-setup] failed to send confirmation DM to user ${userId}:`, replyError.message);
    }
    console.log(`[torn-setup] user ${userId} connected to Torn ${data.name}#${data.player_id}`);
    return true;
  } catch (e) {
    await message.reply(
      `I couldn't validate that key: ${e.message}\n` +
      'Please try again or generate a new key.'
    );
    return true;
  }
}

async function handleTornStatus(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);

  if (!account) {
    await message.reply('You haven\'t connected a Torn account yet.\nUse `!torn setup` to get started.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Torn Account Status')
    .setDescription(
      `**Torn Account:** ${account.tornUsername} (#${account.tornPlayerId})\n` +
      `**Status:** ${account.status}\n` +
      `**Connected:** <t:${account.createdAt}:R>\n` +
      (account.lastValidatedAt ? `**Last validated:** <t:${account.lastValidatedAt}:R>` : '')
    )
    .setColor(0x00ff00);

  await message.reply({ embeds: [embed] });
}

async function handleTornDisconnect(message) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);

  if (!account) {
    await message.reply('You don\'t have a connected Torn account.');
    return;
  }

  accountStore.removeAccount(userId);

  const embed = new EmbedBuilder()
    .setTitle('Account Disconnected')
    .setDescription(
      `Your Torn account (**${account.tornUsername}** #${account.tornPlayerId}) has been disconnected.\n` +
      'Your API key has been securely deleted.'
    )
    .setColor(0xff0000);

  await message.reply({ embeds: [embed] });
  console.log(`[torn-setup] user ${userId} disconnected from Torn ${account.tornUsername}#${account.tornPlayerId}`);
}

function isPendingSetup(userId) {
  return PENDING_SETUP.has(userId);
}

module.exports = { handleTornSetup, handleDM, handleTornStatus, handleTornDisconnect, isPendingSetup };
