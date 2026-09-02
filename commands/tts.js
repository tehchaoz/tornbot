const fs = require('fs');
const accountStore = require('../services/account-store');

const TTS_URL = process.env.TTS_URL || 'http://127.0.0.1:8000/tts';
const MAX_LEN = 500;
const IDLE_MS = 5 * 60 * 1000;

const VOICES = ['alba', 'anna', 'azelma', 'bill_boerst', 'caro_davy', 'charles', 'cosette', 'eponine', 'eve', 'fantine', 'george', 'jane', 'javert', 'jean', 'marius', 'mary', 'michael', 'paul', 'peter_yearsley', 'stuart_bell', 'vera', 'giovanni', 'lola', 'juergen', 'rafael', 'estelle'];

let voiceSession = null; // { connection, channelId, guildId, idleTimer }

function getVoiceModule() {
  try { return require('@discordjs/voice'); } catch (e) { return null; }
}

function stopSession() {
  if (!voiceSession) return;
  if (voiceSession.idleTimer) clearTimeout(voiceSession.idleTimer);
  try { voiceSession.connection.destroy(); } catch (e) {}
  voiceSession = null;
}

function resetIdle() {
  if (!voiceSession) return;
  if (voiceSession.idleTimer) clearTimeout(voiceSession.idleTimer);
  voiceSession.idleTimer = setTimeout(() => stopSession(), IDLE_MS);
}

function checkAlone(client) {
  if (!voiceSession || !client) return;
  let ch;
  try { ch = client.channels.cache.get(voiceSession.channelId); } catch (e) { return; }
  if (!ch) { stopSession(); return; }
  const humans = ch.members.filter((m) => !m.user.bot);
  if (humans.size === 0) stopSession();
}

function initVoice(client) {
  client.on('voiceStateUpdate', () => checkAlone(client));
}

function getVoice(userId) {
  try {
    const prefs = accountStore.getPreferences(userId);
    return (prefs.coachPreferences && prefs.coachPreferences.ttsVoice) || null;
  } catch (e) { return null; }
}

function setVoice(userId, name) {
  try {
    const prefs = accountStore.getPreferences(userId);
    accountStore.updatePreferences(userId, { coachPreferences: { ...(prefs.coachPreferences || {}), ttsVoice: name } });
  } catch (e) {}
}

async function generateTts(text, voice) {
  const form = new FormData();
  form.append('text', text.slice(0, MAX_LEN));
  if (voice) form.append('voice_url', voice);
  const res = await fetch(TTS_URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function handleTts(message, args) {
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'voices') {
    await message.reply(`**Voices:** ${VOICES.join(', ')}\nSet one with \`!tts voice <name>\`.`);
    return;
  }

  if (cmd === 'voice') {
    const name = (args[1] || '').toLowerCase();
    if (!name) {
      await message.reply('Usage: `!tts voice <name>` \u2014 see `!tts voices`.');
      return;
    }
    if (!VOICES.includes(name)) {
      await message.reply(`Unknown voice \u201C${args[1]}\u201D. Run \`!tts voices\` for the list.`);
      return;
    }
    setVoice(message.author.id, name);
    await message.reply(`\u{1F399}\uFE0F Voice set to **${name}**. Use \`!tts <text>\` for a file, or \`!say <text>\` to speak in voice.`);
    return;
  }

  const text = (args || []).join(' ').trim();
  if (!text) {
    await message.reply('Usage: `!tts <text>` (file) \u00B7 `!say <text>` (voice) \u00B7 `!tts voice <name>` / `!tts voices`.');
    return;
  }

  const voice = getVoice(message.author.id);
  const reply = await message.reply('\u{1F50A} Generating speech\u2026');
  try {
    const buf = await generateTts(text, voice);
    await reply.edit({ content: `\u{1F50A} **${message.author.username}**: ${text.slice(0, 200)}`, files: [{ attachment: buf, name: 'tts.wav' }] });
  } catch (e) {
    await reply.edit(`TTS error: ${e.message}`);
  }
}

async function handleSay(message, args) {
  const text = (args || []).join(' ').trim();
  if (!text) {
    await message.reply('Usage: `!say <text>` \u2014 speaks in your voice channel.');
    return;
  }

  const member = message.member;
  const channel = member && member.voice && member.voice.channel;
  if (!channel) {
    await message.reply('Join a voice channel first, then run `!say <text>`.');
    return;
  }
  if (!message.guild) {
    await message.reply('Voice only works in a server, not DMs.');
    return;
  }

  const v = getVoiceModule();
  if (!v) {
    await message.reply('Voice module is not available on this bot.');
    return;
  }

  const reply = await message.reply(`\u{1F50A} Speaking in **${channel.name}**\u2026`);
  let tmpFile = null;
  try {
    const buf = await generateTts(text, getVoice(message.author.id));
    tmpFile = `/tmp/tts-say-${message.author.id}-${Date.now()}.wav`;
    fs.writeFileSync(tmpFile, buf);

    let connection;
    if (voiceSession && voiceSession.guildId === message.guild.id && voiceSession.channelId === channel.id) {
      connection = voiceSession.connection;
    } else {
      stopSession();
      connection = v.joinVoiceChannel({
        channelId: channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      voiceSession = { connection, channelId: channel.id, guildId: message.guild.id, idleTimer: null };
      connection.on(v.VoiceConnectionStatus.Disconnected, () => {
        setTimeout(() => {
          if (voiceSession && voiceSession.connection === connection && connection.state.status !== v.VoiceConnectionStatus.Ready) {
            stopSession();
          }
        }, 5000);
      });
    }

    const player = v.createAudioPlayer();
    player.play(v.createAudioResource(tmpFile));
    connection.subscribe(player);

    player.once(v.AudioPlayerStatus.Idle, () => { if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (e) {} tmpFile = null; } });
    player.once('error', () => { if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (e) {} tmpFile = null; } });

    resetIdle();
    await reply.edit(`\u{1F50A} Speaking in **${channel.name}** \u2014 I'll stay 5 min (or leave if the channel empties).`);
  } catch (e) {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (e2) {} }
    await reply.edit(`Voice error: ${e.message}`);
  }
}

module.exports = { handleTts, handleSay, initVoice };
