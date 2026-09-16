const { tornGet } = require('../services/torn-api');
const { forecastSeries } = require('../services/stock-forecast');
const { getDailyHistory } = require('../services/stock-history');

const OWNER_KEY = process.env.TORN_API_KEY || '';
const FORECAST_TOP = 5; // chips shown in `!stocks` (1 list call + 5 Tornsy history fetches)

const SPARK_CHARS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function fmt(n) {
  if (n == null) return '?';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString('en-US');
}

function fmtCompact(n) {
  if (n == null) return '?';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString('en-US');
}

function sparkline(history, width = 18) {
  if (!history || history.length < 2) return null;
  const min = Math.min(...history.map((x) => x.p));
  const max = Math.max(...history.map((x) => x.p));
  const span = max - min || 1;
  const out = [];
  for (let i = 0; i < width; i++) {
    const idx = Math.floor((i / width) * history.length);
    const v = Math.round(((history[idx].p - min) / span) * (SPARK_CHARS.length - 1));
    out.push(SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, v))]);
  }
  return out.join('');
}

function biasEmoji(bias) {
  return bias === 'BUY' ? '🟢' : bias === 'SELL' ? '🔴' : '⚪';
}

// v2 `torn/stocks` list: { stocks: { [id]: { id, name, acronym, market, bonus } } }.
async function stockList() {
  const d = await tornGet('torn', '', 'stocks', 2, OWNER_KEY, { cacheTtl: 60 });
  return Object.values((d && d.stocks) || {});
}

// Ticker -> stock row map (acronym is the ticker in the v2 API).
function indexRows(rows) {
  const map = {};
  for (const s of rows) {
    if (s && s.acronym) map[String(s.acronym).toUpperCase()] = s;
  }
  return map;
}

function forecastLine(symbol, f) {
  if (!f) return `**${symbol}** — no forecast (not enough history)`;
  const pct = Math.round(f.confidence * 100);
  const acc = f.backtest.directional != null ? `${Math.round(f.backtest.directional * 100)}% hit` : 'n/a';
  const last = f.points[f.points.length - 1];
  const s = f.signals;
  const momentum = s.momentum === 'up' ? 'up' : s.momentum === 'down' ? 'down' : 'flat';
  return `${biasEmoji(f.bias)} **${symbol}** — ${f.bias} ${pct}% · $${fmt(last.low)}→$${fmt(last.high)} in ${f.horizonDays}d (${momentum} · vol ${(s.volatility * 100).toFixed(0)}% · ${acc})`;
}

async function handleStocks(message) {
  const reply = await message.reply('Fetching stock exchange\u2026');
  try {
    const stocks = (await stockList())
      .map((s) => ({
        id: s.id,
        symbol: String(s.acronym || '?').toUpperCase(),
        name: s.name || s.acronym || String(s.id),
        price: Number((s.market && s.market.price) || 0),
        cap: Number((s.market && s.market.cap) || 0),
        investors: Number((s.market && s.market.investors) || 0),
        bonus: s.bonus || null,
      }))
      .filter((s) => s.price > 0)
      .sort((a, b) => b.cap - a.cap);

    if (!stocks.length) {
      await reply.edit('The stock exchange returned no data — is the API key set up?');
      return;
    }

    const lines = [`📈 **Torn Stock Exchange** — ${stocks.length} stocks by market cap`];
    for (const s of stocks.slice(0, 10)) {
      lines.push(
        `**${s.symbol}** — $${fmt(s.price)} · cap $${fmtCompact(s.cap)} · ${fmt(s.investors)} investors` +
          (s.bonus && s.bonus.description ? ` · ${s.bonus.description}${s.bonus.frequency ? ' /' + s.bonus.frequency + 'd' : ''}` : ''),
      );
    }

    // Bias/forecast chips for the top N by cap (Tornsy candles, not Torn API).
    const chips = [];
    for (const s of stocks.slice(0, FORECAST_TOP)) {
      try {
        const f = forecastSeries(await getDailyHistory(s.symbol));
        chips.push({ symbol: s.symbol, f });
      } catch (e) {
        chips.push({ symbol: s.symbol, f: null });
      }
    }
    if (chips.some((c) => c.f)) {
      lines.push('', `**30-day forecast (top ${FORECAST_TOP})**`);
      for (const c of chips) lines.push(forecastLine(c.symbol, c.f));
      lines.push('_Forecast = Holt smoothing on Tornsy daily candles; bias is a model score, not advice._');
    }

    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Stock exchange error: ${e.message}`);
  }
}

async function handleStockForecast(message, symbolArg) {
  const ticker = (symbolArg || '').trim().toUpperCase();
  if (!ticker) {
    await message.reply('Usage: `!stockforecast <symbol>` (e.g. `!stockforecast tcj`)');
    return;
  }
  const reply = await message.reply('Computing forecast\u2026');
  try {
    const rows = await stockList();
    const index = indexRows(rows);
    const s = index[ticker];
    if (!s) {
      const known = Object.keys(index).slice(0, 20).join(', ');
      await reply.edit(`Unknown symbol "${ticker}". Some: ${known}`);
      return;
    }
    const symbol = String(s.acronym).toUpperCase();
    const history = await getDailyHistory(symbol);
    const f = forecastSeries(history);
    if (!f) {
      await reply.edit(`**${symbol} (${s.name})** — no forecast: only ${history.length} candles, need 30+.`);
      return;
    }

    const last = f.points[f.points.length - 1];
    const sig = f.signals;
    const spark = sparkline(history.slice(-365));
    const mkt = s.market || {};
    const bonus = s.bonus || null;
    const momentum = sig.momentum === 'up' ? 'up' : sig.momentum === 'down' ? 'down' : 'flat';
    const driftPct = (sig.driftAnnualPct * 100).toFixed(1);

    const lines = [
      `${biasEmoji(f.bias)} **${symbol} — ${s.name}** · 30-day forecast`,
      `Last: **$${fmt(f.lastPrice)}** · Projection day ${f.horizonDays}: **$${fmt(last.p)}** (80% band $${fmt(last.low)}–$${fmt(last.high)})`,
      `Bias: **${f.bias}** ${Math.round(f.confidence * 100)}% · momentum **${momentum}** · drift ${driftPct}%/yr · vol ${(sig.volatility * 100).toFixed(0)}%/yr`,
      `Backtest: ${f.backtest.directional != null ? Math.round(f.backtest.directional * 100) + '% directional (n=' + f.backtest.samples + ')' : 'n/a'}`,
    ];
    if (spark) lines.push('1y: `' + spark + '`');
    if (mkt.price != null) lines.push(`Price: $${fmt(mkt.price)} · cap $${fmtCompact(mkt.cap)} · ${fmt(mkt.investors)} investors`);
    if (bonus && bonus.description) {
      lines.push(`Block/share benefit: ${bonus.description}${bonus.frequency ? ' (every ' + bonus.frequency + ' days)' : ''}`);
    }
    lines.push('_Bias is a statistical model score, not financial advice._');
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Forecast error: ${e.message}`);
  }
}

module.exports = { handleStocks, handleStockForecast };