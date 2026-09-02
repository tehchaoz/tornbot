const { tornGet } = require('../services/torn-api');

const OWNER_KEY = process.env.TORN_API_KEY || '';

// Item market listing fee (seller pays ~5% of sale price).
const FEE = 0.05;

// Common traded items (Xanax + plushies/flowers) for arbitrage scanning.
const ARBITRAGE_IDS = [
  206, 212, 213, 215, 216, 217, 218, 219, 220, 221,
  222, 223, 224, 225, 226, 227, 228, 229, 230, 231,
];

let itemsCache = null;
let itemsCacheTime = 0;

async function getItems() {
  if (itemsCache && Date.now() - itemsCacheTime < 24 * 3600 * 1000) return itemsCache;
  const d = await tornGet('torn', '', 'items', 1, OWNER_KEY);
  itemsCache = d.items || {};
  itemsCacheTime = Date.now();
  return itemsCache;
}

function lookupName(items, id) {
  const it = items && items[id];
  return it && it.name ? it.name : null;
}

function fmt(n) {
  if (n == null) return '?';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString('en-US');
}

function minCost(rows, field) {
  let low = null;
  for (const row of rows) {
    const v = Number(row && row[field]);
    if (!isNaN(v) && (low == null || v < low)) low = v;
  }
  return low;
}

async function handleArbitrage(message) {
  let items;
  try { items = await getItems(); } catch (e) { items = {}; }

  const results = await Promise.all(ARBITRAGE_IDS.map(async (id) => {
    const strId = String(id);
    try {
      const [b, m] = await Promise.all([
        tornGet('market', strId, 'bazaar', 1, OWNER_KEY),
        tornGet('market', strId, 'itemmarket', 2, OWNER_KEY),
      ]);

      const bazaar = Array.isArray(b && b.bazaar) ? b.bazaar : [];
      const listings = m && m.itemmarket && Array.isArray(m.itemmarket.listings) ? m.itemmarket.listings : [];
      const name = (m && m.itemmarket && m.itemmarket.item && m.itemmarket.item.name) || lookupName(items, strId) || `#${strId}`;

      const bLow = minCost(bazaar, 'cost');
      const mLow = minCost(listings, 'price');
      if (bLow == null || mLow == null) return null;

      const net = mLow * (1 - FEE);
      if (bLow >= net) return null;

      return { name, bLow, mLow, margin: net - bLow };
    } catch (e) {
      return null;
    }
  }));

  const flips = results.filter(Boolean);
  flips.sort((a, b) => b.margin - a.margin);

  const lines = [`**Arbitrage — bazaar \u2192 item market**`];
  if (!flips.length) {
    lines.push('No profitable flips right now.');
  } else {
    lines.push(`*(bazaar buy \u2192 market sell, after ~${Math.round(FEE * 100)}% fee)*`);
    for (const f of flips.slice(0, 15)) {
      lines.push(`\u2022 **${f.name}** \u2014 bazaar $${fmt(Math.round(f.bLow))} \u2192 market $${fmt(Math.round(f.mLow))} = +$${fmt(Math.round(f.margin))}`);
    }
  }

  await message.reply(lines.join('\n'));
}

async function handlePoints(message) {
  let d;
  try {
    d = await tornGet('market', '', 'pointsmarket', 1, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load points market: ${e.message}`);
    return;
  }

  const pm = d && d.pointsmarket ? d.pointsmarket : {};
  const rows = Object.values(pm);
  rows.sort((a, b) => Number(a.cost) - Number(b.cost));

  const lines = ['**Points market**'];
  if (!rows.length) {
    lines.push('No point listings right now.');
  } else {
    for (const r of rows.slice(0, 5)) {
      lines.push(`\u2022 ${r.quantity} points @ $${fmt(r.cost)} each = $${fmt(r.total_cost)}`);
    }
  }

  await message.reply(lines.join('\n'));
}

async function handleAuctions(message, args) {
  const raw = (args || []).join(' ').trim();
  if (!raw) {
    await message.reply('Usage: `!auctions <item name|id>`');
    return;
  }

  let items;
  try { items = await getItems(); } catch (e) { items = {}; }

  let itemId = null;
  let itemName = null;

  if (/^\d+$/.test(raw)) {
    itemId = raw;
    itemName = lookupName(items, raw);
  } else {
    const q = raw.toLowerCase();
    const entries = Object.entries(items);
    let match = entries.find(([, it]) => (it.name || '').toLowerCase() === q);
    if (!match) match = entries.find(([, it]) => (it.name || '').toLowerCase().includes(q));
    if (match) { itemId = match[0]; itemName = match[1].name; }
  }

  if (!itemId) {
    await message.reply(`Couldn't find item \`${raw}\`.`);
    return;
  }

  let d;
  try {
    d = await tornGet('market', itemId, 'auctionhouse', 2, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load auctions: ${e.message}`);
    return;
  }

  const auctions = Array.isArray(d && d.auctionhouse) ? d.auctionhouse : [];
  const lines = [`**Auction house \u2014 ${itemName || `#${itemId}`}**`];
  if (!auctions.length) {
    lines.push('No recent auctions found.');
  } else {
    for (const a of auctions.slice(0, 20)) {
      const seller = a.seller && a.seller.name ? a.seller.name : (a.seller && a.seller.id ? `#${a.seller.id}` : '?');
      const buyer = a.buyer && a.buyer.name ? a.buyer.name : (a.buyer && a.buyer.id ? `#${a.buyer.id}` : '?');
      const date = a.timestamp ? new Date(a.timestamp * 1000).toLocaleDateString('en-US') : '?';
      lines.push(`\u2022 #${a.id} \u2014 seller ${seller} \u2192 buyer ${buyer} \u2014 ${date}`);
    }
  }

  await message.reply(lines.join('\n'));
}

async function handleMuseum(message, args) {
  const q = (args || []).join(' ').trim().toLowerCase();

  let d;
  try {
    d = await tornGet('torn', '', 'museum', 2, OWNER_KEY);
  } catch (e) {
    await message.reply(`Couldn't load museum: ${e.message}`);
    return;
  }

  const sets = Array.isArray(d && d.museum) ? d.museum : [];
  if (!sets.length) {
    await message.reply('No museum data available.');
    return;
  }

  if (q) {
    const set = sets.find((s) => (s.name || '').toLowerCase() === q)
      || sets.find((s) => (s.name || '').toLowerCase().includes(q));
    if (!set) {
      await message.reply(`Museum set \`${q}\` not found.`);
      return;
    }
    let items = {};
    try { items = await getItems(); } catch (e) {}
    const ids = Array.isArray(set.items) ? set.items : [];
    const names = ids.map((id) => lookupName(items, String(id)) || `#${id}`);
    const lines = [`**${set.name}** \u2014 ${set.points} points \u2014 ${ids.length} items`];
    lines.push(`Items: ${names.join(', ')}`);
    await message.reply(lines.join('\n'));
    return;
  }

  const lines = ['**Museum sets**'];
  for (const s of sets) {
    lines.push(`\u2022 **${s.name}** \u2014 ${s.points} points \u2014 ${(s.items || []).length} items`);
  }
  await message.reply(lines.join('\n'));
}

module.exports = { handleArbitrage, handlePoints, handleAuctions, handleMuseum };
