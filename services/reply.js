const LIMIT = 1900;

function chunkText(text) {
  const str = String(text);
  const parts = [];
  let cur = '';
  for (const ln of str.split('\n')) {
    const add = (cur ? '\n' : '') + ln;
    if ((cur + add).length > LIMIT && cur) {
      parts.push(cur);
      cur = ln;
    } else {
      cur += add;
    }
  }
  if (cur) parts.push(cur);
  return parts.length ? parts : [str];
}

async function dmChunks(message, text) {
  const parts = chunkText(text);
  for (const p of parts) await message.author.send(p);
  return parts.length;
}

// Patch a command message so that any reply/edit longer than LIMIT is automatically
// DM'd to the user in chunks instead of failing/truncating in the channel.
function wrapMessage(message) {
  if (!message || message.__autoDmWrapped) return;
  message.__autoDmWrapped = true;

  const origReply = message.reply.bind(message);

  const patchEdit = (m) => {
    if (!m || typeof m.edit !== 'function' || m.__editWrapped) return m;
    m.__editWrapped = true;
    const origEdit = m.edit.bind(m);
    m.edit = async (content) => {
      if (typeof content === 'string' && content.length > LIMIT) {
        let sent = 0;
        try { sent = await dmChunks(message, content); } catch (e) { sent = 0; }
        if (sent) return origEdit(`\u2709\uFE0F Sent ${sent} message(s) to your DMs.`);
        return origEdit(chunkText(content)[0]);
      }
      return origEdit(content);
    };
    return m;
  };

  message.reply = async (content) => {
    if (typeof content === 'string' && content.length > LIMIT) {
      let sent = 0;
      try { sent = await dmChunks(message, content); } catch (e) { sent = 0; }
      if (sent) return patchEdit(await origReply(`\u2709\uFE0F Sent ${sent} message(s) to your DMs.`));
      return patchEdit(await origReply(chunkText(content)[0]));
    }
    return patchEdit(await origReply(content));
  };
}

module.exports = { wrapMessage, chunkText, dmChunks, LIMIT };
