/**
 * Stock price forecaster — port of the TornDesk forecast engine. Deterministic,
 * transparent statistical model over Torn's own `torn/stocks/{id}` price
 * history:
 *
 *   - Holt linear exponential smoothing (level + trend) on recent daily closes,
 *     extrapolated `horizonDays` ahead.
 *   - Confidence bands widen with sqrt(horizon) from the one-step residual
 *     variance — the model states its own uncertainty.
 *   - Signals (momentum vs 20d SMA, 120d mean-reversion z-score, annualized
 *     volatility, fitted drift) combine into a weighted bias score.
 *   - Backtest rolls the origin across history and reports directional
 *     hit-rate + MAE on data never seen at fit time.
 *
 * `bias`/`confidence` are a weighted score and a [0,1] strength gauge — NOT a
 * probability forecast.
 */

const DEFAULT = { alpha: 0.45, beta: 0.3, window: 90, horizonDays: 30 };

function validatePath(path) {
  if (!Array.isArray(path) || path.length < 30) return null;
  const sorted = [...path].sort((a, b) => a.t - b.t);
  if (sorted.some((x) => !(x.p > 0) || !Number.isFinite(x.t))) return null;
  return sorted;
}

function meanSq(a) {
  return a.length ? a.reduce((s, x) => s + x * x, 0) / a.length : 0;
}

function holtFit(path, alpha = DEFAULT.alpha, beta = DEFAULT.beta) {
  const data = path.map((x) => x.p);
  let level = data[0];
  let trend = (data[data.length - 1] - data[0]) / Math.max(1, data.length - 1);
  const residuals = [];
  for (let i = 1; i < data.length; i++) {
    const pred = level + trend;
    residuals.push(data[i] - pred);
    const nextLevel = alpha * data[i] + (1 - alpha) * pred;
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    level = nextLevel;
  }
  return { level, trend, residuals };
}

function annualizedVolatility(path) {
  if (path.length < 2) return 0;
  const rets = [];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1].p;
    if (prev > 0) rets.push(Math.log(path[i].p / prev));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(365);
}

function backtestHolt(path, opts = {}) {
  const sorted = validatePath(path);
  if (!sorted) return { directional: null, mae: null, samples: 0 };
  const fitWindow = opts.fitWindow || 60;
  const lookahead = opts.lookahead || 5;
  const dirHit = [];
  const errors = [];
  for (let start = 0; start + fitWindow + lookahead <= sorted.length; start++) {
    const fit = sorted.slice(start, start + fitWindow);
    const actual = sorted[start + fitWindow].p;
    const { level, trend } = holtFit(fit, DEFAULT.alpha, DEFAULT.beta);
    const fore = level + trend * lookahead;
    const last = fit[fit.length - 1].p;
    dirHit.push((fore - last) * (actual - last) >= 0);
    errors.push(Math.abs(fore - actual));
  }
  if (!dirHit.length) return { directional: null, mae: null, samples: 0 };
  return {
    directional: dirHit.filter(Boolean).length / dirHit.length,
    mae: errors.reduce((a, b) => a + b, 0) / errors.length,
    samples: dirHit.length,
  };
}

function pathAvg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function pathStd(a) {
  if (a.length < 2) return 0;
  const m = pathAvg(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}

/**
 * Forecast a price series. Returns null when there isn't enough history.
 * `path` entries: { t: seconds, p: price }.
 */
function forecastSeries(path, params = {}) {
  const sorted = validatePath(path);
  if (!sorted) return null;
  const alpha = params.alpha || DEFAULT.alpha;
  const beta = params.beta || DEFAULT.beta;
  const window = params.window || DEFAULT.window;
  const horizonDays = params.horizonDays || DEFAULT.horizonDays;

  const recent = sorted.slice(-window);
  const { level, trend, residuals } = holtFit(recent, alpha, beta);
  const lastPrice = recent[recent.length - 1].p;
  const lastT = recent[recent.length - 1].t;
  const day = Math.max(1, recent.length > 1 ? (lastT - recent[0].t) / (recent.length - 1) : 86400);
  const residualStd = Math.sqrt(meanSq(residuals));
  const zConf = 1.28; // ~80% band

  const points = [];
  for (let h = 1; h <= horizonDays; h++) {
    const p = level + trend * h;
    const band = zConf * residualStd * Math.sqrt(h);
    points.push({ t: lastT + h * day, p: Math.max(0.0001, p), low: Math.max(0.0001, p - band), high: p + band });
  }

  const sma20 = pathAvg(sorted.slice(-20).map((x) => x.p));
  const mean120 = pathAvg(sorted.slice(-120).map((x) => x.p));
  const std120 = pathStd(sorted.slice(-120).map((x) => x.p));
  const momentum = lastPrice >= sma20 * 1.005 ? 'up' : lastPrice <= sma20 * 0.995 ? 'down' : 'flat';
  const meanRevZ = std120 > 0 ? (lastPrice - mean120) / std120 : 0;
  const volatility = annualizedVolatility(sorted);
  const driftAnnualPct = lastPrice > 0 ? (trend * 365) / lastPrice : 0;

  let score = (momentum === 'up' ? 0.4 : momentum === 'down' ? -0.4 : 0);
  score += Math.max(-0.2, Math.min(0.2, meanRevZ * -0.12));
  score += Math.max(-0.3, Math.min(0.3, driftAnnualPct / 100));
  score = Math.max(-1, Math.min(1, score));
  const bias = score > 0.18 ? 'BUY' : score < -0.18 ? 'SELL' : 'HOLD';
  const confidence = Math.round(Math.abs(score) * 100) / 100;

  return {
    lastPrice,
    horizonDays,
    points,
    signals: { momentum, meanRevZ, volatility, drift: trend, driftAnnualPct },
    bias,
    confidence,
    backtest: backtestHolt(sorted, { fitWindow: Math.min(90, sorted.length - 6), lookahead: 5 }),
  };
}

module.exports = { forecastSeries, backtestHolt, holtFit, validatePath };