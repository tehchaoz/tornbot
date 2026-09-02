const knownPlayers = require('../services/known-players');

function fmtLevel(e) {
  return e.level != null ? `Lv${e.level}` : 'Lv?';
}

async function handleKnown(message, args) {
  const cmd = (args[0] || '').toLowerCase();

  if (cmd === 'sync') {
    const reply = await message.reply('Syncing known players\u2026');
    try {
      const r = await knownPlayers.syncAll();
      const parts = Object.entries(r.added).map(([k, v]) => `${k} +${v}`);
      await reply.edit(`\u{1F465} **Synced** \u2014 ${r.before} \u2192 ${r.after} (${r.totalAdded} new)\n${parts.join(' \u00B7 ')}`);
    } catch (e) {
      await reply.edit(`Sync error: ${e.message}`);
    }
    return;
  }

  const query = (args || []).join(' ').trim();

  if (!query) {
    knownPlayers.load();
    const total = knownPlayers.count();
    const breakdown = knownPlayers.sourceBreakdown();
    const lines = [`\u{1F465} **Known players \u2014 ${total}**`];
    lines.push('');
    for (const [src, n] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
      lines.push(`\u2022 ${src}: ${n}`);
    }
    lines.push('');
    lines.push('`!known <name or id>` to search \u00B7 `!known sync` to refresh');
    await message.reply(lines.join('\n'));
    return;
  }

  knownPlayers.load();
  const results = knownPlayers.search(query);
  if (!results.length) {
    await message.reply(`No known players match \u201C${query}\u201D. Run \`!known sync\` to refresh the list.`);
    return;
  }
  results.sort((a, b) => (b.last || 0) - (a.last || 0));
  const shown = results.slice(0, 15);
  const lines = [`\u{1F465} **Known \u2014 ${results.length} match${results.length === 1 ? '' : 'es'}**`];
  for (const e of shown) {
    lines.push(`\u2022 **${e.name}** [${e.id}] \u2014 ${fmtLevel(e)} \u2014 ${e.source}`);
  }
  if (results.length > shown.length) lines.push(`\u2026and ${results.length - shown.length} more.`);
  await message.reply(lines.join('\n'));
}

module.exports = { handleKnown };
