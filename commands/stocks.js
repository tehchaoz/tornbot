const accountStore = require('../services/account-store');
const { tornGet } = require('../services/torn-api');
const { forecastSeries } = require('../services/stock-forecast');
const { getDailyHistory } = require('../services/stock-history');
const { composeReport, backtestSummary } = require('../services/technical');
const stockData = require('../services/stock-data');

const OWNER_KEY = process.env.TORN_API_KEY || '';
const FORECAST_TOP = 5; // chips shown in `!stocks` (history fetches are per-symbol)

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
  if (num >= 1e15) return (num / 1e15).toFixed(2) + 'Q';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toLocaleString('en-US');
}

function fmtPct(frac, digits = 1) {
  if (frac == null || !isFinite(frac)) return 'n/a';
  return (frac * 100).toFixed(digits) + '%';
}

function parseAmount(arg) {
  if (!arg) return null;
  const m = String(arg).trim().toLowerCase().match(/^([\d,.]+)\s*([kmbtq])?$/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!isFinite(base)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 }[m[2]] || 1;
  return base * mult;
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
  return bias === 'BUY' ? '\u{1F7E2}' : bias === 'SELL' ? '\u{1F534}' : '\u26AA';
}

function benefitText(stock) {
  const b = stock.bonus;
  if (!b || !b.description) return 'no benefit listed';
  return `${b.description}${b.frequency ? ' /' + b.frequency + 'd' : ''}`;
}

// Ticker -> stock row map (acronym is the ticker in the v2 API).
function indexRows(rows) {
  const map = {};
  for (const s of rows) {
    if (s && s.symbol) map[s.symbol] = s;
  }
  return map;
}

// Annualized block ROI for the next block to be bought. If `shares` is given,
// the next increment is the holder's next block; otherwise block 1.
function blockEconomics(stock, bv, shares) {
  const req = (stock.bonus && Number(stock.bonus.requirement)) || 0;
  if (!req || !stock.price) return null;
  const blocks = shares != null ? stockData.blocksHeld(shares, req) : 0;
  const incShares = req * Math.pow(2, blocks);
  const cost = incShares * stock.price;
  const annual = bv.priced ? bv.annual : 0;
  const roi = bv.priced && cost > 0 ? annual / cost : null;
  return { req, blocks, nextBlock: blocks + 1, incShares, cost, annual, roi, priced: bv.priced };
}

async function stockListWithBenefits() {
  const stocks = await stockData.stockList();
  for (const s of stocks) {
    s.bv = await stockData.benefitValue(s.bonus);
  }
  return stocks.filter((s) => s.price > 0);
}

async function handleStocks(message) {
  const reply = await message.reply('Fetching stock exchange\u2026');
  try {
    const stocks = (await stockListWithBenefits()).sort((a, b) => b.cap - a.cap);
    if (!stocks.length) {
      await reply.edit('The stock exchange returned no data \u2014 is the API key set up?');
      return;
    }

    const board = [`\u{1F4C8} **Torn Stock Exchange** \u2014 ${stocks.length} stocks by market cap`];
    for (const s of stocks.slice(0, 10)) {
      board.push(
        `**${s.symbol}** \u2014 $${fmt(s.price)} \u00b7 cap $${fmtCompact(s.cap)} \u00b7 ${fmt(s.investors)} investors` +
          (s.bonus && s.bonus.description ? ` \u00b7 ${s.bonus.description}` : ''),
      );
    }

    const priced = stocks.filter((s) => s.bv && s.bv.priced && s.bv.perBlock > 0);
    const ranked = priced
      .map((s) => ({ s, e: blockEconomics(s, s.bv, null) }))
      .filter((x) => x.e && x.e.roi != null)
      .sort((a, b) => b.e.roi - a.e.roi)
      .slice(0, 5);
    if (ranked.length) {
      board.push('', '**Best block-1 ROI (cash + item, annualized)**');
      for (const { s, e } of ranked) {
        board.push(
          `**${s.symbol}** \u2014 ${fmtPct(e.roi)}/yr \u00b7 block1 $${fmtCompact(e.cost)} \u2192 $${fmtCompact(s.bv.perBlock)}/${s.bonus.frequency}d`,
        );
      }
    }

    const chips = [];
    for (const s of stocks.slice(0, FORECAST_TOP)) {
      try {
        chips.push({ symbol: s.symbol, f: forecastSeries(await getDailyHistory(s.symbol)) });
      } catch (e) {
        chips.push({ symbol: s.symbol, f: null });
      }
    }
    if (chips.some((c) => c.f)) {
      board.push('', `**30-day forecast (top ${FORECAST_TOP} by cap)**`);
      for (const c of chips) {
        if (!c.f) { board.push(`**${c.symbol}** \u2014 no forecast (short history)`); continue; }
        const last = c.f.points[c.f.points.length - 1];
        board.push(
          `${biasEmoji(c.f.bias)} **${c.symbol}** \u2014 ${c.f.bias} ${Math.round(c.f.confidence * 100)}% \u00b7 $${fmt(last.p)} in ${c.f.horizonDays}d`,
        );
      }
      board.push('_Forecast = Holt smoothing on Tornsy daily candles; bias is a model score, not advice._');
    }

    await reply.edit(board.join('\n'));
  } catch (e) {
    await reply.edit(`Stock exchange error: ${e.message}`);
  }
}

