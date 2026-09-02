const { tornGet } = require('../services/torn-api');

const OWNER_KEY = process.env.TORN_API_KEY || '';

// Junk = items with no use. An item "has a use" if it has a weapon_type (combat) or a
// non-empty effect (crimes, missions, enhancers, consumables). Some types (Car, Clothing,
// Flower, Plushie, Defensive, Supply Pack, Artifact, Jewelry) are useful despite having no
// effect field, so only these three types are treated as junk.
const JUNK_TYPES = ['Other', 'Collectible', 'Unused'];

let itemsCache = null;
let itemsCacheTime = 0;

async function getItems() {
  if (itemsCache && Date.now() - itemsCacheTime < 24 * 3600 * 1000) return itemsCache;
  const d = await tornGet('torn', '', 'items', 1, OWNER_KEY);
  itemsCache = d.items || {};
  itemsCacheTime = Date.now();
  return itemsCache;
}

function isJunk(it) {
  const t = it.type || '';
  if (!JUNK_TYPES.includes(t)) return false;
  if (it.weapon_type) return false;
  const eff = it.effect ? String(it.effect).trim() : '';
  return !eff;
}

async function handleJunk(message) {
  let items;
  try {
    items = await getItems();
  } catch (e) {
    await message.reply(`Couldn't load item list: ${e.message}`);
    return;
  }

  const byType = {};
  for (const it of Object.values(items)) {
    if (!isJunk(it)) continue;
    const t = it.type;
    if (!byType[t]) byType[t] = [];
    byType[t].push(it.name);
  }

  const lines = ['**Trash / vendor goods (no use)**'];
  for (const t of JUNK_TYPES) {
    if (!byType[t] || !byType[t].length) continue;
    byType[t].sort();
    lines.push(`\n**${t}** (${byType[t].length})`);
    for (const name of byType[t]) lines.push(`\u2022 ${name}`);
  }

  await message.reply(lines.join('\n'));
}

module.exports = { handleJunk };
