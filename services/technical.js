/**
 * Technical indicators (RSI, MACD, SMA/EMA, support/resistance) layered on top
 * of the Holt-based `stock-forecast` engine. Multi-horizon: 7d / 30d / 90d are
 * all extractions of the same fitted model at different horizons, so the report
 * stays internally consistent:
 *
 *   - `forecastSeries(dailyPath, { horizonDays })` — one model, N horizons.
 *   - `analyzeDaily(closes)` — RSI(14), MACD(12,26,9), EMA cross regime,
 *     SMA-20/50 trend, support/resistance from recent swing levels, plus the
 *     Holt momentum/vol/drift signals already in the forecast.
 *   - `composeReport(path)` — ties forecast(s) + technicals into one record the
 *     command handler can render, with a human-readable regime summary.
 */

const { forecastSeries } = require('./stock-forecast');

// (array of numbers) -> SMA (null if not enough points)
function sma(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

// EMA seed uses SMA of the first `period` points.
function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) prev = values[i] * k + prev * (1 - k);
  return prev;
}

// Wilder RSI.
function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macdSeries(values, fast = 12, slow = 26, signal = 9) {
  if (!values || values.length < slow + signal) return null;
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  const kSignal = 2 / (signal + 1);
  let ef = sma(values, fast);
  let es = sma(values, slow);
  if (ef == null || es == null) return null;
  const signals = [];
  let esig = null;
  for (let i = slow; i < values.length; i++) {
    ef = values[i] * kFast + ef * (1 - kFast);
    es = values[i] * kSlow + es * (1 - kSlow);
    const line = ef - es;
    esig = esig == null ? line : line * kSignal + esig * (1 - kSignal);
    signals.push({ line, signal: esig, hist: line - esig });
  }
  if (signals.length < 2) return null;
  const last = signals[signals.length - 1];
  const prev = signals[signals.length - 2];
  const crossed = (prev.hist <= 0 && last.hist > 0) ? 'bull' : (prev.hist >= 0 && last.hist < 0) ? 'bear' : 'none';
  const momentum = (last.line > last.signal) ? 'bull' : (last.line < last.signal) ? 'bear' : 'flat';
  return { line: last.line, signal: last.signal, hist: last.hist, crossed, momentum };
}

function supportResistance(closes) {
  if (!closes || closes.length < 30) return { support: null, resistance: null };
  const recent = closes.slice(-90);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const last = recent[recent.length - 1];
  const span = max - min || 1;
  return {
    support: min,
    resistance: max,
    distanceToSupport: last > 0 ? (last - min) / last : 0,
    distanceToResistance: last > 0 ? (max - last) / last : 0,
  };
}

function closesFromPath(path) {
  if (!Array.isArray(path)) return [];
  return path.map((x) => x.p).filter((p) => p > 0);
}

function trendEMACross(closes) {
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  if (e20 == null || e50 == null) return null;
  const spreadPct = e50 > 0 ? (e20 - e50) / e50 : 0;
  const regime = spreadPct > 0.02 ? 'uptrend' : spreadPct < -0.02 ? 'downtrend' : 'range';
  return { ema20: e20, ema50: e50, spreadPct, regime };
}

function rsiState(r) {
  if (r == null) return { label: 'n/a', state: 'none' };
  if (r >= 70) return { label: 'overbought', state: 'overbought' };
  if (r <= 30) return { label: 'oversold', state: 'oversold' };
  return { label: 'neutral', state: 'neutral' };
}

/**
 * Full multi-horizon report for one stock.
 * `path` = [{ t, p }] daily closes (Tornsy). `price` = live api price if known.
 */
async function composeReport(path, price) {
  const closes = closesFromPath(path);
  if (!closes.length) return null;

  const horizons = [7, 30, 90];
  const forecasts = {};
  for (const h of horizons) {
    forecasts[h] = forecastSeries(path, { horizonDays: h });
  }

  const last = forecasts[30] ? forecasts[30].lastPrice : (price || closes[closes.length - 1]);
  const r = rsi(closes, 14);
  const macdObj = macdSeries(closes);
  const trend = trendEMACross(closes);
  const sr = supportResistance(closes);

  const rsiStateObj = rsiState(r);
  let regimeSummary = [];
  if (trend && trend.regime === 'uptrend') regimeSummary.push('uptrend');
  else if (trend && trend.regime === 'downtrend') regimeSummary.push('downtrend');
  else regimeSummary.push('range');
  if (rsiStateObj.state === 'overbought') regimeSummary.push('overbought');
  else if (rsiStateObj.state === 'oversold') regimeSummary.push('oversold');
  if (macdObj) regimeSummary.push(macdObj.momentum === 'bull' ? 'macd+' : macdObj.momentum === 'bear' ? 'macd-' : 'macd~');

  const f30 = forecasts[30];
  return {
    last,
    forecasts,
    tech: {
      rsi: r,
      rsiState: rsiStateObj.state,
      macd: macdObj,
      ema20: trend && trend.ema20,
      ema50: trend && trend.ema50,
      trend: trend && trend.regime,
      support: sr.support,
      resistance: sr.resistance,
      distToSupport: sr.distanceToSupport,
      distToResistance: sr.distanceToResistance,
    },
    regimeText: regimeSummary.length ? regimeSummary.join(' · ') : 'n/a',
    signals: f30 ? f30.signals : null,
  };
}

/**
 * Backtest summary shared with `!stockforecast` display.
 */
function backtestSummary(forecast) {
  if (!forecast || !forecast.backtest) return 'n/a';
  const bt = forecast.backtest;
  return bt.directional != null
    ? `${Math.round(bt.directional * 100)}% directional (n=${bt.samples})`
    : 'n/a';
}

module.exports = { composeReport, backtestSummary, sma, ema, rsi, macdSeries, supportResistance };