async function handleStockForecast(message, symbolArg) {
  const ticker = (symbolArg || '').trim().toUpperCase();
  if (!ticker) {
    await message.reply('Usage: `!stockforecast <symbol>` (e.g. `!stockforecast tsb`)');
    return;
  }
  const reply = await message.reply('Computing forecast\u2026');
  try {
    const stocks = await stockData.stockList();
    const index = indexRows(stocks);
    const s = index[ticker];
    if (!s) {
      await reply.edit(`Unknown symbol "${ticker}". Some: ${Object.keys(index).slice(0, 20).join(', ')}`);
      return;
    }
    const history = await getDailyHistory(s.symbol);
    const report = await composeReport(history, s.price);
    if (!report) {
      await reply.edit(`**${s.symbol} (${s.name})** \u2014 no forecast: only ${history.length} candles, need 30+.`);
      return;
    }

    const f30 = report.forecasts[30];
    const t = report.tech;
    const spark = sparkline(history.slice(-365));
    const lines = [
      `${biasEmoji(f30.bias)} **${s.symbol} \u2014 ${s.name}**`,
      `Last: **$${fmt(report.last)}** \u00b7 cap $${fmtCompact(s.cap)} \u00b7 ${fmt(s.investors)} investors`,
    ];
    if (spark) lines.push('1y: `' + spark + '`');

    lines.push('', '**Multi-horizon forecast** (Holt, 80% band)');
    for (const h of [7, 30, 90]) {
      const f = report.forecasts[h];
      if (!f) continue;
      const p = f.points[f.points.length - 1];
      lines.push(`${h}d: **$${fmt(p.p)}** ($${fmt(p.low)}\u2013$${fmt(p.high)})`);
    }
    const sig = report.signals || {};
    lines.push(
      `Bias **${f30.bias}** ${Math.round(f30.confidence * 100)}% \u00b7 drift ${(sig.driftAnnualPct * 100).toFixed(1)}%/yr \u00b7 vol ${(sig.volatility * 100).toFixed(0)}%/yr`,
      `Backtest: ${backtestSummary(f30)}`,
    );

    lines.push('', '**Technicals**');
    lines.push(
      `RSI(14) ${t.rsi != null ? t.rsi.toFixed(1) : 'n/a'} (${t.rsiState}) \u00b7 trend ${t.trend || 'n/a'}` +
        (t.macd ? ` \u00b7 MACD ${t.macd.momentum}${t.macd.crossed !== 'none' ? ' (' + t.macd.crossed + ' cross)' : ''}` : ''),
    );
    if (t.support != null) {
      lines.push(`Support $${fmt(t.support)} (${fmtPct(t.distToSupport)} away) \u00b7 Resistance $${fmt(t.resistance)} (${fmtPct(t.distToResistance)} away)`);
    }
    lines.push(`Regime: ${report.regimeText}`);

    const bv = await stockData.benefitValue(s.bonus);
    const e = blockEconomics(s, bv, null);
    if (s.bonus && s.bonus.description) {
      lines.push('', '**Block benefit**');
      lines.push(`${s.bonus.description}${s.bonus.frequency ? ' every ' + s.bonus.frequency + 'd' : ''}`);
      if (e) {
        lines.push(
          `Block 1: ${fmt(e.incShares)} shares @ $${fmt(s.price)} = **$${fmtCompact(e.cost)}**` +
            (bv.priced ? ` \u00b7 pays ${bv.type === 'item' ? bv.qty + 'x ' + bv.item : '$' + fmt(bv.perBlock)} \u2192 ${fmtPct(e.roi)}/yr` : ` \u00b7 value n/a${bv.note ? ' (' + bv.note + ')' : ''}`),
        );
      }
    }
    lines.push('', '_Bias is a statistical model score, not financial advice._');
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Forecast error: ${e.message}`);
  }
}

async function handleStockSuggest(message, amountArg) {
  const userId = message.author.id;
  const account = accountStore.getAccount(userId);
  const apiKey = account ? accountStore.getApiKey(userId) : null;
  const reply = await message.reply('Building block advisor\u2026');
  try {
    const stocks = await stockListWithBenefits();
    const bank = await stockData.bankRates();

    let budget = parseAmount(amountArg);
    let budgetSource = amountArg ? 'your amount' : null;
    let holdings = {};
    if (apiKey) {
      try {
        holdings = await stockData.getUserStocks(apiKey);
      } catch (e) { /* holdings optional */ }
      if (budget == null) {
        try {
          budget = await stockData.getUserWallet(apiKey);
          if (budget > 0) budgetSource = 'wallet';
        } catch (e) {}
      }
    }

    const rows = stocks.map((s) => {
      const held = holdings[String(s.id)] || null;
      const shares = held ? held.shares : null;
      const e = blockEconomics(s, s.bv, shares);
      return { s, held, e };
    });

    const affordable = rows.filter((r) => r.e);
    const withinBudget = budget != null && budget > 0
      ? affordable.filter((r) => r.e.cost <= budget)
      : affordable;
    const priced = withinBudget.filter((r) => r.e.roi != null).sort((a, b) => b.e.roi - a.e.roi);
    const unpriced = withinBudget.filter((r) => r.e.roi == null).sort((a, b) => a.e.cost - b.e.cost);
    const bankApr = bank && bank.best ? bank.best.apr / 100 : null;

    const lines = ['\u{1F4B0} **Stock block advisor**'];
    if (account) lines.push(`_Player: ${account.tornUsername}${budgetSource ? ` \u00b7 budget $${fmtCompact(budget)} (${budgetSource})` : ''}_`);
    if (budgetSource && account) lines.push(`Budget: **$${fmtCompact(budget)}** (${budgetSource})`);

    if (bank && bank.best) {
      lines.push(`Bank benchmark: best term **${bank.best.term}** \u2248 **${fmtPct(bank.best.apr / 100, 1)}/yr APR** (maxed bank). Blocks beating that APR are worth buying on money terms alone \u2014 perks/items add the rest.`);
    }

    if (account && Object.keys(holdings).length) {
      const heldRows = rows.filter((r) => r.held && r.held.shares > 0);
      if (heldRows.length) {
        lines.push('', '**Your holdings**');
        for (const r of heldRows.slice(0, 8)) {
          const blocksText = r.e ? `${r.e.blocks} block${r.e.blocks === 1 ? '' : 's'}` : `${fmt(r.held.shares)} shares`;
          lines.push(`**${r.s.symbol}** \u2014 ${blocksText} (${fmt(r.held.shares)} sh) \u00b7 next block $${r.e ? fmtCompact(r.e.cost) : '?'}`);
        }
      }
    }

    if (priced.length) {
      lines.push('', `**Best next blocks by ROI${budgetSource ? ' (within budget)' : ''}**`);
      for (const r of priced.slice(0, 7)) {
        const s = r.s;
        const e = r.e;
        const payout = s.bv.type === 'item' ? `${s.bv.qty}x ${s.bv.item}` : `$${fmtCompact(s.bv.perBlock)}`;
        const holdTag = r.held && r.held.shares > 0 ? ` (block ${e.nextBlock})` : '';
        const beat = bankApr != null && e.roi > bankApr ? ' \u25B2 beats bank' : '';
        lines.push(
          `**${s.symbol}**${holdTag} \u2014 ${fmtPct(e.roi)}/yr${beat} \u00b7 buy ${fmtCompact(e.incShares)} sh = $${fmtCompact(e.cost)} \u2192 ${payout} /${s.bonus.frequency}d`,
        );
      }
    } else {
      lines.push('', budget != null && budget > 0
        ? '_No priced stock block fits that budget._'
        : '_No priced blocks found (add an amount: `!stocksuggest 5b`)._');
    }

    if (unpriced.length) {
      lines.push('', '**Utility/perk blocks (not cash-priced)**');
      for (const r of unpriced.slice(0, 8)) {
        lines.push(`**${r.s.symbol}** \u2014 ${benefitText(r.s)} \u00b7 next block $${fmtCompact(r.e.cost)}`);
      }
    }

    lines.push('', '_Block cost doubles per block (req \u00d7 2^N shares). ROI = annual payout value \u00f7 next-block cost._');
    await reply.edit(lines.join('\n'));
  } catch (e) {
    await reply.edit(`Advisor error: ${e.message}`);
  }
}

module.exports = { handleStocks, handleStockForecast, handleStockSuggest };